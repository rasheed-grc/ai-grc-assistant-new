"""Named, versioned prompt content for the Governance Plan drafting role (ADR 0066 §4/§5.2;
CLAUDE.md: "Prompts...named and versioned artifacts, never hardcoded inline"). Deliberately plain
f-string templates — matching the convention every existing `generate_text`-using capability
follows today (`gap_assessment.py`, `risk_assessment.py`: inline instruction strings, no separate
template package). `prompt-orchestrator`'s heavier `PromptTemplate` machinery backs the
retrieve-then-generate pipeline (`run_pipeline`); no existing builtin routes a raw `generate_text`
step through it, so this doesn't invent a second convention — it names and versions what's already
the de facto shape.

Hard rule enforced by `SYSTEM_PROMPT` itself, not just by convention: the LLM never names a
specific standard (ADR 0066 §4 "Methodology & Standards is the only place a framework is ever
named") and never invents a fact — every prompt hands it already-decided structure and asks only
for wording.
"""

from __future__ import annotations

from pipeline_contracts import Language

SYSTEM_PROMPT_ID = "governance_plan.system.v2"
SYSTEM_PROMPT = (
    "You are a governance, risk, and compliance advisor writing for a business owner who does not "
    "know GRC terminology. Write in plain, direct, professional language — the register of a "
    "consulting deliverable, not a technical checklist. NEVER name a specific regulatory framework "
    "or standard by name (e.g. ISO 27001, NIST, PDPL, CIS, SOC 2) — describe outcomes and "
    "practices instead; the standards themselves are disclosed elsewhere, not in this text. Base "
    "every claim STRICTLY on the facts given to you in the request — never invent a fact, a "
    "number, or a finding that is not present in the provided context. The context may list facts "
    "as `key: value` pairs — restate these as natural sentences; never reproduce a field name, "
    "code identifier, or literal value (e.g. `yes`/`no`, a quoted string) verbatim in your prose. "
    # The boundary between the two engines, stated to the model itself and not only in the docs.
    # Sector answers were added to this role's context so that a plan can be EXPLAINED in the
    # customer's own terms; a model that responded by proposing an extra action would have made
    # itself a second decision-maker beside the rule engine. Now even a wrong answer is confined
    # to wording.
    "You may explain, prioritize, or contextualize existing governance actions, but you must never "
    "invent, remove, merge, or reorder governance actions."
)

EXECUTIVE_BRIEF_PROMPT_ID = "governance_plan.executive_brief.v1"


CORE_CONTEXT_HEADING = (
    "What the organization told us about itself in the main interview. Use it to make the "
    "assessment concrete — its size, how it operates, what it handles. It does NOT add, remove or "
    "change any recommended action; the actions are already decided.\n"
)


def _humanize_signal_key(key: str) -> str:
    """`has_compliance_officer` -> `has compliance officer`. Not the original question text (the
    engine only knows the signal's internal name, not its i18n-resolved prompt — that catalog lives
    in apps/web) — but plain spaced words read as English, not as a code identifier, which is what
    actually leaked into drafted prose (a model shown `has_compliance_officer: False` echoed that
    literal token back rather than restating it)."""
    return key.replace("_", " ")


def _humanize_signal_value(value: object) -> object:
    """Booleans as `yes`/`no`, everything else untouched. `False`/`True` read as Python/JSON
    literals when quoted back in prose; `yes`/`no` reads as an answer."""
    if isinstance(value, bool):
        return "yes" if value else "no"
    return value


def core_context_block(signals: dict) -> str:
    """What the customer actually said, not only what the engine concluded from it.

    The engine's applicability — maturity, gaps, capacity — is a CONCLUSION. Handing the writer only
    conclusions produces prose that restates them; handing it the answers behind them lets the
    explanation refer to the organization as it described itself. Still narrative only: every action
    was decided before this text is written.
    """
    if not signals:
        return ""
    lines = [
        f"- {_humanize_signal_key(key)}: {_humanize_signal_value(value)}"
        for key, value in sorted(signals.items())
        if value is not None
    ]
    if not lines:
        return ""
    return "\n\n" + CORE_CONTEXT_HEADING + "\n".join(lines)


SECTOR_CONTEXT_HEADING = (
    "The organization also answered these questions about its sector. Use them to make the "
    "assessment concrete and specific to how this organization actually operates. They do NOT "
    "add, remove, or change any recommended action — the actions are already decided.\n"
)


