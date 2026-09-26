"""The FastAPI application factory — the V1 Product API Host (ADR 0052).

`create_app` is a **composition root**: it builds the wired object graph once (the tenant resolver
and the read model), stores it on `app.state`, registers the uniform error handlers, and mounts the
health probe and the versioned `/v1` surface. No business logic lives here — the host validates,
authenticates, scopes to a tenant, and dispatches to `v2/packages/*`.

Adapters are injectable so tests (and later, deployment) swap them without touching the routes. The
**read models are durable by default** — an unconfigured deployment gets PostgreSQL, not an
in-memory projection (see `composition`); a test that wants in-memory asks for it explicitly with
`storage=Storage.MEMORY`. The store, the executor, and the identity provider are still the
development ones, each replaced at its own seam.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from typing import Any

from assistant_runtime.builtin import default_mission_catalog
from document_read_model import DocumentReadModel
from fastapi import FastAPI
from framework_library import FrameworkLibrary
from governance_discovery.engine import DiscoveryEngine
from governance_discovery.pack import load_bundled_packs
from governance_store import PostgresGovernanceStore, PostgresKnowledgeStore
from knowledge_runtime import TenantKnowledgeBase
from mission_application import DeliverableBuilderRegistry, ExportService
from mission_engine import EchoExecutor, InMemoryMissionStore, MissionEngine
from mission_engine.ports import ExecutionPort
from mission_read_model import MissionListReadModel, PostgresMissionListReadModel

from grc_api.adapters import ReadModelProjection
from grc_api.composition import (
    DurableMissionReader,
    Storage,
    Tables,
    build_document_read_model,
    build_mission_read_model,
    durable_command_scope_factory,
    governance_database_dsn,
    memory_command_scope_factory,
    open_autocommit_connection,
)
from grc_api.errors import register_exception_handlers, register_knowledge_error_handlers
from grc_api.execution import GovernancePlanExecutor
from grc_api.knowledge_generation import (
    KNOWLEDGE_PROMPT_VERSION,
    build_knowledge_question_generator,
    generator_commit,
    knowledge_generator_model,
)
from grc_api.launch import DurableMissionLaunch, MemoryMissionLaunch, MissionLaunchPort
from grc_api.llm_provider import LLMRole, build_generation_provider
from grc_api.result_adapters import (
    BundledDeliverableProvider,
    DocxExporter,
    GapAssessmentResultBuilder,
    GenericResultBuilder,
    MarkdownExporter,
    PdfExporter,
)
from grc_api.routers.approvals import router as approvals_router
from grc_api.routers.dashboard import router as dashboard_router
from grc_api.routers.discovery import router as discovery_router
from grc_api.routers.documents import router as documents_router
from grc_api.routers.governance_plans import router as governance_plans_router
from grc_api.routers.health import router as health_router
from grc_api.routers.knowledge import router as knowledge_router
from grc_api.routers.missions import router as missions_router
from grc_api.security import IdentityProvider, development_identity_provider
from grc_api.service_identity import CompositeIdentityProvider, ServiceAssertionIdentityProvider

# apps/web -> grc-api service-to-service identity assertion (ADR 0066 addendum). Unset in a plain
# local dev/test run — the dev fixed-credential provider alone still works exactly as before.
GOVERNANCE_SERVICE_SECRET_ENV_VAR = "GRC_API_SERVICE_SECRET"


def service_secrets() -> tuple[str, ...]:
    """Every secret this host currently ACCEPTS, newest first.

    Comma-separated so a rotation can be expressed in configuration alone, with no code change and
    no downtime: during the overlap both the outgoing and incoming keys are listed, and requests
    signed with either are accepted. Tokens live 60 seconds, so the overlap need only outlast that.

    Minting always uses the first entry. Blank entries are dropped, because a trailing comma in a
    secret-manager value must not become an empty accepted key.
    """
    raw = os.environ.get(GOVERNANCE_SERVICE_SECRET_ENV_VAR, "")
    return tuple(value.strip() for value in raw.split(",") if value.strip())


def _default_identity_provider() -> IdentityProvider:
    dev_provider = development_identity_provider()
    secrets = service_secrets()
    if not secrets:
        return dev_provider
    return CompositeIdentityProvider((dev_provider, ServiceAssertionIdentityProvider(secrets)))

LOGGER = logging.getLogger(__name__)

API_TITLE = "Rasheed GRC API"
API_VERSION = "0.1.0"


def _default_executor(
    engine: DiscoveryEngine,
    store_factory: Callable[[], Any],
    knowledge_store_factory: Callable[[], Any] | None = None,
    knowledge_base: TenantKnowledgeBase | None = None,
) -> ExecutionPort:
    """The production executor: real tools when an LLM is configured, echo when it is not.

    An unconfigured deployment must still boot — local `pytest`, CI and `next build` all construct
    the app without a provider — but it must never *silently* answer `"echo: <input>"` where a
    governance plan belongs. `build_generation_provider` logs precisely which variable is missing,
    and this logs the consequence.
    """
    # The GOVERNANCE role — Claude, enforced. The governance plan is the one output whose vendor
    # must not move by configuration, so the executor asks for the role, never for "an LLM".
    provider = build_generation_provider(LLMRole.GOVERNANCE)
    if provider is None:
        LOGGER.warning(
            "execution_degraded: no governance LLM configured — mission steps will ECHO, and the "
            "Governance Plan draft step will not produce a plan. Set ANTHROPIC_API_KEY (role "
            "'governance' is restricted to Claude) to run for real.",
        )
        return EchoExecutor()
    return GovernancePlanExecutor(
        store_factory=store_factory,
        discovery_engine=engine,
        generation_provider=provider,
        knowledge_store_factory=knowledge_store_factory,
        knowledge_base=knowledge_base,
    )


def create_app(
    *,
    storage: Storage = Storage.DURABLE,
    tables: Tables | None = None,
    executor: ExecutionPort | None = None,
    read_model: MissionListReadModel | None = None,
    identity_provider: IdentityProvider | None = None,
    mission_store: Any | None = None,
    mission_engine: Any | None = None,
    document_read_model: DocumentReadModel | None = None,
    knowledge_base: TenantKnowledgeBase | None = None,
    discovery_engine: DiscoveryEngine | None = None,
    discovery_store_factory: Any | None = None,
    knowledge_store_factory: Any | None = None,
    knowledge_question_generator: Any | None = None,
) -> FastAPI:
    app = FastAPI(title=API_TITLE, version=API_VERSION)

    # `storage` selects the read-model adapters: DURABLE (the production default — an unconfigured
    # deployment gets PostgreSQL, never an in-memory projection that loses a tenant's work) or
    # MEMORY, which a test asks for explicitly. An injected adapter still wins over both.
    where = tables or Tables()
    app.state.mission_read_model = read_model or build_mission_read_model(storage, where)
    app.state.identity_provider = identity_provider or _default_identity_provider()
    # Storage, per ADR 0055. **No durable store lives here.** Reads go through a reader service that
    # creates a store per read and discards it; writes go through a factory that creates one
    # transaction's worth of collaborators per command. What is long-lived is configuration, never a
    # store — so there is nothing for a later change to accidentally share process-wide.
    # Governance Discovery (ADR 0066): the engine is pure and stateless — safe to build once and
    # share across every request. Only the store is per-request; `discovery_store_factory` is the
    # injection seam a test uses to avoid a real database. Both are resolved HERE, ahead of the
    # executor, because the production executor is composed from them (see `execution.py`).
    resolved_engine = discovery_engine or DiscoveryEngine(load_bundled_packs())
    resolved_store_factory = discovery_store_factory or (
        lambda: PostgresGovernanceStore(dsn=governance_database_dsn())
    )
    # Resolved here because the executor is composed from it: the plan DRAFT reads the customer's
    # sector answers (ADR 0067), so the knowledge store has to exist before the executor does.
    resolved_knowledge_factory = knowledge_store_factory or (
        lambda: PostgresKnowledgeStore(dsn=governance_database_dsn())
    )
    # Resolved here, too, and reused verbatim as `app.state.knowledge_base` below — the executor's
    # `local_search` tool and `POST /v1/documents`' ingestion must read and write the SAME base, or
    # a real upload would land in one instance while every mission searches an empty other one.
    resolved_knowledge_base = knowledge_base or TenantKnowledgeBase()
    run_step: ExecutionPort = executor or _default_executor(
        resolved_engine, resolved_store_factory, resolved_knowledge_factory, resolved_knowledge_base
    )
    launch: MissionLaunchPort
    if storage is Storage.MEMORY:
        # In-memory state has to live somewhere: the dictionary IS the storage, and no connection or
        # transaction is involved. `mission_store` / `mission_engine` stay injectable for this path.
        memory_store = mission_store if mission_store is not None else InMemoryMissionStore()
        memory_engine = (
            mission_engine if mission_engine is not None else MissionEngine(memory_store, run_step)
        )
        app.state.mission_reader = memory_store
        # Execution starts through the launch boundary (ADR 0055), never from a command directly.
        # It projects its result to the shared read model when it finishes (execution is a write).
        memory_projection = ReadModelProjection(app.state.mission_read_model)
        launch = MemoryMissionLaunch(memory_engine, memory_store, memory_projection.project)
        app.state.command_scope = memory_command_scope_factory(
            memory_engine, memory_store, app.state.mission_read_model, launch
        )
    else:
        app.state.mission_reader = DurableMissionReader(where.missions)
        launch = DurableMissionLaunch(
            executor=run_step,
            missions_table=where.missions,
            outbox_table=where.outbox,
            connect=open_autocommit_connection,
            project=lambda conn, mission: ReadModelProjection(
                PostgresMissionListReadModel(connection=conn, table=where.missions_view)
            ).project(mission),
        )
        app.state.command_scope = durable_command_scope_factory(run_step, where, launch)
    # The Result builder registry (Slice S3): each mission type gets its builder; the default is the
    # generic one. Concrete builders + the framework provider are composed here, behind the ports.
    provider = BundledDeliverableProvider()
    frameworks = FrameworkLibrary.from_bundled()
    app.state.result_registry = DeliverableBuilderRegistry(
        default=GenericResultBuilder(provider),
        by_type={"gap_assessment": GapAssessmentResultBuilder(provider, frameworks)},
    )
    app.state.export_service = ExportService(
        {"md": MarkdownExporter(), "docx": DocxExporter(), "pdf": PdfExporter()}
    )
    # Knowledge (Slice S4): the Document read model the view lists, plus the shared knowledge base
    # the upload ingests into. One base holds every tenant's chunks (each chunk tenant-scoped), so
    # retrieval never crosses the boundary. Both drop in at this seam (Postgres / pgvector later).
    app.state.document_read_model = document_read_model or build_document_read_model(storage, where)
    app.state.knowledge_base = resolved_knowledge_base
    # The Mission Catalog (Slice S7): a Mission type IS a plan factory. The create command reads it
    # to turn a chosen type + scope into the Core's (goal, plan). The bundled catalog holds the 6.
    app.state.mission_catalog = default_mission_catalog()
    # Governance Discovery (ADR 0066): the engine is pure and stateless — safe to build once and
    # share across every request. Only the store is per-request (see `deps.get_discovery_store`);
    # `discovery_store_factory` is the injection seam a test uses to avoid a real database, exactly
    # like `mission_store`/`read_model` above do for the mission subsystem. Both were resolved
    # above, where the executor needed them.
    app.state.discovery_engine = resolved_engine
    app.state.discovery_store_factory = resolved_store_factory
    # Sector Knowledge Packs (ADR 0067). A separate store class over the SAME database: knowledge
    # is platform-wide (industries, templates, releases carry no tenant) while assessments are
    # tenant-scoped, and keeping the two in one connection discipline is what lets an assessment
    # cite a release in one transaction.
    app.state.knowledge_store_factory = resolved_knowledge_factory
    # The generator is the ONE piece that may legitimately be absent: a deployment with no
    # governance model configured cannot author knowledge, and `None` is how it says so. The route
    # answers `503` naming what is missing rather than inventing questions nobody wrote.
    app.state.knowledge_question_generator = (
        knowledge_question_generator or build_knowledge_question_generator()
    )
    app.state.knowledge_generator_model = knowledge_generator_model()
    app.state.knowledge_prompt_version = KNOWLEDGE_PROMPT_VERSION
    app.state.knowledge_generator_commit = generator_commit()

    register_exception_handlers(app)
    register_knowledge_error_handlers(app)
    app.include_router(health_router)
    app.include_router(missions_router, prefix="/v1")
    app.include_router(documents_router, prefix="/v1")
    app.include_router(dashboard_router, prefix="/v1")
    app.include_router(approvals_router, prefix="/v1")
    app.include_router(discovery_router, prefix="/v1")
    app.include_router(governance_plans_router, prefix="/v1")
    app.include_router(knowledge_router, prefix="/v1")

    return app


# A module-level ASGI app so `uvicorn grc_api.app:app` works — the intuitive entrypoint. Without it,
# uvicorn fails with "Attribute 'app' not found in module 'grc_api.app'" and the API never starts,
# so every `/v1` fetch fails at the network layer and the UI shows "Load failed". The package
# re-exports this same instance as `grc_api:app` (unseeded); the seeded demo app is
# `grc_api.dev:app`.
app = create_app()
