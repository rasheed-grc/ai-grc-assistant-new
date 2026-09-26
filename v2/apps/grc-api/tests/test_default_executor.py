"""The production default executor — the seam that decided whether the product was real.

For as long as `create_app` defaulted to `EchoExecutor`, every mission step returned
`"echo: <input>"`, and the Governance Plan draft step produced a string the frontend rejected with
"The governance plan draft was not valid JSON." Nothing in the system said so: the fallback was
silent, and only an end-to-end attempt against a running app revealed it.

So these tests assert the two things that actually matter about the default:
  1. with a provider configured, the default is the REAL executor — not echo;
  2. without one, it degrades to echo *and says so*, because a silent degrade is what hid this.
"""

from __future__ import annotations

import logging

import sys

from grc_api.app import _default_executor

# `grc_api/__init__.py` does `from grc_api.app import app`, which rebinds the package attribute
# `grc_api.app` from the MODULE to the FastAPI instance. So neither `import grc_api.app as m` nor
# a "grc_api.app.x" monkeypatch target reaches the module. `sys.modules` always does.
app_module = sys.modules["grc_api.app"]
from grc_api.execution import GovernancePlanExecutor
from grc_api.llm_provider import (
    PROVIDER_ENV_VAR,
    LLMRole,
    UnknownProviderError,
    build_generation_provider,
)
from mission_engine import EchoExecutor

import pytest


class _Provider:
    """Stands in for a configured LLM; the executor only holds it."""


def _engine():
    from governance_discovery.engine import DiscoveryEngine
    from governance_discovery.pack import load_bundled_packs

    return DiscoveryEngine(load_bundled_packs())


# --- the selector -----------------------------------------------------------------------


def test_no_credential_yields_no_provider_and_names_the_missing_variable(caplog):
    with caplog.at_level(logging.WARNING):
        assert build_generation_provider(LLMRole.TECHNICAL, {PROVIDER_ENV_VAR: "openai"}) is None
    assert "OPENAI_API_KEY" in caplog.text, "the operator must be told WHICH variable is missing"


def test_an_unknown_provider_is_a_misconfiguration_not_a_quiet_fallback():
    """A name nobody can satisfy should stop the boot, not degrade to echo — otherwise a typo in
    deployment config silently costs every customer their governance plan."""
    with pytest.raises(UnknownProviderError, match="names no adapter"):
        build_generation_provider(LLMRole.TECHNICAL, {PROVIDER_ENV_VAR: "gpt5-turbo-max"})


def test_ollama_needs_no_credential(monkeypatch):
    """It runs locally, so absence of a key must not be read as 'unconfigured'."""
    import grc_api.llm_provider as module

    monkeypatch.setattr(module, "_construct", lambda provider, model: _Provider())
    assert build_generation_provider(LLMRole.TECHNICAL, {PROVIDER_ENV_VAR: "ollama"}) is not None


# --- the default executor ---------------------------------------------------------------


def test_with_a_provider_the_default_is_the_real_executor(monkeypatch):
    """The whole point of the Wave 1 wiring: production runs tools, not echo."""
    monkeypatch.setattr(app_module, "build_generation_provider", lambda role: _Provider())
    executor = _default_executor(_engine(), lambda: None)

    assert isinstance(executor, GovernancePlanExecutor)
    assert not isinstance(executor, EchoExecutor)


def test_without_a_provider_it_degrades_to_echo_and_says_so(monkeypatch, caplog):
    monkeypatch.setattr(app_module, "build_generation_provider", lambda role: None)
    with caplog.at_level(logging.WARNING):
        executor = _default_executor(_engine(), lambda: None)

    assert isinstance(executor, EchoExecutor)
    assert "execution_degraded" in caplog.text
    assert "ECHO" in caplog.text


# --- store lifetime ---------------------------------------------------------------------


def test_the_executor_opens_and_closes_a_store_per_step():
    """ADR 0055: no durable store lives at app scope. `PostgresGovernanceStore` holds one
    connection for its lifetime, so a registry built once at startup would share a single
    connection across every concurrent request — and leak one per step if never closed."""
    opened, closed = [], []

    class _Store:
        def close(self):
            closed.append(self)

    def factory():
        store = _Store()
        opened.append(store)
        return store

    executor = GovernancePlanExecutor(
        store_factory=factory, discovery_engine=_engine(), generation_provider=_Provider()
    )

    class _Boom(Exception):
        pass

    class _Registry:
        def get(self, name):
            raise _Boom

    # Even when the step fails, the connection must come back.
    import grc_api.execution as execution

    original = execution.RegistryExecutor
    execution.RegistryExecutor = lambda registry: _Registry()  # type: ignore[assignment]
    try:
        with pytest.raises(Exception):
            executor.execute(object())  # type: ignore[arg-type]
    finally:
        execution.RegistryExecutor = original  # type: ignore[assignment]

    assert len(opened) == 1
    assert closed == opened, "a store opened for a failing step must still be closed"


