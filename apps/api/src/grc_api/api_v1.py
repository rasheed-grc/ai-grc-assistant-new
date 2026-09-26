"""The versioned ``/api/v1`` surface — aggregates every resource router (Handbook §8.113).

Public APIs evolve by version; breaking changes ship as ``/api/v2`` and consumers migrate at
their own pace. This module is the single place the v1 capability set is assembled.
"""

from __future__ import annotations

from fastapi import APIRouter

from .routers import (
    assessments,
    audit,
    controls,
    evidence,
    frameworks,
    knowledge_worker,
    missions,
    orchestrator,
    platform,
    policies,
    regulation_review,
    reporting,
    risks,
    workspaces,
)

API_V1_PREFIX = "/api/v1"


def build_v1_router() -> APIRouter:
    router = APIRouter()
    router.include_router(missions.router)
    router.include_router(workspaces.router)
    router.include_router(frameworks.router)
    router.include_router(controls.router)
    router.include_router(policies.router)
    router.include_router(risks.router)
    router.include_router(assessments.router)
    router.include_router(evidence.router)
    router.include_router(reporting.router)
    router.include_router(audit.router)
    router.include_router(platform.router)
    router.include_router(orchestrator.router)
    router.include_router(knowledge_worker.router)
    router.include_router(regulation_review.router)
    return router
