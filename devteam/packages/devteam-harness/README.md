# devteam-harness — the AI Test Harness

A permanent QA platform for this product, not a test run. It generates synthetic organizations,
drives them through the real product code, attacks it, and refuses to call anything a pass that it
did not actually verify.

Run it before every release. Change one line anywhere in the product and this should tell you what
broke.

## The one rule everything else follows

**Coverage that did not run is reported, never skipped.**

`apps/web`'s existing eval scripts print `SKIP` and exit `0` when their dependencies are missing,
and CI never sets those dependencies — so `pnpm test` passes today while verifying nothing. Every
design decision in this package is aimed at that failure mode:

- No app running? A finding that says **"HTTP coverage did NOT run. This is not a pass."**
- No browser installed? A finding that says **"browser coverage did NOT run. This is not a pass."**
- Sign-in failed? Every page in that pass is reported as **unchecked**, not passed.
- A page in the inventory 404s? Reported — coverage was silently lost.

A green result from this harness means the checks ran. That is the whole point.

## Surfaces

| Surface | Proves | Needs |
|---|---|---|
| **In-process** | Discovery → Plan behaves correctly across thousands of organizations | nothing |
| **HTTP** (`surfaces/http.py`) | endpoints refuse anonymous callers and don't 5xx | the app running |
| **Browser** (`surfaces/browser.py`) | pages actually **render**, in both locales and both viewports | the app + Chromium |

The browser surface is not redundant with HTTP. A Next.js `error.tsx` boundary returns **HTTP 200**
while displaying "something went wrong" — so a status-code sweep reports a healthy app on a page
the user sees as broken. Every crash this project shipped a fix for recently would have passed the
HTTP sweep and failed the browser sweep.

## Two layers, and the line between them

| | contract |
|---|---|
| `devteam_harness/*` | **the gate** — runs on every PR, blocks a release, must never flake |
| `devteam_harness/investigation/*` | **instruments** — run by hand when something is wrong; may be slow, may need an LLM or a live app, and never gate anything |

The line is enforced, not remembered: `tests/test_architecture.py` runs the gate in a clean
subprocess and asserts that **every** non-investigation module is actually loaded, and that **no**
instrument is. A module that is neither must be moved or deleted.

That guard exists because an audit found the opposite: six modules (~1,700 lines, 29% of the
package) were reachable only from their own tests — which reads as dead code to anyone auditing it
and as tested system behaviour to anyone reading the suite. Neither was true.

## The agent team

| Agent | Role |
|---|---|
| **Explorer** | generates untried scenarios and measures whether coverage is still growing |
| **Breaker** | attacks the engine in-process with hostile inputs and protocol abuse |
| **Saboteur** | attacks the *running* app: concurrent requests, double submits, rapid clicks, multiple tabs, hostile payloads |
| **Sentry** | sweeps every protected route as an anonymous caller — the confidentiality check |
| **Pilot** | flies a real browser over every page in `{en, ar} × {desktop, mobile}` |
| **Verifier** | checks results against the invariants |
| **Regression** | replays every seed that has ever failed |
| **Reporter** | classifies findings and writes reproduction steps |

Breaker and Saboteur are deliberately split. In-process attacks find logic defects; only a live
system with a server, a session and a browser can produce **races** — a double-submitted approval,
two tabs on one record, twenty requests at once. Neither can find the other's bugs.

For an attack agent, **rejection is success**: a 400 or 403 means the boundary held, so it reports
only when the app crashes, leaks, or *accepts* something it should have refused. An attack agent
that flags every correct rejection buries the one attack that actually landed.

Severity is graded, not uniform. Anonymous data exposure is `CRASH` — in a multi-tenant GRC product
a cross-tenant read is the worst defect that can ship. Console noise is `SUSPICIOUS`. **A harness
that cries wolf trains people to ignore it**, so false positives are treated as defects in the
harness and fixed, not tolerated.

## Running it

```bash
cd devteam/packages/devteam-harness
uv sync
```

