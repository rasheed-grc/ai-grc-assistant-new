"""The production `ExecutionPort` — the Wave 1 executor wiring (ADR 0066 §3).

Until now `create_app` defaulted to `EchoExecutor`, so every mission step returned
`"echo: <input>"`. The Governance Plan Mission's third step is supposed to emit a JSON draft, so
the whole Discovery → Report → Plan journey ended at *"The governance plan draft was not valid
JSON."* The tools, the registry and the executor all existed and were proven end-to-end by
`tests/production/test_governance_plan_e2e.py`; only this composition was missing.

**This is also the default `ExecutionPort` for every other mission type in
`assistant_runtime.builtin.default_mission_catalog()`** (gap_assessment, risk_assessment,
iso_controls, policy_generator, vendor_review) — `create_app` has exactly one default executor,
not one per mission type. Their plans (`assistant_runtime/builtin/gap_assessment.py`,
`risk_assessment.py`, …) resolve steps to two general-purpose tools this registry did not carry —
`local_search` (the customer's own ingested evidence) and `generate_text` (raw synthesis) — so
every gap/risk-assessment mission failed at its second step with "no tool named 'local_search' is
registered" the moment a real executor replaced Echo. Registering them here, from the SAME
`knowledge_base`/`generation_provider` the app already threads to this executor for the governance
plan tools, is composition only — it adds no new store, no new provider, no parallel search system.

**Composition only.** No new domain, no new port, no new tool — every tool here is frozen
(`framework-library`, `governance-plan-tools`, `search-tools`, `llm-tools`), as is the
`ToolRegistry` and the `RegistryExecutor`. Each step resolves to its own tool via `PlanStep.tool`
(ADR 0048), so this file never branches on step identity.

**Why the registry is built per step rather than once at startup.** `PostgresGovernanceStore`
opens a connection in its constructor and holds it for its lifetime, so a registry built once at
app construction would share a single connection across every concurrent request — and ADR 0055 is
explicit that no durable store lives at app scope ("what is long-lived is configuration, never a
store"). `create_app` already draws governance stores from a per-request `discovery_store_factory`
for exactly this reason; this executor draws from the same seam and closes what it opens. The same
reasoning applies to `local_search`: `InMemoryKeywordProvider` indexes the corpus once, in its own
`__init__` — a provider captured once at executor-construction time would forever search whatever
the knowledge base held at that instant (nothing, at boot), silently missing every document
ingested afterwards. Calling `knowledge_base.keyword_provider()` fresh inside `_registry()` rebuilds
that index from the CURRENT corpus on every step, the same way a fresh governance store is opened
per step. Building small tool objects per step is negligible next to the LLM call inside one of
them.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Protocol

from framework_library import ControlLibraryTool, FrameworkLibrary
from governance_discovery.engine import DiscoveryEngine
from governance_plan_tools.applicability_tool import OrgApplicabilityTool
from governance_plan_tools.draft_tool import PlanDraftTool
from governance_plan_tools.finalize_tool import PlanFinalizeTool
from knowledge_runtime import TenantKnowledgeBase
from llm_tools import LLMTool
from mission_engine import StepRequest, StepResult
from pipeline_tool import RegistryExecutor
from search_tools import build_local_search_tool
from tool_registry import ToolRegistry


class _Store(Protocol):
    def close(self) -> None: ...


class GovernancePlanExecutor:
    """Runs a mission step against the real tools — every mission type the app's default mission
    catalog offers, not the Governance Plan alone (see the module docstring).

    Holds only configuration: a store *factory*, the stateless discovery engine, the bundled
    framework library, the generation provider, and the shared tenant knowledge base. Nothing
    per-request survives a call.
    """

    def __init__(
        self,
        *,
        store_factory: Callable[[], Any],
        discovery_engine: DiscoveryEngine,
        generation_provider: Any,
        knowledge_store_factory: Callable[[], Any] | None = None,
        frameworks: FrameworkLibrary | None = None,
        knowledge_base: TenantKnowledgeBase | None = None,
    ) -> None:
        self._store_factory = store_factory
        # Optional on purpose: a deployment with no Knowledge Packs passes nothing and the draft
        # reads exactly as it did before they existed.
        self._knowledge_store_factory = knowledge_store_factory
        self._discovery_engine = discovery_engine
        self._generation_provider = generation_provider
        # Pure data, loaded once — the library is immutable and shared safely (the same reason
        # `create_app` builds one DiscoveryEngine for every request).
        self._frameworks = frameworks if frameworks is not None else FrameworkLibrary.from_bundled()
        # Optional on purpose too, and for the same reason as `knowledge_store_factory`: a caller
        # that never passes one (an existing unit test constructing this class directly, say) gets
        # exactly the old 4-tool registry — `local_search` is simply not offered, not stubbed.
        self._knowledge_base = knowledge_base

    def _registry(self, store: Any, knowledge: Any = None) -> ToolRegistry:
        registry = ToolRegistry()
        registry.register(OrgApplicabilityTool(store))
        registry.register(ControlLibraryTool(self._frameworks))
        # `now` / `new_id` are left at their real defaults (time.time / uuid4). The E2E suite pins
        # them to fixed values through its own construction; production must not.
        #
        # The knowledge store reaches the DRAFT tool and no other: sector answers shape how the
        # plan is explained, never what it contains. `PlanFinalizeTool` — the one that persists —
        # is deliberately not given it.
        registry.register(PlanDraftTool(store, self._generation_provider, sector_answers=knowledge))
        registry.register(PlanFinalizeTool(store, self._discovery_engine))
        # General-purpose tools gap_assessment/risk_assessment/iso_controls/policy_generator/
        # vendor_review need (see the module docstring). `generate_text` needs only the provider
        # every mission type here already has; `local_search` needs the tenant knowledge base,
        # rebuilt fresh every call (see the module docstring for why).
        registry.register(LLMTool(self._generation_provider))
        if self._knowledge_base is not None:
            registry.register(build_local_search_tool(self._knowledge_base.keyword_provider()))
        return registry

    def execute(self, request: StepRequest) -> StepResult:
        store: Any = self._store_factory()
        knowledge: Any = (
            self._knowledge_store_factory() if self._knowledge_store_factory else None
        )
        try:
            return RegistryExecutor(self._registry(store, knowledge)).execute(request)
        finally:
            if knowledge is not None:
                close_knowledge = getattr(knowledge, "close", None)
                if close_knowledge is not None:
                    close_knowledge()
            # The store owns a connection; leaking one per step exhausts a managed Postgres long
            # before CPU becomes the ceiling (the same reasoning behind the B3 pool).
            close = getattr(store, "close", None)
            if callable(close):
                close()
