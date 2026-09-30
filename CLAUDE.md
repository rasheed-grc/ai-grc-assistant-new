# CLAUDE.md — AI GRC Assistant

> This document is the single, **official** source of truth for how we build the AI GRC
> Assistant. Any engineer (human or AI) joining the project must read this **before**
> writing a single line of code. If a decision contradicts this file, fix the code or
> update this file via PR — never let them drift apart.
>
> This is not a notes file. It is the **engineering constitution** of a global,
> multi-tenant Enterprise SaaS platform intended to serve thousands of organizations
> across many regulatory regimes. Treat every principle here as binding architecture, not
> as advice.

---

## Table of Contents

1. Project Philosophy
2. Project Goals
3. The Architectural North Star (read this first)
4. Tech Stack
5. System Architecture Overview
6. Core Architectural Principles
7. The AI Orchestrator (the brain of the system)
8. Mission-Centric Design & the Mission Lifecycle
9. Tools as First-Class Units of Business Logic
10. The Tool Registry
11. Multi-Agent Architecture
12. RAG Architecture
13. The Framework Engine
14. Services Layer
15. Domain-Driven Design (DDD)
16. Event-Driven Architecture (EDA)
17. Plugin Architecture & Extensibility
18. Workspace-First UX
19. AI Transparency & Auditability
20. Multi-Tenancy & Enterprise Readiness
21. Naming Conventions
22. Coding Standards
23. Way of Working (Workflow)
24. Definition of Done
25. Glossary
26. Getting Started (Local Development & Partner Onboarding)

---

## 1. Project Philosophy

The AI GRC Assistant exists to make **Governance, Risk, and Compliance (GRC)** work
faster, more accurate, and auditable — not to replace human judgment, but to amplify it.
GRC is a high-stakes, regulated domain: a wrong control mapping or a hallucinated
citation can cost a customer an audit, a regulatory fine, or their license to operate.
Our philosophy follows from that reality.

- **Trust is the product.** Every AI output must be explainable, traceable to a source,
  and reproducible. We would rather say "I don't know" than guess.
- **Human-in-the-loop by default.** The assistant proposes; a qualified person decides.
  We never auto-apply consequential changes (risk acceptance, control sign-off, policy
  edits) without explicit human confirmation.
- **Boring where it matters.** In compliance code, predictability beats cleverness. We
  favor simple, well-tested, conventional solutions over novel ones.
- **Auditable by design.** Assume every action will one day be reviewed by an external
  auditor. Log decisions, inputs, model versions, and sources accordingly.
- **Security and privacy are not features.** They are constraints that bound every
  design. Customer compliance data is among the most sensitive data they own.
- **Ship small, ship safe.** Small reversible increments behind feature flags over large
  risky releases.
- **Built for thousands, not for one.** Every design decision assumes a global,
  multi-tenant platform serving thousands of organizations under different regulators.
  Nothing is hardcoded to a single customer, region, or framework.
- **The system is mission-driven, not chat-driven.** We are building an autonomous GRC
  workforce orchestrated toward outcomes — not a conversation window.

---

## 2. Project Goals

**Primary goal:** Provide an AI platform that helps GRC teams author, map, assess, and
monitor controls, policies, and risks across many frameworks (NCA ECC, SAMA, PDPL,
ISO 27001, NIST CSF, CIS, COBIT, COSO, and beyond), grounded in the customer's own
evidence and documentation, and executed as governed **missions** rather than ad-hoc
chats.

**Core capabilities (the "what"):**

- Ground answers in customer documents and framework libraries via **RAG**, always
  returning citations.
- Orchestrate **specialized AI agents** to perform multi-step GRC missions — control gap
  analysis, evidence collection, framework cross-mapping, questionnaire answering, policy
  authoring, risk assessment, reporting — with tool access and human approval gates.
- Expose every business capability as an independently callable **Tool**, usable by the
  Orchestrator, the API, the UI, the Workflow Engine, Scheduled Jobs, and Tests alike.
- Support many compliance **frameworks** through a configuration-driven Framework Engine,
  so new frameworks are added without architectural change.
- Surface risk insights, control coverage, and remediation suggestions with confidence
  levels and source provenance.

**Success criteria (the "good"):**

- **Accuracy & grounding:** answers are traceable to retrieved sources; no uncited claims
  on compliance matters.
- **Auditability:** every assistant action and agent decision is logged and
  reconstructable.
- **Latency:** interactive responses feel responsive; long missions stream progress.
- **Safety:** no consequential action executes without a human gate.
- **Extensibility:** a new framework, tool, or agent can be added without modifying the
  core architecture.
- **Scale:** the platform serves thousands of tenants with strict isolation and
  predictable performance.

**Explicit non-goals:**

- We do **not** provide legal advice or definitive compliance certification.
- We do **not** auto-remediate or auto-attest controls without human sign-off.
- We are **not** building a general-purpose chatbot; scope is GRC.
- We are **not** coupling the system to any single LLM provider, framework, or tenant.

---

## 3. The Architectural North Star (read this first)

Before any other section, internalize these non-negotiable pillars. They override
convenience, speed, and personal preference. Every PR is implicitly checked against them.

1. **The AI Orchestrator is the brain — not the LLM.** The LLM is a replaceable reasoning
   engine the Orchestrator calls. Intelligence, control, planning, memory, and policy
   live in the Orchestrator, never inside a raw model call.
2. **The system is Mission-Centric, not Chat-Centric.** The fundamental unit of work is a
   **Mission** with a goal, a plan, a lifecycle, and an audit trail. Chat is just one
   possible interface onto missions.
3. **Every business function is an independent, callable Tool.** No capability is locked
   inside a UI handler or an agent. The same Tool is invoked by the Orchestrator, the API,
   the UI, the Workflow Engine, Scheduled Jobs, and Tests.
4. **Agents are specialized, composable, and governed.** A team of focused agents
   (Knowledge, Policy, Compliance, Risk, Report, Workflow) collaborate under the
   Orchestrator instead of one monolithic prompt.
5. **Everything is grounded.** Factual GRC claims come from retrieval, carry citations,
   and expose confidence.
6. **Frameworks are data, not code.** The Framework Engine adds new standards through
   configuration. Adding NCA ECC v3 or a brand-new regulator must not require an
   architectural change.
7. **Multi-tenant, enterprise-grade, global by default.** Isolation, least privilege,
   regional data handling, and auditability are baked into every layer.
8. **Transparency is mandatory.** Every AI decision is explainable, traceable, and
   reproducible — what was retrieved, which model, which prompt version, which tools ran,
   and why.

9. **The LLM proposes; the schema decides; the database keeps the truth.**

   > **Claude could not make the database lie.**

   This is the relationship the whole architecture exists to produce, and it has been observed, not
   hoped for: a generator asked the model for sector questions using a type vocabulary the code had
   invented, the model dutifully produced it, and a `CHECK` constraint refused the insert. Nothing
   was stored, nothing was half-stored, and no reviewer was shown something the schema would not
   stand behind (ADR 0067).

   The corollary is a design rule, not a slogan. **State an invariant declaratively wherever it can
   be stated declaratively** — a constraint, a composite foreign key, a trigger — rather than as a
   Python guard that a second code path can forget. A model, a bug and a careless caller are the
   same threat to a compliance record, and only the database is in a position to refuse all three.

   Its companion, from the same work: *database constraints do not invent business rules; they
   reveal forgotten invariants.* When the database refuses something the code expected to work, the
   first question is not "how do I get past this constraint?" but "which invariant did we state in
   prose and never model?"