def sector_context_block(answers: list[dict]) -> str:
    """The sector answers, rendered for a prompt — or nothing at all.

    Empty when the organization answered no sector questions, and empty is the point: the prompt
    must look exactly as it did before this feature for an organization in a sector with no
    published pack, rather than carrying a heading with nothing under it.
    """
    if not answers:
        return ""
    lines = [
        f"- {answer.get('canonical_text_ar', '')} -> {answer.get('answer')}" for answer in answers
    ]
    return "\n\n" + SECTOR_CONTEXT_HEADING + "\n".join(lines)


def executive_brief_prompt(context: str) -> str:
    return (
        "Given the following structured assessment of an organization (maturity per dimension, "
        "and the gaps identified), write a 2-4 sentence executive brief — a consultant's opening "
        "assessment, not a summary. If the data clearly points to one root cause behind several "
        "symptoms, say so explicitly (e.g. 'the underlying issue is X, which is driving Y and Z') "
        "rather than listing findings side by side. End with one sentence recommending what to "
        "focus on first.\n\n"
        f"{context}"
    )


GAP_PROMPT_ID = "governance_plan.gap.v1"


def gap_prompt(gap_context: str) -> str:
    return (
        "Given this specific governance/compliance gap, respond in EXACTLY this two-line format "
        "(no extra text before or after):\n"
        "DESCRIPTION: <one sentence stating plainly what is missing>\n"
        "IMPACT: <one to two sentences on the concrete business consequence of leaving it "
        "unaddressed — not what it is, what could go wrong>\n\n"
        f"{gap_context}"
    )


PLAN_ITEM_PROMPT_ID = "governance_plan.item_prose.v1"


def plan_item_prompt(item_context: str) -> str:
    return (
        "Given this recommendation and the specific facts that triggered it, respond in EXACTLY "
        "this four-line format (no extra text before or after):\n"
        "RATIONALE: <1-2 sentences: why this was recommended, referencing the specific facts>\n"
        "OBJECTIVE: <one sentence: what this action sets out to achieve>\n"
        "EXPECTED_OUTCOME: <one sentence: what will be true once it is done>\n"
        "RISK_IF_SKIPPED: <1-2 sentences: the concrete consequence of not doing this>\n\n"
        f"{item_context}"
    )


__all__ = [
    "SYSTEM_PROMPT_ID",
    "SYSTEM_PROMPT",
    "EXECUTIVE_BRIEF_PROMPT_ID",
    "executive_brief_prompt",
    "GAP_PROMPT_ID",
    "gap_prompt",
    "PLAN_ITEM_PROMPT_ID",
    "plan_item_prompt",
    "CORE_CONTEXT_HEADING",
    "core_context_block",
    "SECTOR_CONTEXT_HEADING",
    "sector_context_block",
]


# The language directive for the governance-plan drafting role. THIS module owns it.
#
# Not a copy of anything. An earlier version of this block described itself as duplicating
# `prompt_orchestrator.templates._ANSWER_LANGUAGE`, and that framing was the actual problem: two
# things called the same thing will be expected to stay in step, and one day they will not. They
# are not the same thing. That one governs the retrieve-then-generate pipeline's system template;
# this one governs a tool that writes governance-plan prose and states what THAT job needs — keep
# framework names and control identifiers in their original form, because "ISO 27001" and "NCA ECC"
# translated are no longer citations. A prompt owning its own language directive is not
# duplication; it is a prompt.
#
# It must be a SEGMENT, not the request's `language` field. `LLMRequest.language` is metadata:
# `messages()` folds segments into system + user and never turns that field into anything a model
# reads. A plan drafted for an Arabic-reading organization came back in English with the request
# correctly marked ARABIC — the field was right and the model never saw it. `test_language_is_an
# _INSTRUCTION_not_metadata` exists to keep that from returning.
_PLAN_LANGUAGE_DIRECTIVE = {
    Language.ENGLISH: (
        "Write every field of the plan in clear, professional English."
    ),
    Language.ARABIC: (
        "اكتب جميع حقول الخطة باللغة العربية الفصحى الواضحة والمهنية. "
        "أبقِ أسماء الأطر ومعرّفات الضوابط كما هي بلغتها الأصلية "
        "(مثل ISO 27001 وNCA ECC وSAMA CSF)، فترجمتها تُفقدها صفتها كمرجع."
    ),
    Language.MIXED: (
        "Write the plan in the language the organization used. If it mixes Arabic and English, "
        "mirror that mix, and keep framework names and control identifiers in their original form."
    ),
}


def answer_language_directive(language: Language) -> str:
    """The instruction that tells the model which language to write the plan in.

    English is the fallback for a language this role has no directive for — a plan in the wrong
    language is recoverable, a plan with no language instruction at all silently is not.
    """
    return _PLAN_LANGUAGE_DIRECTIVE.get(language, _PLAN_LANGUAGE_DIRECTIVE[Language.ENGLISH])
