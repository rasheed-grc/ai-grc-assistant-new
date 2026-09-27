"""HTTP-level tests for `/v1/discovery/*` (ADR 0066). Uses an in-memory store injected via
`create_app(discovery_store_factory=...)` — the same injection seam `mission_store`/`read_model`
use for the mission subsystem — so this suite needs no database, matching `tests/test_missions.py`
et al.'s discipline (`tests/production` is the suite that speaks to real Postgres).
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from governance_discovery.session import DiscoverySession
from grc_api.app import create_app
from grc_api.composition import Storage

AUTH_A = {"Authorization": "Bearer dev-tenant-a"}
AUTH_B = {"Authorization": "Bearer dev-tenant-b"}


@dataclass
class _AnswerRow:
    question_id: str
    sequence: int
    raw_answer: object
    resolved_signal_key: str | None


class InMemoryDiscoveryStore:
    """Mirrors `PostgresGovernanceStore`'s surface — no database, tenant-scoped like the real
    store."""

    def __init__(self) -> None:
        self._sessions: dict[str, DiscoverySession] = {}
        self._answers: dict[str, list[_AnswerRow]] = {}

    def save_session(self, session: DiscoverySession) -> None:
        self._sessions[session.id] = session

    def get_session(self, session_id: str, tenant_id: str) -> DiscoverySession | None:
        session = self._sessions.get(session_id)
        return session if session is not None and session.tenant_id == tenant_id else None

    def find_in_progress_session(self, tenant_id: str) -> DiscoverySession | None:
        candidates = [
            s
            for s in self._sessions.values()
            if s.tenant_id == tenant_id and s.status == "in_progress"
        ]
        return max(candidates, key=lambda s: s.updated_at, default=None)

    def next_sequence(self, session_id: str) -> int:
        rows = self._answers.get(session_id, [])
        return (max((r.sequence for r in rows), default=0)) + 1

    def append_answer(self, **fields: object) -> None:
        row = _AnswerRow(
            question_id=fields["question_id"],
            sequence=fields["sequence"],
            raw_answer=fields["raw_answer"],
            resolved_signal_key=fields["resolved_signal_key"],
        )
        self._answers.setdefault(fields["session_id"], []).append(row)

    def answer_history(self, session_id: str, tenant_id: str) -> list[_AnswerRow]:
        return sorted(self._answers.get(session_id, []), key=lambda r: r.sequence)

    def close(self) -> None:  # matches the real store's lifecycle method
        pass


@pytest.fixture
def store() -> InMemoryDiscoveryStore:
    # ONE store instance shared across the whole app for the test's lifetime — a fresh factory
    # call per request (as production does) would just discard state between calls here, since
    # the fake has no external persistence to read back from.
    return InMemoryDiscoveryStore()


@pytest.fixture
def client(store: InMemoryDiscoveryStore) -> TestClient:
    return TestClient(
        create_app(storage=Storage.MEMORY, discovery_store_factory=lambda: store)
    )


def test_unauthenticated_request_is_rejected(client: TestClient) -> None:
    response = client.post("/v1/discovery/sessions")
    assert response.status_code == 401


def test_start_session_returns_the_opening_question(client: TestClient) -> None:
    response = client.post("/v1/discovery/sessions", headers=AUTH_A)
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "in_progress"
    assert body["question"]["id"] == "q:primary_activity"
    assert body["question"]["ui_hint"] == "dropdown"
    assert body["progress"]["stage_count"] == 4
    # never leaks internal jargon (Signal/Framework/Rule) or partial results at this stage
    assert "signal" not in str(body).lower()
    assert "framework" not in str(body).lower()


def test_answering_advances_to_the_next_question_and_activates_a_pack(client: TestClient) -> None:
    start = client.post("/v1/discovery/sessions", headers=AUTH_A).json()
    session_id = start["session_id"]
    response = client.post(
        f"/v1/discovery/sessions/{session_id}/answers",
        headers=AUTH_A,
        json={"question_id": "q:primary_activity", "value": "technology"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "in_progress"
    assert body["question"] is not None
    assert body["question"]["id"] != "q:primary_activity"  # moved on


def test_invalid_answer_returns_400_with_details(client: TestClient) -> None:
    start = client.post("/v1/discovery/sessions", headers=AUTH_A).json()
    response = client.post(
        f"/v1/discovery/sessions/{start['session_id']}/answers",
        headers=AUTH_A,
        json={"question_id": "q:primary_activity", "value": "not-a-real-option"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


def test_a_tenant_cannot_read_another_tenants_session(client: TestClient) -> None:
    start = client.post("/v1/discovery/sessions", headers=AUTH_A).json()
    response = client.post(
        f"/v1/discovery/sessions/{start['session_id']}/answers",
        headers=AUTH_B,
        json={"question_id": "q:primary_activity", "value": "technology"},
    )
    assert response.status_code == 404


def test_resume_finds_the_in_progress_session(client: TestClient) -> None:
    start = client.post("/v1/discovery/sessions", headers=AUTH_A).json()
    response = client.get("/v1/discovery/sessions/active", headers=AUTH_A)
    assert response.status_code == 200
    assert response.json()["session_id"] == start["session_id"]


def test_resume_returns_null_when_no_session_exists(client: TestClient) -> None:
    response = client.get("/v1/discovery/sessions/active", headers=AUTH_B)
    assert response.status_code == 200
    assert response.json() is None


def test_go_back_returns_the_previous_answer_for_editing(client: TestClient) -> None:
    start = client.post("/v1/discovery/sessions", headers=AUTH_A).json()
    session_id = start["session_id"]
    client.post(
        f"/v1/discovery/sessions/{session_id}/answers",
        headers=AUTH_A,
        json={"question_id": "q:primary_activity", "value": "technology"},
    )
    response = client.post(f"/v1/discovery/sessions/{session_id}/back", headers=AUTH_A)
    assert response.status_code == 200
    body = response.json()
    assert body["question"]["id"] == "q:primary_activity"
    assert body["previous_answer"] == "technology"


def test_skip_advances_an_optional_question_without_a_value(client: TestClient) -> None:
    start = client.post("/v1/discovery/sessions", headers=AUTH_A).json()
    response = client.post(
        f"/v1/discovery/sessions/{start['session_id']}/skip",
        headers=AUTH_A,
        json={"question_id": "q:held_licenses"},
    )
    # q:held_licenses may not be the currently-offered question yet, but it is always eligible
    # from the start (no applicability_predicate) — skip must accept it regardless of order.
    assert response.status_code == 200


def test_required_questions_cannot_be_skipped(client: TestClient) -> None:
    start = client.post("/v1/discovery/sessions", headers=AUTH_A).json()
    response = client.post(
        f"/v1/discovery/sessions/{start['session_id']}/skip",
        headers=AUTH_A,
        json={"question_id": "q:primary_activity"},
    )
    assert response.status_code == 400


def test_result_is_not_available_before_conclusion(client: TestClient) -> None:
    start = client.post("/v1/discovery/sessions", headers=AUTH_A).json()
    response = client.get(f"/v1/discovery/sessions/{start['session_id']}/result", headers=AUTH_A)
    assert response.status_code == 409


def test_starting_again_while_one_is_in_progress_resumes_it_instead_of_orphaning_a_duplicate(
    client: TestClient,
) -> None:
    first = client.post("/v1/discovery/sessions", headers=AUTH_A).json()
    second = client.post("/v1/discovery/sessions", headers=AUTH_A).json()
    assert second["session_id"] == first["session_id"]
    assert client.get("/v1/discovery/sessions/active", headers=AUTH_A).json()["session_id"] == first["session_id"]


def test_a_second_tenant_still_gets_its_own_session(client: TestClient) -> None:
    a = client.post("/v1/discovery/sessions", headers=AUTH_A).json()
    b = client.post("/v1/discovery/sessions", headers=AUTH_B).json()
    assert a["session_id"] != b["session_id"]