10. **The home page optimizes for the next governance action, never for the highest score.**

    > **A score is never the first thing, because a score is not a thing you can act on.**

    "Home page" here means the **home of the governance program experience** — the page a customer
    lands on to run their program. It is not a statement about every landing page in the product,
    and it is deliberately not licence to redesign one: the application's Home Dashboard, the
    navigation, and page names are outside this pillar's scope.

    Within that scope, the product exists to run a governance program, not to grade one. So the
    first thing shown is where the program stands and what to do about it — never a number, however
    impressive the number or however sophisticated the model behind it.

    The test, asked BEFORE building and not after: **does this help the customer manage their
    governance program?** If the answer is no, it does not belong in the program experience. Being
    AI-powered is not an exemption; a capability that looks intelligent and answers "no" is exactly
    how a focused surface turns into a mixture.

If a change violates any pillar above, it is wrong by definition — redesign it.

---

## 4. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| **Frontend** | Next.js (App Router) + TypeScript + React | Server Components by default; Client Components only when interactivity requires it. Workspace-first UX. |
| **UI** | Tailwind CSS + a component library (e.g. shadcn/ui) | Design tokens centralized; no ad-hoc inline styles. |
| **Frontend state/data** | TanStack Query for server state; minimal client state | Avoid global stores unless justified. |
| **Backend / API** | Python + FastAPI | Async at the API edge; the **frozen v2 mission/tool/event Core is synchronous** (ADR 0045/0039). Pydantic models at every boundary. |
| **AI Orchestration** | Internal AI Orchestrator service + agent framework | The Orchestrator owns planning, memory, tool routing, and policy. LLM SDKs sit behind it. |
| **LLM access** | LLM provider SDKs (e.g. Anthropic/OpenAI) behind a provider abstraction | Providers are swappable; business logic never imports an SDK directly. |
| **Vector store** | pgvector on Postgres (or a managed vector DB) | Keep retrieval close to the relational data when possible. |
| **Database** | PostgreSQL | Single source of truth for relational data. Migrations are mandatory. |
| **ORM / DB access** | **V2 Core (binding): synchronous psycopg3 + raw, fully parameterized SQL + hand-written `.sql` migrations applied as idempotent DDL** (`CREATE ... IF NOT EXISTS`, no apply-tracking ledger today — ADR 0045, supersedes ADR 0012 for V2). V1 used SQLAlchemy (async) + Alembic, and V1's `apps/web` has its own separate, real `schema_migrations` table (unrelated to V2). | Never string-interpolate values — always bind parameters. |
| **Workflow engine** | *Target:* durable workflow engine (e.g. Temporal) — **not yet built**. | V2 runs missions via the Mission Engine + Transactional Outbox (ADR 0042/0043); durable multi-worker execution is a future ADR. |
| **Eventing** | *Target:* message bus (e.g. Kafka/NATS). **V2 today: a synchronous, in-process `EventBus` + Transactional Outbox — no broker (ADR 0039/0043).** | EDA where decoupling earns its keep; events captured atomically to the outbox, relayed at-least-once. |
| **Auth** | OIDC / SSO + RBAC (and ABAC where needed) | Multi-tenant isolation enforced at the data layer. |
| **Background jobs** | *Target:* task queue (e.g. Celery/RQ/Arq) — **not yet built in V2**. | The autonomous dev team's 24/7 loop bootstraps on Claude Code scheduling → GitHub Actions → a worker service (ADR 0061). |
| **Infra** | Docker, IaC, CI/CD pipelines | Reproducible environments; no manual prod changes. |
| **Observability** | Structured logging + distributed tracing + LLM-call tracing | Every model call is traced with prompt, model version, tokens, latency, cost. |

**Stack rules:**

- The frontend never talks to the database directly; it goes through the FastAPI API.
- The AI layer is a service the backend calls — business logic does not import LLM SDKs
  directly.
- The Orchestrator, not the LLM, decides what runs. The LLM is a capability behind a
  provider abstraction.
- Pin dependency versions; upgrades are deliberate and reviewed.

---

## 5. System Architecture Overview

We follow a **layered, modular, mission-driven architecture**. Dependencies point inward;
the domain never depends on frameworks.

```
                          ┌──────────────────────────────────────────────┐
                          │                 INTERFACES                    │
                          │  Workspace UI · REST/GraphQL API · CLI · SDK  │
                          └───────────────────────┬──────────────────────┘
                                                  │  (all call Tools / Missions)
                          ┌───────────────────────▼──────────────────────┐
                          │              AI ORCHESTRATOR                  │
                          │   Mission planning · routing · memory ·       │
                          │   policy & guardrails · human-gate control    │
                          └───────┬───────────────────────────┬──────────┘
                                  │                           │
                  ┌───────────────▼───────────┐   ┌───────────▼───────────────┐
                  │      MULTI-AGENT LAYER     │   │      WORKFLOW ENGINE       │
                  │ Knowledge · Policy ·       │   │ durable missions, retries, │
                  │ Compliance · Risk ·        │   │ scheduled jobs, sagas      │
                  │ Report · Workflow agents   │   │                            │
                  └───────────────┬───────────┘   └───────────┬───────────────┘
                                  │                           │
                          ┌───────▼───────────────────────────▼──────────┐
                          │                 TOOL REGISTRY                 │
                          │  every business capability = a callable Tool  │
                          └───────────────────────┬──────────────────────┘
                                                  │
                          ┌───────────────────────▼──────────────────────┐
                          │                 SERVICES LAYER                │
                          │  application services orchestrating the domain│
                          └───────────────────────┬──────────────────────┘
                                                  │
                          ┌───────────────────────▼──────────────────────┐
                          │                  DOMAIN LAYER (DDD)           │
                          │  bounded contexts: Controls · Policies ·      │
                          │  Risks · Evidence · Frameworks · Missions     │
                          └───────────────────────┬──────────────────────┘
                                                  │
            ┌─────────────────────────────────────▼─────────────────────────────────────┐
            │                              INFRASTRUCTURE                                 │
            │  Postgres · pgvector/RAG · Event Bus · LLM providers · Object store · Auth  │
            └────────────────────────────────────────────────────────────────────────────┘
```

Read it top-down: interfaces request **missions**; the **Orchestrator** plans and routes;
**agents** reason; everything ultimately does work by calling **Tools**; Tools call
**Services**; Services operate the **Domain**; the Domain persists through
**Infrastructure**. The **Event Bus** connects layers asynchronously where decoupling is
required. The **Framework Engine** and **RAG** are cross-cutting capabilities exposed as
Tools and consumed by agents.

---

## 6. Core Architectural Principles

The dependency direction is `Interfaces → Orchestrator → Agents/Workflows → Tools →
Services → Domain → Infrastructure`. Dependencies point inward; the domain never depends
on frameworks.

