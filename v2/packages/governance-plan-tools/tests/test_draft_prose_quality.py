"""Regression tests for two real bugs found in a live governance-plan generation run:

1. A truncated LLM response (cut off mid-way through starting the next `LABEL:`) left a dangling
   partial-label fragment (e.g. `"\\nRISK"`) swallowed into the previous field's text.
2. Raw signal `key: value` pairs (e.g. `has_compliance_officer: False`) leaked verbatim into
   drafted prose instead of being restated as natural language.

Both are pure-function fixes — no LLM/DB needed.
"""

from __future__ import annotations

from governance_plan_tools.draft_tool import _parse_labeled_lines
from governance_plan_tools.prompts import core_context_block

LABELS = ("RATIONALE", "OBJECTIVE", "EXPECTED_OUTCOME", "RISK_IF_SKIPPED")


def test_dangling_partial_label_is_stripped_not_swallowed() -> None:
    truncated = (
        "RATIONALE: No one owns compliance today.\n"
        "OBJECTIVE: Name a single accountable owner.\n"
        "EXPECTED_OUTCOME: A named, known compliance owner exists.\n"
        "RISK"
    )
    parsed = _parse_labeled_lines(truncated, LABELS)
    assert parsed["EXPECTED_OUTCOME"] == "A named, known compliance owner exists."
    assert "RISK" not in parsed["EXPECTED_OUTCOME"]
    assert "RISK_IF_SKIPPED" not in parsed


def test_single_character_dangling_fragment_is_stripped() -> None:
    truncated = (
        "RATIONALE: Data leaves the country unreviewed.\n"
        "OBJECTIVE: Control cross-border transfers.\n"
        "EXPECTED_OUTCOME: Transfers are reviewed and controlled.\nR"
    )
    parsed = _parse_labeled_lines(truncated, LABELS)
    assert parsed["EXPECTED_OUTCOME"] == "Transfers are reviewed and controlled."


def test_complete_response_is_unaffected() -> None:
    complete = (
        "RATIONALE: No one owns compliance today.\n"
        "OBJECTIVE: Name a single accountable owner.\n"
        "EXPECTED_OUTCOME: A named, known compliance owner exists.\n"
        "RISK_IF_SKIPPED: Gaps keep going unnoticed with no one accountable."
    )
    parsed = _parse_labeled_lines(complete, LABELS)
    assert parsed["EXPECTED_OUTCOME"] == "A named, known compliance owner exists."
    assert parsed["RISK_IF_SKIPPED"] == "Gaps keep going unnoticed with no one accountable."


def test_a_field_that_legitimately_ends_in_capitals_is_not_stripped() -> None:
    # "ISO" is not a strict prefix of any of these labels, so it must survive untouched.
    complete = (
        "RATIONALE: Certification lapsed under ISO.\n"
        "OBJECTIVE: Renew it.\n"
        "EXPECTED_OUTCOME: Certification is current.\n"
        "RISK_IF_SKIPPED: Clients may doubt the claim of ISO."
    )
    parsed = _parse_labeled_lines(complete, LABELS)
    assert parsed["RISK_IF_SKIPPED"] == "Clients may doubt the claim of ISO."


def test_core_context_block_never_echoes_raw_python_booleans() -> None:
    block = core_context_block({"has_compliance_officer": False, "org_structure_state": "absent"})
    assert "False" not in block
    assert "has_compliance_officer" not in block
    assert "has compliance officer: no" in block
    assert "org structure state: absent" in block


def test_core_context_block_empty_signals_yields_empty_string() -> None:
    assert core_context_block({}) == ""
