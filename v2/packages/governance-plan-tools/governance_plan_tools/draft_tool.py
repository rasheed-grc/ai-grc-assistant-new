"""`PLAN_DRAFT_TOOL` — assembles the complete Governance Plan DRAFT (ADR 0066 §3, §4, §5.2):
computes due dates, and drafts the bounded LLM prose (Executive Brief, per-gap Business Impact,
per-item rationale/objective/expected-outcome/risk-if-skipped) grounded strictly in the
deterministic Tier B output — never deciding structure, priority, or timing, all of which are
already fixed. Produces the reviewable draft as structured JSON; nothing is persisted here — the
human reviews THIS before the approval-gated `finalize_plan` step runs (ADR 0066 §3, revised: the
draft/finalize split exists because the Mission Engine's approval gate pauses BEFORE a consequential
step runs, so the reviewable content must already exist by the time the gate is crossed).
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Callable
from typing import Any, Protocol

from governance_discovery.scheduler import compute_due_at
from governance_store import PostgresGovernanceStore, applicability_from_dict
from pipeline_contracts import (
    GenerationError,
    GenerationProvider,
    Language,
    LLMRequest,
    PromptFamily,
    PromptSegment,
    ResponseContract,
    SegmentKind,
    SegmentRole,
    TenantContext,
)
from tool_registry import PAYLOAD_INSTRUCTION, SideEffectProfile, ToolSpec, ToolStepResult

from governance_plan_tools import prompts

PLAN_DRAFT_TOOL = "governance_plan_draft"

_NO_CITATIONS_CONTRACT = ResponseContract(
    workflow="governance_plan_draft",
    required_sections=(),
    required_citations=False,
    citation_style="",
    required_formatting=(),
    required_confidence=False,
    forbidden_outputs=(),
)

_FALLBACK_RATIONALE = "This was identified as a gap during the assessment."
_FALLBACK_OBJECTIVE = "Address the identified gap."
_FALLBACK_OUTCOME = "The gap is resolved."
_FALLBACK_RISK = "The underlying gap remains unaddressed."
_FALLBACK_GAP_DESCRIPTION = "A gap was identified during the assessment."
_FALLBACK_GAP_IMPACT = "This gap may expose the organization to avoidable risk."
_FALLBACK_EXECUTIVE_BRIEF = (
    "This assessment identifies specific gaps in your current governance practices. "
    "The plan below addresses them in order of priority and executive capacity."
)


# The signal the organization answers with, and what it maps to. `Language` is the prompt layer's
# vocabulary; `ar`/`en` is the interview's. Translating between them here keeps the interview from
# having to know about the prompt orchestrator.
_LANGUAGES = {"ar": Language.ARABIC, "en": Language.ENGLISH}
ORGANIZATION_LANGUAGE_SIGNAL = "organization_language"


def _organization_language(core: dict, fallback: Language) -> Language:
    """The language the ORGANIZATION works in, from its own answer to the core interview.

    Language reaches exactly one place: the wording of the drafted prose. It must never move a
    gap, a maturity score, an applicability derivation or a plan item — two organizations
    answering identically except for this must get the same plan in different words. The question
    is registered `DecisionEffect.NONE` for that reason, and is deliberately NOT required, because
    required-ness feeds coverage and confidence, and those are engine outputs.

    Unanswered means the caller's default, not a guess.
    """
    answer = core.get(ORGANIZATION_LANGUAGE_SIGNAL)
    return _LANGUAGES.get(str(answer or "").lower(), fallback)


def _core_signals(session: Any) -> dict:
    """The core interview's answers as plain values, for the WRITER only.

    Read defensively: a session shape that changes must degrade the prose, never fail the plan.
    """
    try:
        # The getattr is INSIDE the try on purpose: a default does not swallow an exception raised
        # by a property, which is exactly how a changed session shape would fail here.
        signals = getattr(session, "signals", None)
        if signals is None:
            return {}
        # `signals` is a SignalSet, not a dict: it defines `keys()` and `value()` and neither
        # `__iter__` nor `__getitem__`, so ruff's dict-shaped suggestion would not run.
        return {key: signals.value(key) for key in signals.keys()}  # noqa: SIM118
    except Exception:  # noqa: BLE001 — context is optional; a plan is not
        return {}


def _humanize(key: str) -> str:
    """A deterministic title fallback/seed from an i18n key like
    `plan.seed.establish_risk_register.title` -> `Establish Risk Register`. No LLM call — titles
    are short and literal, not worth the drafting role's grounding budget."""
    middle = re.sub(r"^plan\.(seed|gap)\.", "", key)
    middle = re.sub(r"\.(title|rationale)$", "", middle)
    return middle.replace("_", " ").replace(":", " ").strip().title()