1. **Separation of concerns.** Routing/validation (API), orchestration (Orchestrator),
   reasoning (Agents), capability execution (Tools), business rules (Services/Domain), and
   I/O (Infrastructure) live in distinct layers. No business logic in route handlers; no
   SQL in route handlers; no domain rules inside prompts.
2. **The Orchestrator is the brain.** Planning, control flow, memory, and policy live in
   the Orchestrator. The LLM is a swappable reasoning engine it calls — never the seat of
   control. (See §7.)
3. **Mission-Centric.** Work is modeled as governed Missions with a lifecycle, not as
   stateless chat turns. (See §8.)
4. **Tools are the universal unit of capability.** Every business function is an
   independent, schema-validated Tool callable from six entry points: Orchestrator, API,
   UI, Workflow Engine, Scheduled Jobs, and Tests. (See §9–10.)
5. **AI as an isolated, swappable layer.** All retrieval, prompting, and agent logic sits
   behind well-defined interfaces. Swapping a model or vector store does not touch business
   code. Prompts are versioned artifacts, not inline literals.
6. **Grounding over generation.** The default path for any factual GRC claim is
   retrieve-then-generate. Outputs carry citations and a confidence signal. (See §12.)
7. **Frameworks are configuration, not code.** The Framework Engine ingests standards as
   data; new frameworks need no architectural change. (See §13.)
8. **Determinism at the edges.** Validate and constrain all model inputs/outputs with
   schemas (Pydantic / structured outputs). Never trust raw LLM text as control flow
   without validation.
9. **Human approval gates.** Any agent or tool action with side effects (writes, external
   calls, state changes) passes through an explicit approval step. This is a first-class
   concept, not an afterthought.
10. **Multi-tenancy & least privilege.** Every query is tenant-scoped. A request can only
    ever reach data the authenticated user is authorized for. Default deny. (See §20.)
11. **Statelessness where possible.** API and agent services are stateless; durable state
    lives in Postgres, the cache, the event log, or the workflow engine — enabling
    horizontal scale to thousands of tenants.
12. **Idempotency & retries.** Ingestion, tool calls, agent steps, and mission steps are
    idempotent and safe to retry.
13. **Event-driven where it helps.** Cross-context communication and long-running side
    effects flow through events, not tight synchronous coupling. (See §16.)
14. **Extensible by design.** New tools, agents, and frameworks are added via registries
    and plugins, not by editing core control flow. (See §17.)
15. **Observability is built in.** Structured logs, trace IDs across the
    interface → orchestrator → agent → tool → service chain, and full LLM-call audit
    records.
16. **Fail safe, not open.** On uncertainty or error in a compliance-relevant path, stop
    and ask a human rather than proceeding.

---

## 7. The AI Orchestrator (the brain of the system)

**Principle: The AI Orchestrator is the brain of the system — not the LLM.** The LLM is a
reasoning engine the Orchestrator rents per call. All durable intelligence — planning,
control flow, memory, routing, policy enforcement, and human gating — lives in the
Orchestrator.

> **V2 vocabulary (ADR 0042 §12.8).** In the V2 implementation this "brain" role — planning,
> routing, lifecycle, and gates — is realized by the **Mission Engine**. The package named
> `ai-orchestrator` (ADR 0038) is the per-step *pipeline runner* (one grounded answer), **not**
> this brain. The autonomous dev team's **Foreman** (ADR 0061) is a planner at the
> Mission-Engine altitude, not inside `ai-orchestrator`.

**Responsibilities of the Orchestrator:**

- **Mission planning & decomposition.** Turn a mission goal into a plan of steps, each
  mapped to an agent and/or a set of Tools.
- **Routing.** Decide which agent or tool handles each step. The Orchestrator owns this
  routing logic; the LLM may *suggest*, but the Orchestrator *decides* and validates.
- **Memory.** Maintain short-term (working) and long-term (mission/tenant) memory with
  clear scoping and retention rules. Memory is tenant-isolated.
- **Policy & guardrails.** Enforce safety, budget (tokens/cost/time), tenancy, and
  compliance policy on every step. Block or escalate when a guardrail trips.
- **Human-gate control.** Pause missions at approval gates, surface the proposed action
  and its evidence, and resume only on explicit human decision.
- **Provider abstraction.** Call LLMs through a provider-agnostic interface, with
  fallback, retry, and cost/latency budgets. Models are swappable without touching agents
  or tools.
- **State & recovery.** Persist mission state so a mission can be paused, resumed,
  retried, audited, or replayed deterministically.

**Hard rules:**

- Business logic never calls an LLM directly — it asks the Orchestrator (or a Tool) for an
  outcome.
- The LLM never has unmediated authority to mutate state. Side effects only happen through
  Tools, behind validation and human gates.
- Every Orchestrator decision (plan, route, model, prompt version, tools invoked, gate
  outcome) is logged for audit and reproducibility. (See §19.)

---

## 8. Mission-Centric Design & the Mission Lifecycle

**Principle: The system is Mission-Centric, not Chat-Centric.** The fundamental unit of
work is a **Mission** — a goal-directed, governed, auditable unit of GRC work
(e.g. "Perform a SOC 2 gap analysis for tenant X against the current evidence set"). Chat
is merely one interface that can *open* or *steer* a mission.

**A Mission is a first-class domain entity** with: a tenant, an owner, a goal, a plan, a
set of steps, the agents/tools it used, its inputs and outputs, citations, approval gates,
status, and a full event/audit history.

### Mission Lifecycle

Every mission moves through an explicit, observable lifecycle. Each transition emits an
event and is recorded for audit.

1. **Created** — a mission is opened (by UI, API, schedule, or another mission) with a
   goal and context. Tenant and authorization are bound here.
2. **Planned** — the Orchestrator decomposes the goal into a step plan, selecting agents
   and tools. The plan is inspectable before execution.
3. **Executing** — steps run via agents and Tools. Progress streams to the workspace.
   Long-running work is handled by the Workflow Engine with retries and durable state.
4. **Awaiting Approval (Human Gate)** — when a step proposes a consequential action, the
   mission pauses, surfaces the proposal with grounded evidence, and waits for a human
   decision. Nothing consequential proceeds without it.
5. **Resumed / Re-planned** — on approval, edits, or new information, the Orchestrator may
   resume or re-plan remaining steps.
6. **Completed** — the mission reaches its goal; outputs, citations, and the decision
   trail are finalized and stored.
7. **Failed / Cancelled** — on unrecoverable error or human cancellation, the mission
   stops **fail-safe**: no partial consequential changes are left applied; state is
   consistent and fully logged.
8. **Archived / Auditable** — the mission and its complete history remain reconstructable
   for external audit indefinitely (subject to retention policy).

**Rules:**

- Missions are **resumable, replayable, and idempotent**. A retried step must not double-
  apply side effects.
- Every mission is **tenant-scoped** and carries its authorization context end to end.
- Missions are the primary audit object: an auditor can replay exactly what happened, with
  what inputs, models, prompts, retrieved sources, and approvals.

---

## 9. Tools as First-Class Units of Business Logic

