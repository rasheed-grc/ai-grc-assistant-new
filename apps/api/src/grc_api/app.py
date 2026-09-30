"""The FastAPI application factory — the public entry point to the AI GRC Assistant.

``create_app`` wires the HTTP edge: structured logging, request correlation, CORS, uniform
problem+json error handling, the unauthenticated health probes, and the versioned ``/api/v1``
surface. It builds the composition root once and stores it on ``app.state`` so every request
serves from a single wired object graph. The app is a *thin* interface (ADR-0013): it validates,
authenticates, scopes to a tenant, dispatches to the Application layer, and shapes the response —
no business logic lives here.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api_v1 import API_V1_PREFIX, build_v1_router
from .composition import build_container
from .middleware import (
    IdempotencyMiddleware,
    RequestContextMiddleware,
    register_exception_handlers,
)
from .observability import configure_logging, get_logger
from .routers.health import router as health_router
from .settings import Settings, get_settings
from .web_runtime import close_web_database

API_VERSION = "1.0.0"

_DESCRIPTION = """\
The public REST API of the **AI GRC Assistant** — the interface layer over the platform's
mission-centric Application core. Every capability is a tenant-scoped, authorized use case
dispatched through the Command/Query buses; consequential actions (approvals, publishing) pass
through explicit human gates. Responses are typed; errors are RFC 9457 problem+json.

Authentication: send `Authorization: Bearer <token>`. In local/dev a seeded token is available.
"""

_OPENAPI_TAGS = [
    {"name": "health", "description": "Liveness and readiness probes (unauthenticated)."},
    {"name": "missions", "description": "Mission lifecycle: plan, execute, human-gate, complete."},
    {"name": "workspaces", "description": "Workspaces — the object-centric GRC work environment."},
    {"name": "frameworks", "description": "Compliance frameworks (data, not code) and versions."},
    {"name": "controls", "description": "Customer control implementations and framework mappings."},
    {"name": "policies", "description": "Policy authoring lifecycle: draft → review → publish."},
    {"name": "risks", "description": "Risk identification, assessment, treatment, acceptance."},
    {"name": "assessments", "description": "Framework assessments and coverage results."},
    {"name": "evidence", "description": "Evidence collection, validation, and control linkage."},
    {"name": "reporting", "description": "Audit-ready reports and deliverables."},
    {"name": "audit", "description": "The append-only, tenant-scoped audit trail."},
    {"name": "platform", "description": "Tool / agent / plugin registries (extensibility)."},
    {"name": "orchestrator", "description": "The AI Orchestrator — routed, governed agent runs."},
]

_logger = get_logger("grc_api.app")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(level=settings.log_level, json_output=settings.log_json)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        _logger.info("api_startup", extra={"environment": settings.app_env})
        yield
        # A no-op if the web-Postgres pool was never lazily created
        # (see web_runtime.py) — most tests never touch it.
        await close_web_database(app)
        _logger.info("api_shutdown")

    app = FastAPI(
        title=settings.api_title,
        version=API_VERSION,
        description=_DESCRIPTION,
        openapi_tags=_OPENAPI_TAGS,
        root_path=settings.api_root_path,
        lifespan=lifespan,
        contact={"name": "AI GRC Assistant"},
    )

    # Built eagerly so the graph is ready for tests and ASGI transports without lifespan.
    app.state.settings = settings
    app.state.container = build_container(settings)

    # Middleware is added inner-to-outer. Final order (outermost → innermost):
    #   RequestContext (correlation) → CORS → Idempotency → routing.
    app.add_middleware(IdempotencyMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-Id", "Idempotency-Replayed"],
    )
    app.add_middleware(RequestContextMiddleware)

    register_exception_handlers(app)

    app.include_router(health_router)
    app.include_router(build_v1_router(), prefix=API_V1_PREFIX)

    _logger.info("api_ready", extra={"version": API_VERSION, "v1_prefix": API_V1_PREFIX})
    return app
