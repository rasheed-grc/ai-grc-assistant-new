"""Integration tests for the AI Worker Control Center router (KI-P5, ADR-0029): status,
activity timeline, run history, learning reports, schedule updates, and manual trigger,
driven through the real ASGI app against apps/web's live Postgres schema.

Needs a real database with apps/web's migrations applied: point ``TEST_DATABASE_URL``
(or ``DATABASE_URL``) at one, or these tests skip cleanly.
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest
from grc_api.app import create_app
from grc_api.settings import Settings
from grc_persistence_web import Database, WorkerControlRepository, WorkerRunHistoryRepository

_REPO_ROOT = Path(__file__).resolve().parents[3]


def _database_url() -> str | None:
    url = os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if url:
        return url
    env_file = _REPO_ROOT / ".env"
    if not env_file.exists():
        return None
    for line in env_file.read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"')
    return None


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def database_url() -> str:
    url = _database_url()
    if not url:
        pytest.skip("no TEST_DATABASE_URL/DATABASE_URL configured")
    return url


@pytest.fixture
def settings(database_url: str) -> Settings:
    tokens = {
        "admin-kw": {"user_id": "u-admin-kw", "organization_id": "org-kw", "roles": ["admin"]},
        "owner-kw": {"user_id": "u-owner-kw", "organization_id": "org-kw", "roles": ["owner"]},
        "viewer-kw": {"user_id": "u-viewer-kw", "organization_id": "org-kw", "roles": ["viewer"]},
        "auditor-kw": {
            "user_id": "u-auditor-kw",
            "organization_id": "org-kw",
            "roles": ["auditor"],
        },
    }
    return Settings(
        app_env="testing",
        llm_provider="fake",
        store_backend="memory",
        auth_seed_dev_principal=False,
        api_auth_tokens=json.dumps(tokens),
        database_url=database_url,
        log_json=False,
    )


@pytest.fixture
async def client(settings: Settings) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(settings)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http_client:
        yield http_client


@pytest.fixture
async def database(database_url: str) -> AsyncIterator[Database]:
    db = await Database.connect(database_url, min_size=1, max_size=2)
    try:
        yield db
    finally:
        await db.close()


@pytest.fixture(autouse=True)
async def _reset_control(database: Database) -> AsyncIterator[None]:
    """`worker_control` is a real, shared singleton row, and `worker_events` is the same
    append-only table the real Control Center's timeline reads — reset/clean both before and
    after each test so one test's enable/disable/interval/manual-trigger/audit-event change
    never leaks into another test, or into a developer's live dashboard."""

    async def _reset() -> None:
        async with database.pool.acquire() as connection:
            await connection.execute(
                "UPDATE worker_control SET enabled = true, interval_hours = 12, "
                "manual_trigger_requested_at = NULL, updated_by = NULL WHERE id = 'default'"
            )
            await connection.execute("DELETE FROM worker_events WHERE actor_user_id LIKE 'u-%-kw'")

    await _reset()
    yield
    await _reset()