**Principle: Every business function must be an independent, callable Tool.** A "Tool" is a
self-contained, schema-validated capability (e.g. `analyze_control_gap`,
`map_frameworks`, `retrieve_evidence`, `generate_policy_draft`, `assess_risk`,
`render_report`). Tools are where business capabilities live — not inside UI handlers,
agents, or prompts.

**The Six Callers.** Every Tool is invocable, with identical semantics, from:

1. **AI Orchestrator** — as a step in a mission plan.
2. **API** — exposed as a REST/GraphQL endpoint for programmatic and partner use.
3. **UI** — invoked from the workspace for direct, human-driven actions.
4. **Workflow Engine** — as a node in a durable workflow/saga.
5. **Scheduled Jobs** — run on a cron/schedule for monitoring, re-assessment, digests.
6. **Tests** — called directly in unit/integration/eval tests with no UI or LLM needed.

This is what makes the platform composable, testable, and automatable. If a capability
cannot be called by all six, it is not yet a proper Tool — refactor it.

**Tool contract (mandatory):**

- **Typed input & output schemas** (Pydantic). Inputs validated before execution; outputs
  validated before return.
- **Pure capability boundary.** A Tool does one cohesive thing and declares its
  side-effect profile (read-only vs. consequential).
- **Tenant & auth context** is a required part of every Tool invocation.
- **Idempotency.** Consequential Tools accept an idempotency key and are safe to retry.
- **Human-gate awareness.** Consequential Tools declare that they require approval; the
  Orchestrator/Workflow enforces the gate.
- **Observability.** Every invocation logs inputs (or hashes), outputs, caller, tenant,
  latency, and (for AI tools) model/prompt versions and retrieved source IDs.
- **No hidden coupling.** Tools depend on the Services Layer, never directly on a route
  handler, a specific UI, or an LLM SDK.

---

## 10. The Tool Registry

**Principle: Tools are discovered and invoked through a central Tool Registry.** The
Registry is the catalog of every capability in the platform and the mechanism by which the
Orchestrator, agents, API, UI, workflows, jobs, and tests find and call Tools.

**The Registry provides:**

- **Registration & discovery.** Tools register a unique name, version, description,
  input/output schema, side-effect profile, required permissions, and cost/latency hints.
- **Versioning.** Tools are versioned (`map_frameworks.v2`); callers can pin versions.
  Breaking changes ship as new versions.
- **Capability metadata for the Orchestrator.** The Orchestrator reads the Registry to
  plan missions — it knows what Tools exist, what they need, and what they affect.
- **Access control.** The Registry **carries** each Tool's `required_roles` as *declarative
  metadata*; it does not evaluate them. Authorization is **enforced in the Application/command
  layer** (ADR 0054), with tenant scope on every invocation — the Registry stays a pure catalog
  (ADR 0006/0049).
- **Auditability.** Every registration and invocation is traceable.
- **Plugin entry point.** New Tools (including third-party/plugin Tools) appear in the
  system by registering here — no core code change required. (See §17.)

**Rule:** Nothing calls a capability "out of band." If it's a business function, it's in
the Registry. The Registry is the single source of truth for what the platform can *do*.

---

## 11. Multi-Agent Architecture

**Principle: Specialized agents collaborate under the Orchestrator** — not one monolithic
prompt. Each agent is a focused reasoning unit with a clear responsibility, its own
prompt set, and access to a scoped subset of Tools. The Orchestrator composes them into
missions.

**The standard agent roster:**

- **Knowledge Agent** — owns retrieval and grounding. Answers "what do we know?" by
  querying the RAG layer and the Framework Engine, returning cited, confidence-scored
  knowledge. The grounding specialist other agents rely on.
- **Policy Agent** — authors, reviews, and maps **policies**. Drafts policy text grounded
  in frameworks and customer context, aligns policies to control requirements, and flags
  gaps or contradictions.
- **Compliance Agent** — performs **control and compliance** work: gap analysis, control
  mapping, questionnaire answering, evidence sufficiency checks, and coverage assessment
  against one or more frameworks.
- **Risk Agent** — performs **risk** identification, assessment, scoring, and remediation
  suggestions, tying risks to controls and evidence with confidence and provenance.
- **Report Agent** — assembles **deliverables**: audit-ready reports, executive summaries,
  evidence packs, and framework attestations — always with citations and traceable
  sources.
- **Workflow Agent** — drives **multi-step processes**: orchestrating long-running
  workflows, scheduling re-assessments, coordinating approvals and hand-offs across the
  other agents and the Workflow Engine.

> **Second roster — the platform dev team (ADR 0061).** The roster above serves the GRC
> *product*. The same multi-agent pattern is realized for *platform engineering* by an
> autonomous dev team — **Foreman, QA, Monitor, Security, Developer, Reviewer** — that maintains
> this codebase as governed Missions on the frozen v2 Core. New agents in either roster are added
> by ADR + registry, never by editing the core (§17).

**Rules for agents:**

- Agents act **only through Tools** in the Registry; they do not perform side effects
  directly.
- Agents are **composable**: a mission may chain several agents (e.g. Knowledge → Risk →
  Report).
- Agents are **scoped**: each agent's tool access, data access, and budget are least-
  privilege and tenant-bound.
- Agents are **governed**: every agent runs under the Orchestrator's policy, guardrails,
  and human gates. No agent self-authorizes a consequential action.
- Agents are **swappable and extensible**: new agents (e.g. an Audit Agent, a Vendor-Risk
  Agent) can be added without restructuring the system, by registering the agent and the
  Tools it needs.
- Every agent decision is **transparent and logged**: inputs, retrieved sources, model and
  prompt versions, tools invoked, and outputs. (See §19.)

---

## 12. RAG Architecture

**Principle: Grounding is achieved through a well-defined RAG (Retrieval-Augmented
Generation) architecture.** No factual GRC claim is generated without retrieval. RAG is a
first-class subsystem, exposed to agents as Tools.

### 12.1 Ingestion pipeline

1. **Source intake.** Customer documents (policies, evidence, prior reports) and framework
   libraries enter through an ingestion Tool. Each source is tenant-tagged and access-
   controlled at intake.
2. **Parsing & normalization.** Documents are parsed into clean text with structure
   preserved (headings, sections, tables). Format-specific extractors handle PDF, DOCX,
   XLSX, etc.
3. **Chunking.** Content is split into retrieval units with sensible boundaries (semantic/
   section-aware), preserving metadata (source, section, page, framework reference).
4. **Embedding.** Chunks are embedded via a provider-abstracted embedding model and stored
   with their metadata.
5. **Indexing.** Vectors are stored in **pgvector/Postgres** (or a managed vector DB)
   alongside relational metadata, enabling **hybrid retrieval** (vector + keyword +
   metadata filters). Indexing is idempotent and re-runnable.

### 12.2 Retrieval pipeline

1. **Query construction.** The Knowledge Agent (via the Orchestrator) builds a retrieval
   query from the mission step, scoped by **tenant** and, where relevant, by framework,
   document type, or control.
2. **Hybrid search.** Combine semantic (vector) similarity with keyword and metadata
   filters. Always filter by `tenant_id` first — retrieval is strictly tenant-isolated.
3. **Re-ranking.** Candidate chunks are re-ranked for relevance before being passed to
   generation.
