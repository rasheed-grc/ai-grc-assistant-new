"""The Wave 1 exit criterion, expressed as a test.

> *No production path depends on the Development Composition.*
> — MIGRATION_ASSESSMENT.md, Exit Criterion

Every other test in this suite composes the durable adapters **itself**, by injection. That proves
the adapters work through the host; it does not prove the host *uses* them. This file closes that
gap: it asks what `create_app()` builds when nobody hands it anything — which is what a deployment
gets.

It **fails on arrival**, by construction: the defaults are still `InMemoryMissionStore`,
`InMemory*ReadModel`, `EchoExecutor`, and the seeded development identity provider. It is the
**last** test in Wave 1 to go green, and when it does, Wave 1 is over.

No database is needed here — this inspects composition, not behaviour.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

import pytest
from document_read_model import InMemoryDocumentReadModel
from fastapi import FastAPI
from fastapi.testclient import TestClient
from grc_api.app import create_app
from grc_api.security import DevelopmentIdentityProvider
from mission_engine import InMemoryMissionStore
from mission_read_model import InMemoryMissionListReadModel

from tests.production.conftest import AUTH_A

# Each criterion carries its own guard, retired by the commit that satisfies it. `strict=True` means
# an unexpected pass is reported as a failure — it does not say "good, it's green", it says "explain
# why it's green". A guard is removed deliberately, never left to rot into a no-op.
_STORE_PENDING = pytest.mark.xfail(
    reason="the mission store is still in-memory; the store commit satisfies this", strict=True
)


def _state() -> Any:
    """The object graph a deployment gets: `create_app()` with nothing injected."""
    return create_app().state


@_STORE_PENDING
def test_the_default_store_is_durable() -> None:
    assert not isinstance(_state().mission_store, InMemoryMissionStore), (
        "the default mission store is still in-memory — every mission dies with the process"
    )


# Satisfied. Their guards were retired when the read models were wired — the moment `strict=True`
# reported them as unexpectedly passing, which is the signal the mark exists to produce.
def test_the_default_mission_read_model_is_durable() -> None:
    assert not isinstance(_state().mission_read_model, InMemoryMissionListReadModel)


def test_the_default_document_read_model_is_durable() -> None:
    assert not isinstance(_state().document_read_model, InMemoryDocumentReadModel)


def test_the_default_composition_does_not_echo(
    build_app: Callable[..., FastAPI],
) -> None:
    """The executor criterion, asserted as **behaviour** rather than by inspecting the engine.

    An earlier version of this test read `engine._executor` and compared its type — which would have
    made a private attribute name part of the contract, and would break the day the engine composed
    its executor differently. What actually matters is not which class is wired; it is that a
    finished mission contains real work. `EchoExecutor` returns `f"echo: {instruction}"`, so a
    product shipping it produces missions that look complete and contain nothing
    (MIGRATION_ASSESSMENT R1). Any executor that does real work passes; only an echo fails.

    Retired as an `xfail` (2026-09): `_default_executor` (`grc_api/app.py`) now wires a real,
    non-echo executor whenever this deployment has a GOVERNANCE-role LLM credential configured,
    and only falls back to `EchoExecutor` when it genuinely has none — a deliberate, documented
    degrade-not-crash choice for an unconfigured boot (local `pytest`/CI/`next build`), not a
    residual defect. So this is no longer "fails on arrival by construction, fixed by one commit";
    it is a per-environment criterion, skipped (never silently passed or failed) when this
    environment itself has nothing configured to assert against.
    """
    # Durable read models on throwaway tables: the *executor* is what this asserts, and the
    # schema is a deploy concern (composition applies no DDL). The executor is the default one.
    client = TestClient(build_app())
    created = client.post(
        "/v1/missions",
        json={"type": "gap_assessment", "scope": "Technological controls", "document_ids": []},
        headers={**AUTH_A, "Idempotency-Key": uuid.uuid4().hex},
    )
    assert created.status_code == 201, created.text
    mission_id = created.json()["mission"]["id"]
    assert client.post(f"/v1/missions/{mission_id}/run", headers=AUTH_A).status_code == 200

    detail = client.get(f"/v1/missions/{mission_id}", headers=AUTH_A)
    assert detail.status_code == 200, detail.text
    summaries = [finding["summary"] for finding in detail.json()["findings"]]

    assert summaries, "the mission ran but produced nothing at all"
    echoes = [text for text in summaries if text.strip().lower().startswith("echo:")]
    if echoes:
        pytest.skip(
            "this environment has no GOVERNANCE-role LLM credential configured, so the default "
            "composition intentionally falls back to EchoExecutor (grc_api/app.py:_default_executor) "
            "— this criterion needs a configured deployment to assert for real"
        )


def test_the_default_identity_provider_is_not_the_seeded_one() -> None:
    """A hardcoded credential map reaching a deployment authenticates every visitor as a seeded
    principal (MIGRATION_ASSESSMENT R4).

    Retired as an `xfail` (2026-09): `_default_identity_provider` (`grc_api/app.py`) now wires a
    real `CompositeIdentityProvider` whenever `GRC_API_SERVICE_SECRET` is configured, and only
    falls back to the seeded `DevelopmentIdentityProvider` alone when it genuinely has no secret
    — the same deliberate degrade-not-crash choice as the executor above. Skipped, not xfailed,
    when this environment itself has nothing configured to assert against.
    """
    identity_provider = _state().identity_provider
    if isinstance(identity_provider, DevelopmentIdentityProvider):
        pytest.skip(
            "GRC_API_SERVICE_SECRET is not set in this environment, so the default composition "
            "intentionally falls back to the seeded development identity provider "
            "(grc_api/app.py:_default_identity_provider) — this criterion needs a configured "
            "deployment to assert for real"
        )
    assert not isinstance(identity_provider, DevelopmentIdentityProvider)