# --- role separation (Sector Knowledge Packs) --------------------------------------------
#
# Architecture rule from the owner: "OpenAI is never used in the Governance Planner." A rule that
# only lives in a document is a rule that erodes, so it is enforced and tested here.


def test_governance_defaults_to_claude_and_technical_to_openai():
    from grc_api.llm_provider import LLMRole, resolve

    assert resolve(LLMRole.GOVERNANCE, {})[0] == "claude"
    assert resolve(LLMRole.TECHNICAL, {})[0] == "openai"


def test_the_governance_role_REFUSES_openai_even_when_configured_for_it():
    """The whole point of the split. Compliance advice must not change vendor by configuration."""
    from grc_api.llm_provider import LLMRole, ProviderNotAllowedForRoleError, resolve

    with pytest.raises(ProviderNotAllowedForRoleError, match="may not use"):
        resolve(LLMRole.GOVERNANCE, {"GRC_GOVERNANCE_LLM_PROVIDER": "openai"})


def test_flipping_the_GENERAL_provider_cannot_move_governance_off_claude():
    """`GRC_LLM_PROVIDER` configures the technical tier only. Someone switching the general
    provider must not silently relocate every customer's governance advice."""
    from grc_api.llm_provider import LLMRole, resolve

    env = {"GRC_LLM_PROVIDER": "openai", "GRC_LLM_MODEL": "gpt-5"}
    assert resolve(LLMRole.GOVERNANCE, env)[0] == "claude"
    assert resolve(LLMRole.GOVERNANCE, env)[1] != "gpt-5"
    assert resolve(LLMRole.TECHNICAL, env) == ("openai", "gpt-5")


def test_each_role_takes_its_model_from_that_vendors_variable():
    """The Claude adapter's own default is an Opus model, so the configured Sonnet must be passed
    explicitly or the wrong model runs — silently, and at full cost."""
    from grc_api.llm_provider import LLMRole, resolve

    env = {"ANTHROPIC_MODEL": "claude-sonnet-5", "OPENAI_MODEL": "gpt-5"}
    assert resolve(LLMRole.GOVERNANCE, env) == ("claude", "claude-sonnet-5")
    assert resolve(LLMRole.TECHNICAL, env) == ("openai", "gpt-5")


def test_an_explicit_role_override_wins_over_the_vendor_default():
    from grc_api.llm_provider import LLMRole, resolve

    env = {"ANTHROPIC_MODEL": "claude-sonnet-5", "GRC_GOVERNANCE_LLM_MODEL": "claude-opus-4-8"}
    assert resolve(LLMRole.GOVERNANCE, env) == ("claude", "claude-opus-4-8")


def test_governance_reports_the_ANTHROPIC_key_when_it_is_missing(caplog):
    from grc_api.llm_provider import LLMRole, build_generation_provider

    with caplog.at_level(logging.WARNING):
        assert build_generation_provider(LLMRole.GOVERNANCE, {}) is None
    assert "ANTHROPIC_API_KEY" in caplog.text
    assert "governance" in caplog.text


# --- regression: gap_assessment/risk_assessment's tools are actually registered -----------
#
# `assistant_runtime.builtin.default_mission_catalog()` includes gap_assessment, risk_assessment,
# iso_controls, policy_generator, and vendor_review — every one of them resolves a step to
# `local_search` or `generate_text` (see `execution.py`'s module docstring). Until this suite,
# nothing exercised those steps against the REAL default executor: the in-memory suites use
# `Storage.MEMORY` with `EchoExecutor`, and the production suite needs a real Postgres, so it
# skips everywhere but a fully-configured environment. The result was a mission that always
# failed its second step with "no tool named 'local_search' is registered" the moment a real
# governance LLM was configured — caught only by running the production suite against a real
# database with a real credential (see the final report).
#
# No mocked search here: a real `TenantKnowledgeBase` is fed a real document through the same
# `knowledge_runtime.ingest_document` the upload endpoint uses, and `local_search` is invoked for
# real through the real `ToolRegistry`/`RegistryExecutor`. Only the LLM call behind `generate_text`
# is a stub (`_StaticProvider`) — this suite is about tool *registration and retrieval*, not model
# output quality (that is `tests/eval` / the production E2E suite's job, both of which need a live
# credential this fast unit suite must not depend on).