4. **Context assembly.** Selected chunks, with their source metadata, are assembled into a
   bounded context window under a token budget.
5. **Grounded generation.** The LLM generates an answer **constrained to** the retrieved
   context, producing **structured output** that includes the claim, the **citations**
   (source IDs, sections), and a **confidence signal**.
6. **Validation.** Output is schema-validated. Uncited factual claims on compliance matters
   are rejected; on low confidence or thin evidence, the system says "insufficient
   evidence" and escalates rather than guessing.

### 12.3 RAG rules

- **Tenant isolation is absolute.** A retrieval can never cross tenant boundaries.
- **Citations are mandatory** for factual GRC output; provenance (which source, which
  section) travels with every claim.
- **Confidence is surfaced**, not hidden. Low confidence triggers a human gate.
- **Reproducibility.** Retrieved source IDs, embedding/model versions, and prompt versions
  are logged so any answer can be reconstructed and audited. (See §19.)
- **Swappability.** Embedding models, vector stores, chunking, and re-ranking strategies
  sit behind interfaces and can change without touching agents or business code.

---

## 13. The Framework Engine

**Principle: Compliance frameworks are data, not code.** The Framework Engine is a
configuration-driven subsystem that represents any compliance standard as structured data
(domains, controls, requirements, mappings, evidence expectations). Adding or updating a
framework is a data/config operation — **never an architectural change**.

**Frameworks supported (initial set), all through the same engine:**

- **NCA ECC** — Saudi National Cybersecurity Authority, Essential Cybersecurity Controls.
- **SAMA** — Saudi Central Bank cybersecurity/compliance framework.
- **PDPL** — Saudi Personal Data Protection Law.
- **ISO 27001** — Information security management.
- **NIST CSF** — NIST Cybersecurity Framework.
- **CIS** — CIS Critical Security Controls.
- **COBIT** — Governance and management of enterprise IT.
- **COSO** — Internal control / enterprise risk management.
- **Any future framework** — added by providing its structured definition, with **zero
  architectural change**.

**The Framework Engine provides:**

- **A canonical framework model.** A common internal representation so every framework —
  regional or international — is expressed uniformly (framework → domains → controls →
  requirements → evidence expectations).
- **Cross-framework mapping.** First-class control-to-control mappings (e.g. ISO 27001 ↔
  NIST CSF ↔ NCA ECC), so evidence and controls satisfy multiple frameworks at once and
  gaps are computed across frameworks.
- **Versioning.** Frameworks evolve; each version is tracked, and assessments pin the
  framework version they ran against for audit integrity.
- **Localization & regionalization.** Multilingual framework content (including Arabic for
  NCA/SAMA/PDPL) and region-aware handling.
- **Tool & agent integration.** The engine is exposed to the Compliance, Policy, Risk, and
  Knowledge agents as Tools (e.g. `get_framework`, `map_frameworks`,
  `compute_coverage`), and feeds the RAG layer's framework library.

**Hard rule:** No framework name is hardcoded into control flow. If adding a framework
requires touching core code rather than supplying configuration/data, the Framework Engine
has a bug — fix the engine, not the caller.

---

## 14. Services Layer

**Principle: A dedicated Services Layer mediates between Tools and the Domain.** Services
are application-level orchestrators of domain logic; they coordinate domain objects,
transactions, and infrastructure to fulfill a use case.

- **Tools call Services; Services operate the Domain.** A Tool is a thin, well-typed
  capability boundary; the real coordination (transactions, multi-entity workflows,
  invariants) lives in Services.
- **Services are framework-agnostic and reusable.** The same Service can back multiple
  Tools or API endpoints.
- **Repository pattern for data access.** Services use repositories; no ORM queries leak
  into Tools, route handlers, or the Domain's pure logic.
- **Transaction boundaries live in Services.** Services own units of work and ensure
  consistency; they emit domain events on meaningful state changes. (See §16.)
- **No business rules in route handlers or prompts.** Routing/validation is the API's job;
  rules belong to the Domain and their coordination to Services.

---

## 15. Domain-Driven Design (DDD)

**Principle: The Domain is modeled with DDD.** The business — GRC — drives the model, not
the database or the framework du jour.

- **Bounded contexts.** The system is divided into clear contexts, each with its own model
  and ubiquitous language, for example: **Controls**, **Policies**, **Risks**,
  **Evidence**, **Frameworks**, **Missions**, **Tenancy/Identity**, **Reporting**.
- **Ubiquitous language.** Code, APIs, and conversations use the same GRC vocabulary
  (Control, Framework, Evidence, Risk, Mission, Citation). The Glossary (§25) is the shared
  dictionary.
- **Aggregates & invariants.** Each context defines aggregates (e.g. a Control with its
  evidence and mappings) that enforce their own invariants. State changes go through the
  aggregate root.
- **Domain purity.** The Domain layer contains business rules and entities with **no
  dependency on FastAPI, SQLAlchemy, LLM SDKs, or any framework**. It is independently
  testable.
- **Anti-corruption layers.** External inputs (LLM output, third-party connectors,
  framework imports) are translated into clean domain models at the boundary; raw external
  shapes never leak inward.
- **Context mapping.** Relationships between contexts are explicit (e.g. how Missions use
  Controls and Evidence), communicated via Services and events rather than shared mutable
  state.

---

## 16. Event-Driven Architecture (EDA)

**Principle: Use Event-Driven Architecture where decoupling, async, or fan-out is
needed** — not everywhere, but deliberately where it earns its keep.

- **Domain events.** Meaningful state changes emit events (`ControlAssessed`,
  `EvidenceIngested`, `MissionCompleted`, `RiskAccepted`). Events are immutable facts.
- **When to use events.** Cross-context reactions, long-running side effects, notifications,
  audit streaming, re-indexing, scheduled re-assessment triggers, and anything that should
  not block the request path.
- **When NOT to use events.** Simple synchronous reads/writes within one transaction —
  don't add an event bus where a direct call is clearer and consistent.
- **Reliability.** Event processing is idempotent and at-least-once; consumers tolerate
  duplicates and out-of-order delivery. Use an outbox or equivalent to avoid losing events
  on failure.
- **Auditability.** The event log is itself an audit asset: the history of what happened in
  a tenant can be reconstructed from events.
- **Tenancy.** Every event carries tenant context; consumers stay tenant-scoped.

---

## 17. Plugin Architecture & Extensibility

**Principle: The platform is extensible through a Plugin Architecture.** New capabilities
are *added*, not *patched in*. Growth happens at the edges via registries and plugins, not
by editing core control flow.

- **Tools as plugins.** New Tools (including third-party/partner ones) are added by
  implementing the Tool contract and registering them in the **Tool Registry** (§10). The
  Orchestrator discovers them automatically.
- **Agents as plugins.** New agents register themselves and declare the Tools and data
  scopes they need. The Orchestrator can compose them into missions without core changes.
- **Frameworks as plugins.** New compliance frameworks are added as data to the **Framework
  Engine** (§13) — no code change.
- **Connectors as plugins.** Integrations (evidence sources, ticketing, identity, cloud
  posture) plug in behind connector interfaces, with an anti-corruption layer translating
  external data into domain models.