class SectorAnswerReader(Protocol):
    """The customer's sector answers, behind a port (ADR 0067). Optional by construction: a
    deployment without Knowledge Packs passes `None` and this tool behaves exactly as it did."""

    def find_assessment_for_session(
        self, source_session_id: str, *, tenant_id: str
    ) -> dict[str, Any] | None: ...

    def load_plan_context(
        self, assessment_id: str, *, tenant_id: str
    ) -> dict[str, Any] | None: ...


class PlanDraftTool:
    def __init__(
        self,
        store: PostgresGovernanceStore,
        provider: GenerationProvider,
        *,
        sector_answers: SectorAnswerReader | None = None,
        version: int = 1,
        language: Language = Language.ENGLISH,
        now: Callable[[], float] = time.time,
    ) -> None:
        self._store = store
        self._provider = provider
        self._sector_answers = sector_answers
        self._language = language
        self._now = now
        self._spec = ToolSpec(
            name=PLAN_DRAFT_TOOL,
            version=version,
            description=(
                "Draft a complete Governance Plan (executive brief, business impact per gap, "
                "per-item prose, due dates) for human review before it is finalized."
            ),
            side_effect=SideEffectProfile.READ_ONLY,  # drafting persists nothing
        )

    @property
    def spec(self) -> ToolSpec:
        return self._spec

    def invoke(self, payload: dict[str, object], tenant: TenantContext) -> dict[str, object]:
        session_id = str(payload.get(PAYLOAD_INSTRUCTION, "")).strip()
        if not session_id:
            return _fail("no discovery_session_id given")
        session = self._store.get_session(session_id, tenant.tenant_id)
        if session is None or session.status != "concluded":
            return _fail("discovery session has not concluded yet")

        # The RECORDED analysis, not `session.applicability` (ADR 0068 §D5). The column holds what
        # discovery alone concluded and nothing updates it when a sector answer moves a decision;
        # reading it here is what made the sector channel write a v2 nobody consumed. Read, never
        # recomputed: no `analyze` call exists on this path.
        version = self._store.latest_applicability_version(session_id, tenant.tenant_id)
        if version is None:
            return _fail(
                f"no recorded applicability version for session {session_id} — run "
                "`python -m grc_api.backfill_applicability`"
            )
        applicability = applicability_from_dict(version["applicability"])
        if applicability is None:
            return _fail(
                f"the recorded applicability version for {session_id} is unreadable"
            )
        applicability_version_id = version["id"]
        now = self._now()
        warnings: list[str] = []

        # Read AFTER the applicability, and never mixed into it. The plan's structure — which
        # items exist, their priority, their order — comes from the rule engine and from nowhere
        # else. These answers only reach the prompts that write PROSE.
        sector = self._read_sector_answers(session_id, tenant, warnings)
        # What the customer SAID, alongside what the engine concluded. Both are context for the
        # writing; neither is a decision — the plan's items came from the rule engine above.
        core = _core_signals(session)
        # Resolved per session, from the organization's answer. `self._language` is now the
        # fallback for an organization that did not answer, not a fixed setting for everyone.
        language = _organization_language(core, self._language)

        executive_summary = self._draft_executive_brief(applicability, core, sector, warnings, language)
        top_risks = [self._draft_gap(gap, warnings, language) for gap in applicability.gaps]
        items = [
            self._draft_item(item, core, sector, now, warnings, language)
            for item in applicability.plan_items
        ]

        draft = {
            "source_session_id": session.id,
            "inferred_frameworks": list(applicability.frameworks),
            "maturity_baseline": applicability.maturity,
            "maturity_vision": applicability.maturity_vision,
            "executive_summary": executive_summary,
            "top_risks": top_risks,
            "items": items,
            # Recorded so a reader can tell an explanation grounded in the customer's own sector
            # from one written without it — the same reason the release id is stored beside the
            # assessment.
            "sector_answer_count": len(sector),
            # Which analysis this draft rests on, carried through to the persisted plan so a
            # reader a year from now can name it rather than infer it.
            "source_applicability_id": applicability_version_id,
            "drafted_at": now,
        }
        return ToolStepResult(
            ok=True, output=json.dumps(draft), warnings=tuple(warnings)
        ).as_payload()

    def _read_sector_answers(
        self, session_id: str, tenant: TenantContext, warnings: list[str]
    ) -> list[dict]:
        """The sector answers for this session, or an empty list.

        Empty is the normal case and never an error: no Knowledge Pack reader configured, no
        assessment, an assessment still open (a plan is not built from answers that can change), or
        a sector with nothing published. Each returns `[]` and the draft reads exactly as it did
        before this feature existed.
        """
        if self._sector_answers is None:
            return []
        try:
            assessment = self._sector_answers.find_assessment_for_session(
                session_id, tenant_id=tenant.tenant_id
            )
            if assessment is None or assessment.get("completed_at") is None:
                return []
            context = self._sector_answers.load_plan_context(
                assessment["id"], tenant_id=tenant.tenant_id
            )
            return list((context or {}).get("sector_answers") or [])
        except Exception as exc:  # noqa: BLE001
            # A plan that explains itself less well is a far better outcome than no plan at all.
            warnings.append(f"sector_answers: unavailable ({type(exc).__name__}), drafted without")
            return []

    # --- LLM-drafted prose, each call bounded to wording over already-fixed facts -------------

    def _why(self) -> str:
        """The last generation failure, for the warning that reports the fallback."""
        return getattr(self, "_last_error", None) or "no reason recorded"

    def _generate(self, prompt: str, language: Language) -> str | None:
        request = LLMRequest(
            family=PromptFamily.TOOL,
            workflow="governance_plan_draft",
            language=language,
            segments=[
                PromptSegment(
                    role=SegmentRole.SYSTEM,
                    kind=SegmentKind.IDENTITY,
                    title="System",
                    content=prompts.SYSTEM_PROMPT,
                    source=prompts.SYSTEM_PROMPT_ID,
                ),
                # The language the ORGANIZATION reads in. `LLMRequest.language` alone is
                # metadata — `messages()` folds segments and never turns that field into anything
                # the model sees — so the directive has to be a segment. Borrowed from the prompt
                # orchestrator rather than restated, so there is one wording platform-wide.
                PromptSegment(
                    role=SegmentRole.SYSTEM,
                    kind=SegmentKind.POLICIES,
                    title="Language",
                    content=prompts.answer_language_directive(language),
                    source="rasheed_system.v1",
                ),
                PromptSegment(
                    role=SegmentRole.USER,
                    kind=SegmentKind.USER_REQUEST,
                    title="Request",
                    content=prompt,
                ),
            ],
            response_contract=_NO_CITATIONS_CONTRACT,
            # 400 was too tight for the four-label item format (RATIONALE/OBJECTIVE/
            # EXPECTED_OUTCOME/RISK_IF_SKIPPED) once Arabic prose is involved — Arabic runs
            # token-heavier per sentence than English, so longer items were cut off mid-response,
            # right after starting the final label. `_parse_labeled_lines` now also strips a
            # dangling partial-label fragment defensively, but the real fix is headroom.
            params={"temperature": 0.3, "max_output_tokens": 900},
        )
        try:
            return self._provider.generate(request).text
        except GenerationError as exc:
            # The REASON is kept, not just the fact. Every field of a plan once fell back to
            # templated prose because a 400 was caught here and reported one layer up as
            # "generation unavailable" — a phrase that reads like a transient blip and was, in
            # fact, a permanently misconfigured request. A warning that cannot distinguish a dead
            # network from a rejected parameter sends the reader to the wrong place.
            self._last_error = f"{type(exc).__name__}: {exc}"
            return None

    def _draft_executive_brief(
        self, applicability, core: dict, sector: list[dict], warnings: list[str],
        language: Language,
    ) -> str:
        context = (
            json.dumps(
                {
                    "maturity": applicability.maturity,
                    "gaps": list(applicability.gaps),
                    "capacity": applicability.capacity,
                }
            )
            + prompts.core_context_block(core)
            + prompts.sector_context_block(sector)
        )
        text = self._generate(prompts.executive_brief_prompt(context), language)
        if not text:
            warnings.append(f"executive_brief: generation failed ({self._why()}), used fallback")
            return _FALLBACK_EXECUTIVE_BRIEF
        return text.strip()

    def _draft_gap(self, gap: dict, warnings: list[str], language: Language) -> dict:
        description_seed = _humanize(gap.get("rationale_key", gap.get("gap_id", "")))
        context = (
            f"Gap id: {gap.get('gap_id')}\n"
            f"Severity: {gap.get('severity')}\n"
            f"Context: {description_seed}"
        )
        text = self._generate(prompts.gap_prompt(context), language)
        description, impact = _FALLBACK_GAP_DESCRIPTION, _FALLBACK_GAP_IMPACT
        if text:
            parsed = _parse_labeled_lines(text, ("DESCRIPTION", "IMPACT"))
            description = parsed.get("DESCRIPTION") or description_seed or description
            impact = parsed.get("IMPACT") or impact
        else:
            warnings.append(f"gap {gap.get('gap_id')}: generation failed ({self._why()})")
        return {
            "gap_id": gap.get("gap_id"),
            "severity": gap.get("severity"),
            "description": description,
            "impact": impact,
        }

    def _draft_item(
        self, item: dict, core: dict, sector: list[dict], now: float, warnings: list[str],
        language: Language,
    ) -> dict:
        title = _humanize(item.get("title_key", item.get("id", "")))
        rationale_seed = _humanize(item.get("rationale_key", ""))
        # The recommendation, its pillar and its urgency are stated to the model as GIVEN. The
        # sector answers arrive underneath them as context for the wording, never as a reason to
        # produce a different action.
        context = (
            f"Recommendation: {title}\n"
            f"Pillar: {item.get('pillar')}\n"
            f"Urgency: {item.get('priority')}\n"
            f"Triggered by facts about: "
            f"{', '.join(item.get('source_signal_keys', [])) or 'the organization'}\n"
            f"Context: {rationale_seed}"
        ) + prompts.core_context_block(core) + prompts.sector_context_block(sector)
        text = self._generate(prompts.plan_item_prompt(context), language)
        rationale, objective, outcome, risk = (
            _FALLBACK_RATIONALE,
            _FALLBACK_OBJECTIVE,
            _FALLBACK_OUTCOME,
            _FALLBACK_RISK,
        )
        if text:
            parsed = _parse_labeled_lines(
                text, ("RATIONALE", "OBJECTIVE", "EXPECTED_OUTCOME", "RISK_IF_SKIPPED")
            )
            rationale = parsed.get("RATIONALE") or rationale_seed or rationale
            objective = parsed.get("OBJECTIVE") or objective
            outcome = parsed.get("EXPECTED_OUTCOME") or outcome
            risk = parsed.get("RISK_IF_SKIPPED") or risk
        else:
            warnings.append(f"item {item.get('id')}: generation failed ({self._why()})")

        return {
            **item,
            "title": title,
            "rationale": rationale,
            "objective": objective,
            "expected_outcome": outcome,
            "risk_if_skipped": risk,
            "due_at": compute_due_at(now, item["timeframe_bucket"]),
        }