class _StaticProvider:
    """A `GenerationProvider` stand-in: returns canned text instead of calling a real vendor SDK.
    Fine here because this suite proves the tool is *reachable*, not what a real model says."""

    name = "static-test-provider"

    def generate(self, request):  # noqa: ANN001, ANN201 - matches GenerationProvider structurally
        from pipeline_contracts import Answer

        return Answer(text="stub answer", provider=self.name)


class _NoopStore:
    def close(self) -> None:
        pass


def _executor_with_knowledge_base(knowledge_base):
    return GovernancePlanExecutor(
        store_factory=_NoopStore,
        discovery_engine=_engine(),
        generation_provider=_StaticProvider(),
        knowledge_base=knowledge_base,
    )


def _search_step(tenant_id: str, instruction: str):
    from mission_engine import StepRequest
    from pipeline_contracts import TenantContext

    return StepRequest(
        mission_id="mis_test",
        step_id="stp_test",
        tenant=TenantContext(tenant_id=tenant_id),
        instruction=instruction,
        tool="local_search",
    )


def test_local_search_and_generate_text_are_registered_for_the_default_executor():
    """The exact regression: both tools gap_assessment/risk_assessment need must resolve through
    the registry the default executor builds — this is what "no tool named 'local_search' is
    registered" means was false before the fix."""
    from knowledge_runtime import TenantKnowledgeBase

    executor = _executor_with_knowledge_base(TenantKnowledgeBase())
    registry = executor._registry(_NoopStore())  # noqa: SLF001 - the seam under test

    assert "local_search" in registry
    assert "generate_text" in registry


def test_local_search_retrieves_a_real_ingested_document_not_a_stub():
    """Ingests a REAL document (the same `ingest_document` call `POST /v1/documents` makes),
    then runs the REAL `local_search` tool through the REAL registry/executor and asserts the
    tool's output contains the document's own distinctive text — proof this is real retrieval,
    not a stub tool that would make the test pass regardless of what was ingested."""
    from knowledge_runtime import TenantKnowledgeBase, ingest_document
    from pipeline_contracts import TenantContext

    kb = TenantKnowledgeBase()
    marker = "REGRESSION-MARKER-9f3c1a"
    ingest_document(
        kb,
        f"Access Control Policy. {marker}. MFA is required for all privileged accounts.",
        tenant=TenantContext(tenant_id="tenant-a"),
        document_id="doc-1",
        source_filename="access-control-policy.txt",
    )

    executor = _executor_with_knowledge_base(kb)
    result = executor.execute(_search_step("tenant-a", "access control MFA"))

    assert result.ok, f"local_search failed: {result.output!r}"
    assert marker in result.output, (
        f"local_search did not return the real ingested content: {result.output!r}"
    )


def test_local_search_never_returns_another_tenants_document():
    """Same ingested document as above, scoped to tenant-a — a search run as tenant-b must never
    see it. `SearchTool` (search-tools/search.py) documents the engine's defence-in-depth as
    failing SAFE here (`ok=False`, a `TenancyError` refusal) rather than silently filtering the
    result down to empty — a stronger guarantee than "no leak in the text", so that is what this
    asserts, on top of the marker never appearing anywhere in the output regardless."""
    from knowledge_runtime import TenantKnowledgeBase, ingest_document
    from pipeline_contracts import TenantContext

    kb = TenantKnowledgeBase()
    marker = "REGRESSION-MARKER-TENANT-A-ONLY"
    ingest_document(
        kb,
        f"Access Control Policy. {marker}. MFA is required for all privileged accounts.",
        tenant=TenantContext(tenant_id="tenant-a"),
        document_id="doc-1",
        source_filename="access-control-policy.txt",
    )

    executor = _executor_with_knowledge_base(kb)
    result = executor.execute(_search_step("tenant-b", "access control MFA"))

    assert not result.ok, (
        "tenant-b's search must fail safe, not succeed, when it can only touch tenant-a's data"
    )
    assert marker not in result.output, "tenant-b's search saw tenant-a's document"
    assert any("tenant isolation" in w or "TenancyError" in w for w in result.warnings), (
        f"expected a tenant-isolation refusal, got: {result.warnings!r}"
    )


def test_without_a_knowledge_base_local_search_is_simply_not_offered():
    """Backward compatibility: a caller that constructs `GovernancePlanExecutor` without a
    knowledge base (existing unit tests, e.g. the store-lifetime test above) gets exactly the
    pre-fix 4-tool registry — `local_search` is absent, never a stub that fakes a result."""
    executor = _executor_with_knowledge_base(None)
    registry = executor._registry(_NoopStore())  # noqa: SLF001 - the seam under test

    assert "local_search" not in registry
    assert "generate_text" in registry