- **Isolation & safety.** Plugins run with least privilege, declared permissions, resource
  budgets, and tenant scoping. A plugin can never bypass the Orchestrator's policy, human
  gates, or tenant isolation.
- **Versioning & compatibility.** Plugins declare versions and compatibility; the platform
  can run multiple versions and deprecate safely.

**Rule:** If extending the platform requires editing the core (Orchestrator, Services,
Domain) rather than adding a registered Tool/Agent/Framework/Connector, treat it as a
design smell and reconsider.

---

## 18. Workspace-First UX

**Principle: The experience is Workspace-First, not chat-first.** Users live in a
**workspace** — a structured environment for GRC work — where missions, controls, policies,
risks, evidence, and reports are first-class, navigable objects. Conversation is one tool
inside the workspace, not the whole product.

- **Missions are visible and steerable.** Users see a mission's goal, plan, progress,
  approval gates, citations, and outputs — and can intervene at any step.
- **Objects over transcripts.** Controls, risks, policies, evidence, and reports are
  durable, linkable artifacts the user can browse, filter, and act on — not messages that
  scroll away.
- **Human gates are part of the UX.** Approvals, edits, and sign-offs are explicit,
  ergonomic interactions surfaced in context with the evidence behind them.
- **Streaming progress.** Long missions stream their progress into the workspace so work is
  observable, not a black box.
- **Explainability in the UI.** Every AI output shows its sources, confidence, and the
  decision trail (see §19) directly where the user reviews it.
- **Frontend rules.** Server Components by default; explicit loading/empty/error states;
  presentational components with logic in hooks/services; accessible and localized
  (including RTL/Arabic for regional frameworks).

---

## 19. AI Transparency & Auditability

**Principle: Every AI action is transparent, explainable, traceable, and reproducible.**
Transparency is not a feature toggle — it is a requirement of operating in a regulated
domain.

For **every** AI-driven step, the system records and can surface:

- **What was asked** — the mission/step goal and the resolved inputs (or hashes for
  sensitive data).
- **What was retrieved** — the exact source IDs, sections, and framework references used
  for grounding.
- **Which model & prompt** — provider, model name + version, and the **versioned prompt**
  used.
- **Which tools ran** — every Tool invocation, its inputs/outputs, and side-effect profile.
- **Confidence & citations** — the confidence signal and the citations backing each claim.
- **Cost & performance** — tokens, latency, and cost per call.
- **Decisions & gates** — what the Orchestrator decided, and every human approval/rejection
  with who and when.

**Rules:**

- **Reproducibility.** Given the logged inputs, versions, and retrieved sources, an
  auditor can reconstruct how an output was produced.
- **No raw chain-of-thought to end users.** We expose grounded reasoning, sources, and
  decisions — not internal hidden reasoning or raw prompts.
- **Treat LLM output as untrusted input.** Validate, sanitize before rendering, never
  `eval`, and guard against prompt injection from retrieved documents.
- **Tamper-evident audit trail.** Audit records are append-only and tenant-scoped, suitable
  for external review.

---

## 20. Multi-Tenancy & Enterprise Readiness

**Principle: This is a global, multi-tenant Enterprise SaaS platform built to serve
thousands of organizations.** Every layer assumes many tenants, many regulators, and
strict isolation.

- **Tenant isolation is absolute.** Every query, retrieval, event, mission, memory, and
  log is tenant-scoped. Default deny. Cross-tenant access is impossible by construction,
  not by convention.
- **Identity & access.** OIDC/SSO with RBAC (and ABAC where needed). Least privilege for
  users, agents, tools, and plugins alike.
- **Data residency & regionalization.** Support regional data handling and localization
  (e.g. Arabic and KSA-specific frameworks like NCA ECC, SAMA, PDPL) so the platform serves
  customers under different regulators.
- **Scalability.** Stateless services, async jobs, a durable workflow engine, and an event
  bus enable horizontal scale to thousands of tenants with predictable performance.
- **Reliability & recovery.** Idempotent operations, retries, durable mission state, and
  backups/disaster-recovery posture appropriate to enterprise SLAs.
- **Security posture.** Encryption in transit and at rest, secret management, dependency
  and secret scanning in CI, least-privilege infra access, and threat modeling for any
  feature touching auth, tenancy, or data egress.
- **Compliance hygiene (we eat our own dog food).** The platform itself is built to be
  auditable and compliant with the standards it helps customers meet.

---

## 21. Naming Conventions

Consistency lets anyone read unfamiliar code quickly. These are mandatory.

**General:**

- Names describe intent, not implementation. `pendingControlReviews`, not `list2`.
- No unexplained abbreviations. `evidence`, not `evd`. (GRC acronyms like SOC2, NIST, NCA,
  SAMA, PDPL are fine.)
- Booleans read as predicates: `isCompliant`, `hasEvidence`, `canApprove`.

**Python (backend / AI):**

- `snake_case` for variables, functions, modules. `PascalCase` for classes. `UPPER_SNAKE`
  for constants.
- Pydantic models: `PascalCase`, suffixed by role — `ControlRequest`, `ControlResponse`,
  `RiskRecord`.
- Async functions that do I/O are named for the action: `fetch_controls`,
  `embed_document`.
- Files/modules: `snake_case.py`. One cohesive responsibility per module.

**TypeScript / React (frontend):**

- `camelCase` for variables/functions, `PascalCase` for components and types/interfaces.
- React components: `PascalCase` files (`ControlTable.tsx`); hooks: `useThing`
  (`useControls.ts`).
- Types/interfaces describe the shape: `Control`, `RiskAssessment`, `Citation`, `Mission`.

**Database (Postgres):**

- `snake_case`, tables **plural** (`controls`, `risk_assessments`, `missions`), columns
  singular.
- Primary keys `id`; foreign keys `<entity>_id` (`framework_id`, `mission_id`).
- Timestamps `created_at`, `updated_at`. Every tenant-scoped table has `tenant_id`.

**API:**

- REST resources are plural nouns, kebab/lowercase: `/api/v1/risk-assessments`,
  `/api/v1/missions`.
- Version the API (`/v1/`). Breaking changes get a new version.

**AI & platform artifacts:**

- Prompts and prompt templates are named and versioned: `control_gap_analysis.v3`.
- Agents have descriptive registered names: `knowledge_agent`, `compliance_agent`,
  `risk_agent`, `report_agent`, `policy_agent`, `workflow_agent`.
- Tools have descriptive, action-oriented registered names and versions:
  `analyze_control_gap.v2`, `map_frameworks.v1`, `retrieve_evidence.v1`.
- Frameworks are referenced by stable identifiers, not magic strings scattered in code:
  `framework:nca_ecc`, `framework:iso_27001`.
- Events are past-tense facts: `ControlAssessed`, `MissionCompleted`, `EvidenceIngested`.

---

## 22. Coding Standards

**Universal:**

- **Type everything.** TypeScript `strict` mode on; Python fully type-hinted and checked
  (mypy/pyright). No `any` / no untyped public functions without justification.
- **Validate at boundaries.** Every external input (HTTP, LLM output, file, third-party,
  tool input) is validated with a schema before use.