def _strip_dangling_label(content: str, labels: tuple[str, ...]) -> str:
    """A response truncated mid-way through starting the NEXT label (e.g. `"...done.\nRISK"`, cut
    off before its colon) has no complete label for the lookahead in `_parse_labeled_lines` to stop
    at, so the partial fragment gets swallowed into the previous field's captured content. Strip a
    trailing `\n<fragment>` when `<fragment>` is a strict, case-sensitive prefix of one of the known
    labels — real content never ends in exactly that shape, so this only ever removes the artifact,
    not a legitimate sentence."""
    match = re.search(r"\n([A-Z_]+)\Z", content)
    if match and any(label != match.group(1) and label.startswith(match.group(1)) for label in labels):
        return content[: match.start()].rstrip()
    return content


def _parse_labeled_lines(text: str, labels: tuple[str, ...]) -> dict[str, str]:
    """Parses the `LABEL: content` lines the drafting prompts require — deterministic string
    parsing, never a second LLM call and never `eval`/JSON-guessing (CLAUDE.md §6 pillar 8). A
    label the model omits or a differently-shaped response simply yields no entry for that key,
    and the caller falls back to its own default text — never a crash, never a guess."""
    result: dict[str, str] = {}
    pattern = "|".join(re.escape(label) for label in labels)
    regex = rf"(?:^|\n)({pattern}):\s*(.*?)(?=\n(?:{pattern}):|\Z)"
    matches = list(re.finditer(regex, text, re.DOTALL))
    for match in matches:
        label, content = match.group(1), match.group(2).strip()
        content = _strip_dangling_label(content, labels)
        if content:
            result[label] = content
    return result


def _fail(reason: str) -> dict[str, object]:
    return ToolStepResult(ok=False, output="", warnings=(reason,)).as_payload()
