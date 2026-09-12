"""FastAPI dependencies for authentication, tenancy, and access to the wired object graph.

These are the seams every protected route uses. ``get_principal`` authenticates the bearer
credential into a tenant-bound ``Principal``; ``get_execution_context`` packages it with the
request's trace id into the ``ExecutionContext`` that every use case runs under (so tenancy +
authorization + audit attribution are bound end to end — CLAUDE.md §7, §20). Routers never reach
infrastructure directly; they depend on these.
"""

from __future__ import annotations

from typing import Annotated, cast

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from grc_agents.orchestrator import Orchestrator
from grc_domain.shared.value_objects import TraceContext
from grc_llm import EmbeddingModel
from grc_persistence_web import (
    KnowledgeItemRepository,
    PolicyMissionStore,
    PolicyRepository,
    RegulationDocumentRepository,
    RegulationSectionRepository,
    RegulationSourceRepository,
    RegulationSourceVersionRepository,
    WorkerControlRepository,
    WorkerEventRepository,
    WorkerRunHistoryRepository,
)
from grc_services.shared.authorization import AuthorizationService
from grc_services.shared.bus import CommandBus, QueryBus
from grc_services.shared.context import ExecutionContext, Principal

from ..container import AppContainer
from ..middleware.errors import AuthenticationError
from ..observability import bind_request_context, current_request_context
from ..web_runtime import (
    get_policy_mission_store,
    get_policy_repository,
    get_regulation_document_repository,
    get_regulation_section_repository,
    get_regulation_source_repository,
    get_regulation_source_version_repository,
    get_web_knowledge_item_repository,
    get_worker_control_repository,
    get_worker_event_repository,
    get_worker_run_history_repository,
)

_bearer = HTTPBearer(auto_error=False, description="Bearer token (OIDC/JWT in production).")


def get_container(request: Request) -> AppContainer:
    container = getattr(request.app.state, "container", None)
    if container is None:  # pragma: no cover - indicates a startup wiring bug
        raise RuntimeError("application container is not initialized")
    return cast(AppContainer, container)