- **Small functions, single responsibility.** If a function needs a paragraph to explain,
  split it.
- **No magic values.** Use named constants/enums — including framework identifiers and tool
  names.
- **Errors are explicit.** Catch narrowly, fail loudly in dev, fail safe in prod, log with
  context. Never swallow exceptions silently.
- **Comments explain *why*, not *what*.** The code says what; comments capture intent,
  trade-offs, and links to requirements.
- **No secrets in code.** Config and secrets come from environment/secret manager only.

**Python / FastAPI:**

- Async at the API edge. **The frozen v2 mission/tool/event Core is synchronous** (sync psycopg3,
  in-process bus — ADR 0045/0039); do not add async to it. Pydantic for request/response models
  and settings.
- Dependency injection via FastAPI `Depends` for db sessions, auth, tenancy, and services.
- Repository pattern for data access; no ORM queries in route handlers or in the Domain's
  pure logic.
- Follow PEP 8; formatting and linting are enforced (e.g. Ruff/Black) — not debated.

**TypeScript / Next.js:**

- Server Components by default; mark Client Components intentionally.
- Co-locate components with their tests and styles. Keep components presentational; push
  logic into hooks/services.
- Handle loading, empty, and error states explicitly — never assume the happy path.
- Lint/format enforced (ESLint + Prettier). Support localization and RTL where needed.

**AI-specific:**

- Prompts live in versioned, reviewable files — never hardcoded inline in business logic.
- Business logic and agents call the **Orchestrator/Tools**, never an LLM SDK directly.
- Always request **structured outputs** where a result drives logic; validate before use.
- Set token/cost/timeout budgets per call; degrade gracefully on failure.
- Record every model call: prompt version, model + version, inputs (or hashes), outputs,
  tokens, latency, cost, and retrieved source IDs.
- Never expose raw chain-of-thought or internal prompts to end users.
- Treat all LLM output as untrusted input: sanitize before rendering, never `eval`,
  guard against prompt injection from retrieved documents.

**Tool & Agent standards:**

- Every Tool implements the Tool contract (§9): typed I/O, tenant/auth context, idempotency
  for consequential actions, side-effect declaration, observability, and Registry
  registration.
- Every Tool is callable by all six callers (§9) and has tests that call it directly.
- Agents act only through registered Tools; no agent performs side effects directly or
  self-authorizes a consequential action.

**Testing standards:**

- Unit tests for domain/business logic. Integration tests for API + DB. Contract tests at
  the AI-service and Tool boundaries.
- **Tools are tested directly** as one of their six callers — no UI or live LLM required.
- AI components get **evaluation tests** (eval sets with expected behaviors / graded
  rubrics), not just unit tests — accuracy and grounding are regression-tested.
- **Missions get end-to-end tests** across their lifecycle, including human-gate and
  failure/cancellation paths.
- Deterministic tests: mock LLM/vector calls in unit tests; run eval suites separately.

---

## 23. Way of Working (Workflow)

**Branching & commits:**

- Trunk-based with short-lived feature branches: `feat/`, `fix/`, `chore/`, `docs/`.
- **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`). Commit
  messages explain the why.
- Small, focused PRs. A PR should be reviewable in one sitting.

**Pull requests:**

- Every change goes through a PR with at least one reviewer. No direct pushes to main.
- PR description states *what*, *why*, and *how to test*. Link the issue/ticket.
- CI must be green (lint, type-check, tests, build, security scan) before merge.
- Self-review first: read your own diff before requesting review.

**AI-assisted development:**

- AI-generated code is held to the same bar as human code — reviewed, tested, understood.
  No merging code you can't explain.

**Issue tracking:**

- Work is tracked as issues/tickets with clear acceptance criteria. No untracked work in
  main.

**Releases & environments:**

- Environments: local → staging → production. Nothing reaches prod without passing
  staging.
- Ship behind **feature flags**; consequential GRC features roll out gradually.
- Migrations are reviewed, reversible where possible, and run via CI/CD — never by hand in
  prod.

**Architecture governance:**

- Document architecturally significant decisions as short **ADRs** in the repo.
- Any change to the pillars in §3, the Tool contract, the agent roster, the Framework
  Engine model, or the Mission Lifecycle requires an ADR and an update to this file.
- New Tools, Agents, Frameworks, and Plugins are added through their registries/engines —
  reviewers reject changes that bypass them.

**Performance:**

- **Performance debt is created only by measured production queries, never by imagined future
  scale.** No index, cache, denormalisation or partition enters the codebase without either a
  query in the product that uses it, or an `EXPLAIN` proving it will be used. Every one of them is
  permanent debt — write cost, storage, maintenance, and a new branch in every execution plan — so
  the burden of proof is on adding, not on omitting. Before justifying one, check whether the
  query is already served by a smaller table.

**Security & compliance hygiene (we eat our own dog food):**

- Dependency and secret scanning in CI. Least-privilege access to all environments.
- Threat-model any feature touching auth, tenancy, or data egress before building it.

---

## 24. Definition of Done

A task is **Done** only when **all** of the following are true. "It works on my machine"
is not Done.

- [ ] Acceptance criteria in the issue are met.
- [ ] Code follows this document's architecture, naming, and coding standards.
- [ ] Fully typed; type-check, lint, and format pass with no new warnings.
- [ ] Tests written and passing: unit + integration as appropriate; **eval tests for any
      AI-affecting change**; **Tools tested directly**; **mission lifecycle tested** where
      relevant.
- [ ] All inputs validated at boundaries; errors handled and logged with context.
- [ ] Security & tenancy checked: tenant-scoped queries, authz enforced, no secrets in
      code, no new injection surface.
- [ ] **Architecture honored:** business logic exposed as a registered Tool where
      applicable; agents act only through Tools; no LLM SDK called from business logic; no
      framework name hardcoded into control flow.
- [ ] **AI grounding & auditability:** AI outputs are cited, structured outputs validated,
      confidence surfaced, and model/prompt/tool/source calls logged. No consequential
      action without a human gate.
- [ ] **Mission integrity (if applicable):** lifecycle transitions emit events, are
      idempotent/resumable, and fail safe.
- [ ] Observability added: meaningful logs/traces for new code paths across the
      interface → orchestrator → agent → tool → service chain.
- [ ] Docs updated: README/ADR/API docs and **this CLAUDE.md if conventions or architecture
      changed**.
- [ ] DB migration included and reversible (if schema changed).
- [ ] Reviewed and approved via PR; CI fully green.
- [ ] No TODOs left in merged code without a linked tracking issue.

---

## 25. Glossary

- **GRC** — Governance, Risk, and Compliance.
- **AI Orchestrator** — The brain of the system: plans, routes, remembers, enforces policy
  and human gates, and calls the LLM as a swappable reasoning engine.
- **Mission** — The fundamental unit of work: a governed, auditable, goal-directed GRC task
  with a full lifecycle.
- **Mission Lifecycle** — The explicit states a mission moves through: Created → Planned →
  Executing → Awaiting Approval → Resumed/Re-planned → Completed / Failed / Archived.
- **Tool** — An independent, schema-validated business capability callable from the
  Orchestrator, API, UI, Workflow Engine, Scheduled Jobs, and Tests.
- **Tool Registry** — The central catalog through which Tools are registered, discovered,
  versioned, access-controlled, and invoked.
- **Agent** — A specialized, governed reasoning unit (Knowledge, Policy, Compliance, Risk,
  Report, Workflow) that acts only through Tools under the Orchestrator.
- **RAG** — Retrieval-Augmented Generation: ground answers in retrieved sources via the
  ingestion and retrieval pipelines.
- **Framework Engine** — The configuration-driven subsystem that represents any compliance
  framework as data and maps controls across frameworks.
- **Framework** — A compliance standard (NCA ECC, SAMA, PDPL, ISO 27001, NIST CSF, CIS,
  COBIT, COSO, …).
- **Control** — A safeguard/measure that meets a requirement of a framework.
- **Evidence** — Artifacts proving a control is operating.
- **Grounding** — Tying generated output to verifiable retrieved sources.
- **Human-in-the-loop** — A required human approval step before a consequential action.
- **Services Layer** — Application-level orchestrators of domain logic, sitting between
  Tools and the Domain.
- **DDD** — Domain-Driven Design: modeling the system around GRC bounded contexts and a
  ubiquitous language.
- **EDA** — Event-Driven Architecture: decoupled, async communication via domain events
  where it earns its keep.
- **Plugin Architecture** — The extensibility model: new Tools, Agents, Frameworks, and
  Connectors are added via registries/engines without changing the core.
- **Multi-Tenant** — A single platform serving thousands of isolated organizations, with
  tenant scoping enforced at every layer.
- **Workspace** — The structured, object-centric environment where users run and steer
  missions — the primary UX, with chat as one tool inside it.

---

## 26. Getting Started (Local Development & Partner Onboarding)

This section is the practical companion to everything above: how to get the product
running on your machine. It does not restate the architecture — read §3–§5 for that.

**What you'll actually run.** This is a large monorepo with several generations of work
(`v2/`, `v3/`, `devteam/`) that are internal platform/architecture tracks governed by their
own ADRs — you do not need them to see or test the product. The live, running application
is **`apps/web`** (Next.js 15 + PostgreSQL/pgvector), which is what a browser hits. Start
and stay there unless a task explicitly sends you elsewhere.

### Prerequisites

- Node **22** (see `.nvmrc`) + `pnpm`
- Docker (for local Postgres + pgvector)
- Python 3.12 / `uv` — only needed if you touch the Python packages, not for `apps/web`

### Run it locally

```bash
pnpm install
docker compose -f docker/compose/docker-compose.deps.yml up -d   # Postgres + pgvector
cp apps/web/.env.example apps/web/.env.local                     # then fill in the values below
pnpm --filter @grc/web db:migrate                                 # creates the schema + seeds the demo tenant
pnpm --filter @grc/web dev                                        # http://localhost:3000
```

In `apps/web/.env.local`, at minimum set:

- `DATABASE_URL` — `postgresql://grc:grc_local_password@localhost:5432/grc`, which is what the
  Docker Compose service above creates (`.env.example`'s `postgres:postgres@…/aigrc` does not
  match it).
