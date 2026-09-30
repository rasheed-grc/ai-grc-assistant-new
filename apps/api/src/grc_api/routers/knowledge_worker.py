"""Admin AI Worker Control Center (Knowledge Intelligence KI-P5, ADR-0029) — read-only
status/timeline/reports plus two consequential actions (reschedule, manual trigger) over the
Autonomous Knowledge Worker (KI-P4, ADR-0028). Every route requires ``ResourceType
.KNOWLEDGE_WORKER``, deliberately left out of the ``_OPERATIONAL``/``_CATALOG`` grant sets in
``RbacAuthorizationService`` (CLAUDE.md §20). ``OWNER``/``ADMIN`` hold every action on it;
``AUDITOR`` inherits its existing platform-wide *read-only* grant (the same rule that already
covers the audit trail), so it can view status/timeline but not schedule/trigger; every other
role gets a 403 on every route. Consequential control (reschedule, enable/disable, manual
trigger) is therefore admin-only in the sense that matters — no non-admin role can ever
mutate worker state.

Like the regulation-review surface, this router talks directly to
``grc_persistence_web`` repositories against apps/web's live schema rather than the
gated command/query bus: the worker's state (`worker_control`/`worker_run_history`/
`worker_events`) is platform-scope, not a tenant-owned aggregate, the same reasoning
``KnowledgeItemRepository`` itself already rests on. Every consequential write here (enable/
disable, interval change, manual trigger) is a human record-keeping action, not an AI Tool
call, so it is authorized and audited directly by this router rather than routed through the
Tool Registry (the same posture ``KnowledgeItemRepository.set_verification_status`` already
takes for verification decisions) — the audit event lands in the same append-only
`worker_events` table the activity timeline reads, with the acting admin's user/tenant id
attached (CLAUDE.md §19/§23).
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from datetime import datetime, timedelta

from fastapi import APIRouter, Query
from grc_persistence_web import WorkerControlRecord, WorkerEventRecord, WorkerRunRecord
from grc_services.shared.authorization import Action, ResourceType
from pydantic import BaseModel, Field

from ..schemas.common import ApiModel, problem_responses
from ..security.dependencies import (
    Authz,
    Context,
    WebKnowledgeItemRepository,
    WebWorkerControlRepository,
    WebWorkerEventRepository,
    WebWorkerRunHistoryRepository,
)

router = APIRouter(prefix="/knowledge-worker", tags=["knowledge-worker"])

_TERMINAL_EVENT_TYPES = frozenset({"cycle_completed", "error"})


class WorkerStatusResponse(ApiModel):
    enabled: bool
    running: bool
    current_cycle: str
    current_task: str | None
    interval_hours: float
    manual_trigger_requested: bool
    last_run_at: datetime | None
    last_run_reason: str | None
    next_run_at: datetime | None
    updated_by: str | None
    updated_at: datetime


class WorkerEventResponse(ApiModel):
    id: str
    event_type: str
    question_id: str | None
    message: str
    metadata: dict[str, str]
    actor_user_id: str | None
    actor_tenant_id: str | None
    occurred_at: datetime


class WorkerRunResponse(ApiModel):
    id: str
    reason: str
    started_at: datetime
    completed_at: datetime | None
    questions_considered: int
    gaps_detected: int
    items_saved: int
    error_count: int


class LearningReportsResponse(BaseModel):
    total_items: int
    verified: int
    needs_review: int
    outdated: int
    discovered: int
    added_this_cycle: int
    updated: int


class WorkerControlResponse(ApiModel):
    id: str
    enabled: bool
    interval_hours: float
    manual_trigger_requested_at: datetime | None
    updated_at: datetime
    updated_by: str | None


class ScheduleUpdateRequest(BaseModel):
    enabled: bool | None = None
    interval_hours: float | None = Field(default=None, gt=0)


def _current_cycle_state(
    recent_events: Sequence[WorkerEventRecord],
) -> tuple[str, str | None]:
    """Derived purely from the activity timeline (most-recent-first): scanning backwards in
    time, a ``cycle_started`` reached before any terminal event means a cycle is still in
    progress; a terminal event (``cycle_completed``/``error``) reached first means the worker
    is idle. No separate "is running" heartbeat table exists — this is intentionally the one
    source of truth, so the two can never drift."""
    if not recent_events:
        return "idle", None
    current_task = recent_events[0].message
    for event in recent_events:
        if event.event_type in _TERMINAL_EVENT_TYPES:
            return "idle", None
        if event.event_type == "cycle_started":
            return "in_progress", current_task
    return "idle", None


def _next_run_at(
    control: WorkerControlRecord, latest_run: WorkerRunRecord | None
) -> datetime | None:
    """``None`` means "due now" (never run before, or a manual trigger is pending) rather
    than an actual absence of a next run — the worker is disabled only when ``enabled`` is
    ``False``, reported separately."""
    if not control.enabled or control.manual_trigger_requested_at is not None:
        return None
    if latest_run is None or latest_run.completed_at is None:
        return None
    return latest_run.completed_at + timedelta(hours=control.interval_hours)


@router.get(
    "/status",
    response_model=WorkerStatusResponse,
    summary="Get the Autonomous Knowledge Worker's current status",
    responses=problem_responses(403),
)
async def get_status(
    authz: Authz,
    context: Context,
    control_repo: WebWorkerControlRepository,
    run_history: WebWorkerRunHistoryRepository,
    events_repo: WebWorkerEventRepository,
) -> WorkerStatusResponse:
    await authz.ensure_can(context, Action.READ, ResourceType.KNOWLEDGE_WORKER)
    control = await control_repo.get()
    latest_run = await run_history.get_latest()
    recent_events = await events_repo.list_recent(limit=50)
    current_cycle, current_task = _current_cycle_state(recent_events)
    return WorkerStatusResponse(
        enabled=control.enabled,
        running=control.enabled,
        current_cycle=current_cycle,
        current_task=current_task,
        interval_hours=control.interval_hours,
        manual_trigger_requested=control.manual_trigger_requested_at is not None,
        last_run_at=latest_run.completed_at if latest_run else None,
        last_run_reason=latest_run.reason if latest_run else None,
        next_run_at=_next_run_at(control, latest_run),
        updated_by=control.updated_by,
        updated_at=control.updated_at,
    )


@router.get(
    "/events",
    response_model=list[WorkerEventResponse],
    summary="List the worker's recent activity timeline (operational events only, no raw"
    " model reasoning)",
    responses=problem_responses(403),
)
async def list_events(
    authz: Authz,
    context: Context,
    events_repo: WebWorkerEventRepository,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[WorkerEventResponse]:
    await authz.ensure_can(context, Action.READ, ResourceType.KNOWLEDGE_WORKER)
    records = await events_repo.list_recent(limit=limit)
    return [WorkerEventResponse.model_validate(record) for record in records]


@router.get(
    "/runs",
    response_model=list[WorkerRunResponse],
    summary="List the worker's recent learning-cycle run history",
    responses=problem_responses(403),
)
async def list_runs(
    authz: Authz,
    context: Context,
    run_history: WebWorkerRunHistoryRepository,
    limit: int = Query(default=20, ge=1, le=100),
) -> list[WorkerRunResponse]:
    await authz.ensure_can(context, Action.READ, ResourceType.KNOWLEDGE_WORKER)
    records = await run_history.list_recent(limit=limit)
    return [WorkerRunResponse.model_validate(record) for record in records]


@router.get(
    "/reports",
    response_model=LearningReportsResponse,
    summary="Learning reports: knowledge base coverage by verification status",
    responses=problem_responses(403),
)
async def get_reports(
    authz: Authz,
    context: Context,
    items_repo: WebKnowledgeItemRepository,
    run_history: WebWorkerRunHistoryRepository,
) -> LearningReportsResponse:
    await authz.ensure_can(context, Action.READ, ResourceType.KNOWLEDGE_WORKER)
    items = await items_repo.list_all()
    counts = Counter(item.status for item in items)
    latest_run = await run_history.get_latest()
    # An item's `version` only increases on a real content change (KI-P1, ADR-0025): version
    # > 1 is exactly "this item has been re-discovered/changed at least once since creation".
    updated_count = sum(1 for item in items if item.version > 1)
    return LearningReportsResponse(
        total_items=len(items),
        verified=counts.get("verified", 0),
        needs_review=counts.get("needs_review", 0),
        outdated=counts.get("outdated", 0),
        discovered=counts.get("discovered", 0),
        added_this_cycle=latest_run.items_saved if latest_run else 0,
        updated=updated_count,
    )


@router.post(
    "/schedule",
    response_model=WorkerControlResponse,
    summary="Enable/disable the worker and/or change its learning-cycle interval",
    responses=problem_responses(403, 422),
)
async def update_schedule(
    body: ScheduleUpdateRequest,
    authz: Authz,
    context: Context,
    control_repo: WebWorkerControlRepository,
    events_repo: WebWorkerEventRepository,
) -> WorkerControlResponse:
    await authz.ensure_can(context, Action.UPDATE, ResourceType.KNOWLEDGE_WORKER)
    actor_user_id = str(context.user_id)
    actor_tenant_id = str(context.organization_id)

    updated: WorkerControlRecord | None = None
    if body.enabled is not None:
        updated = await control_repo.set_enabled(body.enabled, updated_by=actor_user_id)
        await events_repo.record_admin_action(
            event_type="worker_enabled" if body.enabled else "worker_disabled",
            message=f"Worker {'enabled' if body.enabled else 'disabled'} by admin",
            actor_user_id=actor_user_id,
            actor_tenant_id=actor_tenant_id,
        )
    if body.interval_hours is not None:
        updated = await control_repo.set_interval_hours(
            body.interval_hours, updated_by=actor_user_id
        )
        await events_repo.record_admin_action(
            event_type="interval_changed",
            message=f"Learning cycle interval changed to {body.interval_hours} hour(s)",
            actor_user_id=actor_user_id,
            actor_tenant_id=actor_tenant_id,
            metadata={"interval_hours": str(body.interval_hours)},
        )
    if updated is None:
        updated = await control_repo.get()
    return WorkerControlResponse.model_validate(updated)


@router.post(
    "/trigger",
    response_model=WorkerControlResponse,
    summary='Admin "Run Learning Now" — request an out-of-cycle learning run',
    responses=problem_responses(403),
)
async def trigger_run(
    authz: Authz,
    context: Context,
    control_repo: WebWorkerControlRepository,
    events_repo: WebWorkerEventRepository,
) -> WorkerControlResponse:
    await authz.ensure_can(context, Action.EXECUTE, ResourceType.KNOWLEDGE_WORKER)
    actor_user_id = str(context.user_id)
    actor_tenant_id = str(context.organization_id)
    updated = await control_repo.request_manual_trigger(updated_by=actor_user_id)
    await events_repo.record_admin_action(
        event_type="manual_trigger_requested",
        message="Manual learning run requested by admin",
        actor_user_id=actor_user_id,
        actor_tenant_id=actor_tenant_id,
    )
    return WorkerControlResponse.model_validate(updated)
