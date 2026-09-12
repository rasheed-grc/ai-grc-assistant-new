"""HTTP response shapes for `/v1/governance-plans/*` (ADR 0066 §3, §3.1, §5).

Governance Plans are immutable snapshots (§3.1): every field here reflects the version as it was
finalized, except `current_maturity`/an item's live `status`, which are the only things Plan
Execution ever changes going forward (§5.3, reversible by construction — never a stored mutation of
the snapshot itself).
"""

from __future__ import annotations

from governance_discovery.plan import GovernancePlan, PlanEvent, PlanItem
from governance_plan_execution import CurrentMaturity
from pydantic import BaseModel


class PlanItemView(BaseModel):
    """One trackable unit of the plan. `resolves_signal` stays internal (it names the applicability
    signal this item's *completion* would resolve, not where it came from — no client need).
    `source_signal_keys` IS now sent: it is the traceability link back to the specific Discovery
    question(s) that produced this item ("Governance Question → Answer → Task", per the product
    brief). The keys themselves are internal engine vocabulary, so the client is responsible for
    translating each one through its own question-label catalog (`discovery.question.<key>`) and
    silently dropping any key it doesn't recognize — raw jargon must never reach the screen, only
    the resolved question text (ADR 0066 "never show technical jargon" still holds; only the layer
    doing the resolving moved)."""

    id: str
    plan_id: str
    pillar: str
    title: str
    # The i18n key behind the title, so a client can render it in the reader's language. Empty for
    # a plan drafted before the key was kept — the client falls back to `title`, which stays
    # authoritative.
    title_key: str = ""
    objective: str
    objective_key: str = ""
    expected_outcome: str
    rationale: str
    timeframe_bucket: str
    priority: str
    effort_size: str
    status: str
    depends_on_item_ids: list[str]
    due_at: float | None
    completed_at: float | None
    evidence_ids: list[str]
    is_evidence_backed: bool
    confidence: float | None
    risk_if_skipped: str | None
    source_signal_keys: list[str] = []
    created_at: float
    updated_at: float

    @classmethod
    def from_item(cls, item: PlanItem) -> PlanItemView:
        return cls(
            id=item.id,
            plan_id=item.plan_id,
            pillar=item.pillar,
            title=item.title,
            title_key=item.title_key,
            objective=item.objective,
            objective_key=item.objective_key,
            expected_outcome=item.expected_outcome,
            rationale=item.rationale,
            timeframe_bucket=item.timeframe_bucket,
            priority=item.priority,
            effort_size=item.effort_size,
            status=item.status,
            depends_on_item_ids=list(item.depends_on_item_ids),
            due_at=item.due_at,
            completed_at=item.completed_at,
            evidence_ids=list(item.evidence_ids),
            is_evidence_backed=item.is_evidence_backed,
            confidence=item.confidence,
            risk_if_skipped=item.risk_if_skipped,
            source_signal_keys=list(item.source_signal_keys),
            created_at=item.created_at,
            updated_at=item.updated_at,
        )


class PlanView(BaseModel):
    """One plan version (§3.1). `status` is `active` or `superseded`; a superseded plan carries
    `maturity_at_supersession` — the live maturity it had actually reached at the moment the next
    version replaced it, letting the user compare versions over time."""

    id: str
    version: int
    status: str
    previous_plan_id: str | None
    source_session_id: str | None
    source_mission_id: str
    inferred_frameworks: list[dict]
    maturity_baseline: dict
    maturity_at_supersession: dict | None
    executive_summary: str | None
    top_risks: list[dict]
    created_at: float
    updated_at: float

    @classmethod
    def from_plan(cls, plan: GovernancePlan) -> PlanView:
        return cls(
            id=plan.id,
            version=plan.version,
            status=plan.status,
            previous_plan_id=plan.previous_plan_id,
            source_session_id=plan.source_session_id,
            source_mission_id=plan.source_mission_id,
            inferred_frameworks=list(plan.inferred_frameworks),
            maturity_baseline=plan.maturity_baseline,
            maturity_at_supersession=plan.maturity_at_supersession,
            executive_summary=plan.executive_summary,
            top_risks=list(plan.top_risks),
            created_at=plan.created_at,
            updated_at=plan.updated_at,
        )


class PlanDetailResponse(BaseModel):
    """A plan version plus its items — the Plan Board's one call (ADR 0066 §8 Plan view)."""

    plan: PlanView
    items: list[PlanItemView]

    @classmethod
    def build(cls, plan: GovernancePlan, items: list[PlanItem]) -> PlanDetailResponse:
        return cls(
            plan=PlanView.from_plan(plan),
            items=[PlanItemView.from_item(item) for item in items],
        )


class PlanVersionsResponse(BaseModel):
    """The tenant's full plan lineage, oldest first — how the user compares versions over time."""

    items: list[PlanView]

    @classmethod
    def from_plans(cls, plans: list[GovernancePlan]) -> PlanVersionsResponse:
        return cls(items=[PlanView.from_plan(plan) for plan in plans])


class AttachEvidenceBody(BaseModel):
    """Always additive and optional (ADR 0066 §5.4) — never a gate on completion."""

    evidence_ids: list[str]


class PlanEventView(BaseModel):
    """One audit fact about an item — `sequence` (not `created_at`) is the deterministic ordering
    key (Phase 3 hardening: two events sharing a timestamp still sort correctly)."""

    id: str
    sequence: int
    event_type: str
    actor_id: str
    created_at: float

    @classmethod
    def from_event(cls, event: PlanEvent) -> PlanEventView:
        return cls(
            id=event.id,
            sequence=event.sequence,
            event_type=event.event_type,
            actor_id=event.actor_id,
            created_at=event.created_at,
        )


class PlanEventsResponse(BaseModel):
    items: list[PlanEventView]

    @classmethod
    def from_events(cls, events: list[PlanEvent]) -> PlanEventsResponse:
        return cls(items=[PlanEventView.from_event(event) for event in events])


class MaturityDimensionView(BaseModel):
    score: float
    stars: int
    label: str


class CurrentMaturityResponse(BaseModel):
    """The live, reversible maturity picture (§5.3): recomputed fresh from the frozen Discovery
    baseline plus whichever plan items are *currently* marked done — never a stored mutation.
    `has_baseline=False` means no Discovery session has ever concluded for this tenant yet."""

    has_baseline: bool
    maturity: dict[str, MaturityDimensionView] | None

    @classmethod
    def from_current(cls, current: CurrentMaturity) -> CurrentMaturityResponse:
        if current.maturity is None:
            return cls(has_baseline=False, maturity=None)
        return cls(
            has_baseline=True,
            maturity={
                dimension: MaturityDimensionView(**rating)
                for dimension, rating in current.maturity.items()
            },
        )