Fast, no dependencies — thousands of organizations through the real Discovery engine:

```bash
uv run python -m devteam_harness --count 1000 --db harness.db
```

Reproduce exactly one reported failure (every finding prints this line):

```bash
uv run python -m devteam_harness --seed 412
```

The agent team, in-process — needs nothing running, so this is what CI executes:

```bash
uv run python -m devteam_harness --team --count 500
```

Against a running app. `--http` and `--browser` are opt-in because both need one, and a run that
always reports "the app was not running" is a run nobody reads:

```bash
uv sync --extra browser && uv run playwright install chromium
uv run python -m devteam_harness --team --http --browser --html run.html
```

Asking for a surface and not getting it is still reported — the flag declares intent, it does not
lower the bar.

## What is covered

Every product area a release gate cares about — **18 areas, 25 protected routes, 21 pages** — each
in **English and Arabic**, at **desktop and mobile** widths:

Dashboard · Risk Register · Documents · Evidence · Policies · Frameworks · Notifications ·
User Management · Organizations (members, invitations) · Password Reset · Access Requests ·
Missions · Governance Plan · Discovery · Reports · Regulation Review · Chat

## Determinism

Every scenario is a seed. The same seed produces the same organization, the same answers, and the
same verdict — so a failure reported by CI reproduces on a laptop from the seed alone, with no
recorded fixtures to go stale. Answers are a *strategy* driven by each question's type and options,
not a script, so the harness keeps working when the interview changes.

## Authentication

The browser sweep signs in as its own account, provisioned once:

```bash
node apps/web/scripts/create-admin.mjs --email harness@rasheed.local \
  --password 'HarnessRun123!' --name 'AI Test Harness' --org 'Harness Test Org'
```

Override with `HARNESS_EMAIL` / `HARNESS_PASSWORD` to point at a CI-seeded user.

## Failure artifacts

On any browser failure the harness writes a bundle beside the run: **screenshot, console, network,
and stack trace**, together. A picture of a broken page without the trace behind it is a bug report
nobody can act on.

Artifacts follow the **finding**, not the verdict — a console error does not make a page unhealthy
but still files a finding, and a finding whose reproduce line points at artifacts that were never
written is a dead end.

## The release gate

A gate that fails on *any* finding would be red forever — one real product defect is known and
unfixed — and a permanently red gate is ignored within a week. So the gate compares against a
**committed baseline** and answers the only question that matters before a release:

> did this change make anything **worse** than it already was?

Three ways to be worse, all blocking: a finding kind not in the baseline (something new broke),
a known kind occurring more often (something got worse), or a coverage gap (we did not actually
check). A known kind that *disappears* does **not** block — a fix must never block a release — but
it is reported, because a stale baseline is a gate that has quietly stopped gating.

```bash
uv run python -m devteam_harness --team --count 300 --baseline gate-baseline.json
```

Runs on every PR (`harness-gate` in CI) and is **blocking**, because it needs no app, no database,
no LLM and no browser — it cannot flake on infrastructure. Raising the baseline is a deliberate act
with a diff and a reviewer:

```bash
uv run python -m devteam_harness --team --count 300 --baseline gate-baseline.json --update-baseline
```

A baseline never records a coverage gap. It lists known *product defects*; baking in "this check
did not run" is the blind spot this package exists to prevent.

## The first bug it found, and fixed

`plan_dependencies_exist` failed on ~15% of generated organizations: a plan item depended on an
item that was never scheduled.

Root cause was one inconsistency inside the scheduler — it filtered dependencies when *ordering*
items but emitted the unfiltered list into the persisted plan, so the record referenced an item the
plan did not contain. Fixed at the source (`governance_discovery/scheduler.py`), not by weakening
the invariant. **1500/1500 organizations now pass.**

The baseline is consequently empty: nothing is known to fail, so from here **any** invariant
violation blocks a release.

A harness that finds defects and never gets them fixed stops being believed. The invariant that
caught this is now a regression test in `governance-discovery` too, so the fix is protected at the
source as well as by the sweep.