async def get_principal(
    container: Annotated[AppContainer, Depends(get_container)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> Principal:
    if credentials is None or not credentials.credentials:
        raise AuthenticationError("a bearer token is required")
    principal = await container.authenticator.authenticate(credentials.credentials)
    # Enrich the request-scoped context so subsequent logs/audit attribute the tenant + user.
    context = current_request_context()
    if context is not None:
        bind_request_context(
            context.with_principal(
                organization_id=str(principal.organization_id),
                user_id=str(principal.user_id),
            )
        )
    return principal


async def get_execution_context(
    principal: Annotated[Principal, Depends(get_principal)],
) -> ExecutionContext:
    context = current_request_context()
    trace = TraceContext(trace_id=context.trace_id) if context is not None else None
    return ExecutionContext(principal=principal, trace=trace)


def get_command_bus(
    container: Annotated[AppContainer, Depends(get_container)],
) -> CommandBus:
    return container.command_bus


def get_query_bus(
    container: Annotated[AppContainer, Depends(get_container)],
) -> QueryBus:
    return container.query_bus


def get_orchestrator(
    container: Annotated[AppContainer, Depends(get_container)],
) -> Orchestrator:
    return container.orchestrator


def get_authz(
    container: Annotated[AppContainer, Depends(get_container)],
) -> AuthorizationService:
    return container.authz


def get_embedding_model(
    container: Annotated[AppContainer, Depends(get_container)],
) -> EmbeddingModel:
    return container.embedding_model


# ---- Policies/Knowledge Worker/Regulation Review: wired against apps/web's live Postgres,
# not the gated store_backend above (see web_runtime.py for why this connection is created
# lazily per-request). ----
async def get_web_policy_repository(
    request: Request,
    container: Annotated[AppContainer, Depends(get_container)],
) -> PolicyRepository:
    return await get_policy_repository(request.app, container.settings.database_url)


async def get_web_policy_mission_store(
    request: Request,
    container: Annotated[AppContainer, Depends(get_container)],
) -> PolicyMissionStore:
    return await get_policy_mission_store(request.app, container.settings.database_url)


async def get_web_worker_control_repository(
    request: Request,
    container: Annotated[AppContainer, Depends(get_container)],
) -> WorkerControlRepository:
    return await get_worker_control_repository(request.app, container.settings.database_url)


async def get_web_worker_run_history_repository(
    request: Request,
    container: Annotated[AppContainer, Depends(get_container)],
) -> WorkerRunHistoryRepository:
    return await get_worker_run_history_repository(request.app, container.settings.database_url)


async def get_web_worker_event_repository(
    request: Request,
    container: Annotated[AppContainer, Depends(get_container)],
) -> WorkerEventRepository:
    return await get_worker_event_repository(request.app, container.settings.database_url)


async def get_web_knowledge_item_repository_dep(
    request: Request,
    container: Annotated[AppContainer, Depends(get_container)],
) -> KnowledgeItemRepository:
    return await get_web_knowledge_item_repository(request.app, container.settings.database_url)


async def get_web_regulation_source_repository(
    request: Request,
    container: Annotated[AppContainer, Depends(get_container)],
) -> RegulationSourceRepository:
    return await get_regulation_source_repository(request.app, container.settings.database_url)


async def get_web_regulation_source_version_repository(
    request: Request,
    container: Annotated[AppContainer, Depends(get_container)],
) -> RegulationSourceVersionRepository:
    return await get_regulation_source_version_repository(
        request.app, container.settings.database_url
    )


async def get_web_regulation_document_repository(
    request: Request,
    container: Annotated[AppContainer, Depends(get_container)],
) -> RegulationDocumentRepository:
    return await get_regulation_document_repository(request.app, container.settings.database_url)


async def get_web_regulation_section_repository(
    request: Request,
    container: Annotated[AppContainer, Depends(get_container)],
) -> RegulationSectionRepository:
    return await get_regulation_section_repository(request.app, container.settings.database_url)


# Convenience aliases for concise router signatures.
CurrentPrincipal = Annotated[Principal, Depends(get_principal)]
Context = Annotated[ExecutionContext, Depends(get_execution_context)]
Commands = Annotated[CommandBus, Depends(get_command_bus)]
Queries = Annotated[QueryBus, Depends(get_query_bus)]
OrchestratorDep = Annotated[Orchestrator, Depends(get_orchestrator)]
Authz = Annotated[AuthorizationService, Depends(get_authz)]
EmbeddingModelDep = Annotated[EmbeddingModel, Depends(get_embedding_model)]
WebPolicyRepository = Annotated[PolicyRepository, Depends(get_web_policy_repository)]
WebPolicyMissionStore = Annotated[PolicyMissionStore, Depends(get_web_policy_mission_store)]
WebWorkerControlRepository = Annotated[
    WorkerControlRepository, Depends(get_web_worker_control_repository)
]
WebWorkerRunHistoryRepository = Annotated[
    WorkerRunHistoryRepository, Depends(get_web_worker_run_history_repository)
]
WebWorkerEventRepository = Annotated[
    WorkerEventRepository, Depends(get_web_worker_event_repository)
]
WebKnowledgeItemRepository = Annotated[
    KnowledgeItemRepository, Depends(get_web_knowledge_item_repository_dep)
]
WebRegulationSourceRepository = Annotated[
    RegulationSourceRepository, Depends(get_web_regulation_source_repository)
]
WebRegulationSourceVersionRepository = Annotated[
    RegulationSourceVersionRepository, Depends(get_web_regulation_source_version_repository)
]
WebRegulationDocumentRepository = Annotated[
    RegulationDocumentRepository, Depends(get_web_regulation_document_repository)
]
WebRegulationSectionRepository = Annotated[
    RegulationSectionRepository, Depends(get_web_regulation_section_repository)
]
