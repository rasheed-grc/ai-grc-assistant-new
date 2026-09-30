"""`/v1/discovery/*` — the AI Governance Planning Engine's adaptive interview (ADR 0066).

Thin adapter over `governance_session.DiscoverySessionService`: resolve the tenant, translate
input/output at the boundary, map typed service errors to HTTP (`errors.py`'s uniform envelope).
Every actual decision — which question is next, when to conclude, what the one-shot analysis
says — is made by `governance-discovery`; nothing here invents logic.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from governance_discovery.pack import Question
from governance_session import (
    DiscoverySessionService,
    InvalidAnswer,
    NoQuestionToGoBackTo,
    QuestionNotCurrentlyEligible,
    SessionAlreadyConcluded,
    SessionNotFound,
    UnknownQuestion,
)
from pipeline_contracts import TenantContext

from grc_api.deps import get_discovery_service
from grc_api.discovery_schemas import (
    DiscoveryResultResponse,
    DiscoveryTurnResponse,
    GoBackResponse,
    QuestionView,
    SkipQuestionBody,
    StageProgress,
    SubmitAnswerBody,
)
from grc_api.errors import ApiError
from grc_api.security import require_tenant

router = APIRouter()


def _turn_response(
    session_id: str, status: str, question: Question | None
) -> DiscoveryTurnResponse:
    return DiscoveryTurnResponse(
        session_id=session_id,
        status=status,
        question=QuestionView.from_question(question) if question else None,
        progress=StageProgress.for_stage(question.stage) if question else None,
    )


@router.post("/discovery/sessions", response_model=DiscoveryTurnResponse, status_code=201)
def start_session(
    tenant: Annotated[TenantContext, Depends(require_tenant)],
    service: Annotated[DiscoverySessionService, Depends(get_discovery_service)],
) -> DiscoveryTurnResponse:
    # At most one interview in flight per tenant. Starting while one is already `in_progress`
    # used to leave an orphaned duplicate behind (and `active` kept serving the older one), so a
    # second "start" resumes the existing session instead — the same one `GET .../active` returns.
    resumed = service.resume(tenant.tenant_id)
    if resumed is not None:
        session, question = resumed
        return _turn_response(session.id, session.status, question)
    session, question = service.start(tenant.tenant_id)
    return _turn_response(session.id, session.status, question)


@router.get("/discovery/sessions/active")
def get_active_session(
    tenant: Annotated[TenantContext, Depends(require_tenant)],
    service: Annotated[DiscoverySessionService, Depends(get_discovery_service)],
) -> DiscoveryTurnResponse | None:
    """Resumable-by-design (ADR 0066 "Frontend"): the client never needs to remember a session
    id — it asks for the tenant's current `in_progress` session, if any, and gets straight back to
    the right question."""
    resumed = service.resume(tenant.tenant_id)
    if resumed is None:
        return None
    session, question = resumed
    return _turn_response(session.id, session.status, question)


@router.post("/discovery/sessions/{session_id}/answers", response_model=DiscoveryTurnResponse)
def submit_answer(
    session_id: str,
    body: SubmitAnswerBody,
    tenant: Annotated[TenantContext, Depends(require_tenant)],
    service: Annotated[DiscoverySessionService, Depends(get_discovery_service)],
) -> DiscoveryTurnResponse:
    try:
        outcome = service.answer(session_id, tenant.tenant_id, body.question_id, body.value)
    except SessionNotFound as exc:
        raise ApiError(status_code=404, code="not_found", message=str(exc)) from exc
    except SessionAlreadyConcluded as exc:
        raise ApiError(status_code=409, code="conflict", message=str(exc)) from exc
    except (UnknownQuestion, QuestionNotCurrentlyEligible) as exc:
        raise ApiError(status_code=400, code="validation_error", message=str(exc)) from exc
    except InvalidAnswer as exc:
        raise ApiError(
            status_code=400,
            code="validation_error",
            message=str(exc),
            details={"question_id": exc.question_id, "reason": exc.reason},
        ) from exc
    # The response NEVER carries signals, frameworks, or plan data — only the next question (or
    # none, once concluded). This is a hard contract, not an incidental shape (ADR 0066): it is
    # what makes it structurally impossible for the frontend to leak partial results mid-interview.
    return _turn_response(outcome.session.id, outcome.session.status, outcome.next_question)


@router.post("/discovery/sessions/{session_id}/skip", response_model=DiscoveryTurnResponse)
def skip_question(
    session_id: str,
    body: SkipQuestionBody,
    tenant: Annotated[TenantContext, Depends(require_tenant)],
    service: Annotated[DiscoverySessionService, Depends(get_discovery_service)],
) -> DiscoveryTurnResponse:
    """Skips an OPTIONAL question (free-text clarifications, supplementary multi-select context)
    — required questions cannot be skipped (`InvalidAnswer` -> 400)."""
    try:
        outcome = service.skip(session_id, tenant.tenant_id, body.question_id)
    except SessionNotFound as exc:
        raise ApiError(status_code=404, code="not_found", message=str(exc)) from exc
    except SessionAlreadyConcluded as exc:
        raise ApiError(status_code=409, code="conflict", message=str(exc)) from exc
    except (UnknownQuestion, QuestionNotCurrentlyEligible) as exc:
        raise ApiError(status_code=400, code="validation_error", message=str(exc)) from exc
    except InvalidAnswer as exc:
        raise ApiError(
            status_code=400,
            code="validation_error",
            message=str(exc),
            details={"question_id": exc.question_id, "reason": exc.reason},
        ) from exc
    return _turn_response(outcome.session.id, outcome.session.status, outcome.next_question)


@router.post("/discovery/sessions/{session_id}/back", response_model=GoBackResponse)
def go_back(
    session_id: str,
    tenant: Annotated[TenantContext, Depends(require_tenant)],
    service: Annotated[DiscoverySessionService, Depends(get_discovery_service)],
) -> GoBackResponse:
    try:
        target = service.go_back(session_id, tenant.tenant_id)
    except SessionNotFound as exc:
        raise ApiError(status_code=404, code="not_found", message=str(exc)) from exc
    except NoQuestionToGoBackTo as exc:
        raise ApiError(status_code=404, code="not_found", message=str(exc)) from exc
    return GoBackResponse(
        question=QuestionView.from_question(target.question), previous_answer=target.previous_answer
    )


@router.get("/discovery/sessions/{session_id}/result", response_model=DiscoveryResultResponse)
def get_result(
    session_id: str,
    tenant: Annotated[TenantContext, Depends(require_tenant)],
    service: Annotated[DiscoverySessionService, Depends(get_discovery_service)],
) -> DiscoveryResultResponse:
    try:
        session = service.get(session_id, tenant.tenant_id)
    except SessionNotFound as exc:
        raise ApiError(status_code=404, code="not_found", message=str(exc)) from exc
    if session.applicability is None:
        raise ApiError(status_code=409, code="conflict", message="session has not concluded yet")
    result = session.applicability
    return DiscoveryResultResponse(
        frameworks=list(result.frameworks),
        maturity=result.maturity,
        maturity_vision=result.maturity_vision,
        capacity=result.capacity,
        gaps=list(result.gaps),
        plan_items=list(result.plan_items),
        confidence=result.confidence,
        confidence_score=result.confidence_score,
    )