- `AUTH_SECRET` — any string ≥32 chars for local dev (`openssl rand -base64 48`).
- `OPENAI_API_KEY` — needed for AI analysis/chat; without it the app falls back to a local,
  no-egress provider (limited, but the app still runs).

Everything else in `apps/web/.env.example` is optional for local testing (Resend email,
Sentry, the separate `v2/apps/grc-api` integration, etc.) — each var documents in the file
what breaks without it.

### Test database & first login

There is no demo password and no public signup: an account exists only once it is created. On a
fresh local database, create your own first owner (fake values — use a `.test` address):

```bash
pnpm --filter @grc/web db:create-admin -- --email you@local.test --password 'Local-Only-123!' \
  --name "Local Owner" --org "Local Test Org"
```

Log in at `http://localhost:3000/login` with it. More teammates arrive through Settings → Team →
invite. Never create test accounts in a shared or production database.

### The Governance Program backend (`grc-api`)

The Governance Program (`/discovery`, `/plan`) and History (`/missions`) call a second service,
`v2/apps/grc-api`. Without it those pages show "could not load" — every other page works. To run
it locally against the same Docker Postgres:

```bash
docker exec -it $(docker ps -qf ancestor=pgvector/pgvector:pg16) psql -U grc -c 'CREATE DATABASE rasheed_v2;'
cd v2/apps/grc-api && uv sync
DATABASE_URL=postgresql://grc:grc_local_password@localhost:5432/rasheed_v2 uv run python -m grc_api.migrate
DATABASE_URL=postgresql://grc:grc_local_password@localhost:5432/rasheed_v2 GRC_API_SERVICE_SECRET=<same as apps/web> \
  uv run uvicorn grc_api.app:create_app --factory --port 8000
```

Set `GRC_API_BASE_URL=http://localhost:8000` and the same `GRC_API_SERVICE_SECRET` in
`apps/web/.env.local`. Report generation also needs an AI provider for grc-api
(`GRC_LLM_PROVIDER` + that provider's key); without one the report step fails.

### Running the tests

```bash
pnpm --filter @grc/web typecheck   # tsc --noEmit
pnpm --filter @grc/web lint        # eslint
pnpm --filter @grc/web test        # eval suites (tests/eval/*.ts)
pnpm --filter @grc/web build       # production build (requires AUTH_SECRET)
```

`pnpm test` includes suites that **write rows** to whatever `DATABASE_URL` in `.env.local`
points at (they clean up after themselves, but still). Only run it against your local database.

CI (`.github/workflows/ci.yml`) runs the equivalent gates on every PR — a PR cannot merge
until these are green (§23).

### Deploying (النشر)

[`RELEASE_PROCESS.md`](RELEASE_PROCESS.md) is the full, concrete playbook — environments
(Production/Preview/local), the Vercel setup, branch protection, how to test and apply a
database migration safely, and what to do if a deploy goes wrong. Short version: branch →
PR → CI green → review → merge to `main` → Vercel deploys `main` to Production
automatically → apply any migration to production by hand right after (§4 of that doc).
Nobody pushes to `main` directly.

### What not to touch

- **No real data, ever.** Never point a local `.env.local` at a production database, and
  never commit one — `.env*` is gitignored everywhere in this repo (`!.env.example` is the
  only exception). If you're unsure whether a database is "real," don't connect to it.
- **Don't push to `main` directly.** Every change goes through a PR (§23) — branch, commit,
  push, open a PR.
- **Don't touch CI/CD, deploy config, or secrets** (`.github/workflows/`, Vercel project
  settings, production environment variables) without asking first.
- **`v2/`, `v3/`, and `devteam/` are separate tracks**, each with its own frozen core and
  ADR-gated change process (see their own READMEs/ADRs) — not where product/UI bug fixes
  belong, and not to be modified casually.
- **Don't merge code you can't explain** (§23) — this applies equally to AI-assisted
  changes from either of us.

If something here goes stale (a script renames, a port changes), fix this section in the
same PR that changes the underlying thing — don't let them drift apart.

---

*Living document. Propose changes via PR. When code and CLAUDE.md disagree, one of them is
a bug — fix it.*