async def test_status_requires_authentication(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/v1/knowledge-worker/status")
    assert response.status_code == 401


async def test_viewer_is_forbidden_from_every_route(client: httpx.AsyncClient) -> None:
    status_response = await client.get("/api/v1/knowledge-worker/status", headers=auth("viewer-kw"))
    events_response = await client.get("/api/v1/knowledge-worker/events", headers=auth("viewer-kw"))
    trigger_response = await client.post(
        "/api/v1/knowledge-worker/trigger", headers=auth("viewer-kw")
    )
    assert status_response.status_code == 403
    assert events_response.status_code == 403
    assert trigger_response.status_code == 403


async def test_auditor_can_read_but_never_control_the_worker(client: httpx.AsyncClient) -> None:
    """Auditor holds a blanket READ grant on every resource type platform-wide (the same
    "auditors read everything" rule that already covers the audit trail) — reading the
    Control Center's status/timeline is consistent with that, but the consequential actions
    (reschedule, enable/disable, manual trigger) remain admin-only."""
    status_response = await client.get(
        "/api/v1/knowledge-worker/status", headers=auth("auditor-kw")
    )
    schedule_response = await client.post(
        "/api/v1/knowledge-worker/schedule",
        json={"enabled": False},
        headers=auth("auditor-kw"),
    )
    trigger_response = await client.post(
        "/api/v1/knowledge-worker/trigger", headers=auth("auditor-kw")
    )
    assert status_response.status_code == 200
    assert schedule_response.status_code == 403
    assert trigger_response.status_code == 403


async def test_admin_can_read_status(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/v1/knowledge-worker/status", headers=auth("admin-kw"))
    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is True
    assert body["interval_hours"] == 12
    assert body["manual_trigger_requested"] is False


async def test_owner_can_disable_and_reschedule_the_worker(client: httpx.AsyncClient) -> None:
    disable_response = await client.post(
        "/api/v1/knowledge-worker/schedule",
        json={"enabled": False},
        headers=auth("owner-kw"),
    )
    assert disable_response.status_code == 200
    assert disable_response.json()["enabled"] is False

    reschedule_response = await client.post(
        "/api/v1/knowledge-worker/schedule",
        json={"interval_hours": 6},
        headers=auth("owner-kw"),
    )
    assert reschedule_response.status_code == 200
    assert reschedule_response.json()["interval_hours"] == 6

    status_response = await client.get("/api/v1/knowledge-worker/status", headers=auth("owner-kw"))
    assert status_response.json()["enabled"] is False
    assert status_response.json()["interval_hours"] == 6

    events_response = await client.get("/api/v1/knowledge-worker/events", headers=auth("owner-kw"))
    event_types = [event["event_type"] for event in events_response.json()]
    assert "worker_disabled" in event_types
    assert "interval_changed" in event_types
    disabled_event = next(e for e in events_response.json() if e["event_type"] == "worker_disabled")
    assert disabled_event["actor_user_id"] == "u-owner-kw"


async def test_admin_can_request_a_manual_trigger(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/v1/knowledge-worker/trigger", headers=auth("admin-kw"))
    assert response.status_code == 200
    assert response.json()["manual_trigger_requested_at"] is not None

    status_response = await client.get("/api/v1/knowledge-worker/status", headers=auth("admin-kw"))
    assert status_response.json()["manual_trigger_requested"] is True

    events_response = await client.get("/api/v1/knowledge-worker/events", headers=auth("admin-kw"))
    event_types = [event["event_type"] for event in events_response.json()]
    assert "manual_trigger_requested" in event_types


async def test_reports_reflects_the_real_knowledge_items_table(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get("/api/v1/knowledge-worker/reports", headers=auth("admin-kw"))
    assert response.status_code == 200
    body = response.json()
    for key in (
        "total_items",
        "verified",
        "needs_review",
        "outdated",
        "discovered",
        "added_this_cycle",
        "updated",
    ):
        assert key in body


async def test_runs_lists_recorded_run_history(
    client: httpx.AsyncClient, database: Database
) -> None:
    run_history = WorkerRunHistoryRepository(database)
    started = datetime(2026, 1, 1, tzinfo=timezone.utc)
    record = await run_history.record_run(
        reason="due",
        started_at=started,
        completed_at=started,
        questions_considered=10,
        gaps_detected=2,
        items_saved=1,
        error_count=0,
    )
    try:
        response = await client.get("/api/v1/knowledge-worker/runs", headers=auth("admin-kw"))
        assert response.status_code == 200
        ids = {run["id"] for run in response.json()}
        assert record.id in ids
    finally:
        async with database.pool.acquire() as connection:
            await connection.execute("DELETE FROM worker_run_history WHERE id = $1", record.id)


async def test_control_repository_is_the_single_source_of_truth(database: Database) -> None:
    """Sanity check the fixture reset itself works against the real singleton row."""
    repository = WorkerControlRepository(database)
    settings = await repository.get_settings()
    assert settings.enabled is True
