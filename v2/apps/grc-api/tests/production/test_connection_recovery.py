"""The read side must survive its connections being taken away.

A managed Postgres reaps idle sessions; a failover drops all of them at once. Neither is an error
the service gets to report — both are ordinary weather, and the next request has to work.

It did not. The mission read model was constructed once from a DSN and kept **its own** connection
for the life of the process, outside the pool and therefore outside `check_connection`. When the
pooler closed that connection, `/v1/missions` returned 500 `the connection is closed` on every
request from then on, and only restarting the process fixed it. That is the shape of the bug this
suite exists to keep out: not a wrong answer, but a service that cannot recover on its own.

Termination here is `pg_terminate_backend` against every backend on the test database except the
observer's own — the observer being how the fixtures clean up afterwards. See
`_terminate_every_backend` for why it is deliberately not narrower than that.
"""

from __future__ import annotations

import uuid
from typing import Any

import psycopg
import pytest
from fastapi.testclient import TestClient
from grc_api.composition import _pool

from tests.production.conftest import AUTH_A, create_mission


def _terminate_every_backend(observer: psycopg.Connection) -> int:
    """Drop every connection to this database except the observer's own — a failover, or a reaper
    that has been waiting long enough.

    Deliberately NOT filtered to `application_name = 'grc-api'`. Filtering was the first version of
    this helper and it was worthless: the connection that caused the outage was opened by the read
    model itself, outside the pool, with no application name — so a targeted kill spared exactly
    the connection under test and the suite passed against the broken code. A test that cannot fail
    for the original reason is not a regression test.

    Skips, rather than fails, when the connecting role cannot terminate backends at all (e.g. a
    managed/pooled Postgres such as Supabase, where the app role is deliberately not SUPERUSER and
    cannot signal other backends — including its own pooler's superuser-owned connections). That is
    an environment fact about *this* database, exactly like "no reachable PostgreSQL" in
    `conftest.connect` — this suite's whole regression only shows up where the role can actually
    induce the failure it recovers from (e.g. a local/self-hosted Postgres with a superuser role).
    """
    try:
        rows = observer.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = current_database() AND pid <> pg_backend_pid()"
        ).fetchall()
    except psycopg.errors.InsufficientPrivilege as exc:
        pytest.skip(f"this role cannot terminate backends on this database ({exc})")
    return len(rows)


def _missions(client: TestClient) -> list[dict[str, Any]]:
    response = client.get("/v1/missions", headers=AUTH_A)
    assert response.status_code == 200, response.text
    items: list[dict[str, Any]] = response.json()["items"]
    return items


def test_missions_survive_every_connection_being_terminated(
    client: TestClient, observer: psycopg.Connection
) -> None:
    """The regression, end to end through the real host: kill the connections, ask again."""
    mission_id = create_mission(client, scope=f"recovery-{uuid.uuid4().hex[:6]}")
    before = _missions(client)
    assert mission_id in {item["id"] for item in before}

    killed = _terminate_every_backend(observer)
    assert killed >= 1, "nothing was terminated — the test proved nothing"

    # No restart, no re-composition: the same client, the same app, the very next request.
    after = _missions(client)
    assert [item["id"] for item in after] == [item["id"] for item in before]


def test_a_read_borrows_from_the_pool_and_gives_the_connection_back(
    client: TestClient, observer: psycopg.Connection
) -> None:
    """Why the recovery above works, stated as its own property — and the one that fails first.

    Recovery is a *consequence* of every read borrowing from the pool. The broken version held a
    private connection, so a read went nowhere near the pool: `requests_num` did not move. That is
    the causal fact, so it is asserted directly rather than inferred from the outcome.
    """
    pool = _pool(autocommit=True)
    _missions(client)  # warm everything, so the counts below are about the read alone

    borrowed_before = pool.get_stats()["requests_num"]
    available_before = pool.get_stats()["pool_available"]

    _missions(client)

    assert pool.get_stats()["requests_num"] > borrowed_before, (
        "the read never asked the pool for a connection — the read model is holding its own"
    )
    assert pool.get_stats()["pool_available"] == available_before, (
        "a connection did not come back to the pool — the read model is keeping it"
    )


def test_a_terminated_connection_is_never_handed_out(
    client: TestClient, observer: psycopg.Connection
) -> None:
    """`check_connection` is load-bearing, so it gets its own test.

    Without it the first request after a reap gets a dead connection and fails for a reason that
    has nothing to do with it — the failure the pool's `check` exists to absorb. Terminating and
    then immediately reading is precisely that window.
    """
    _missions(client)  # warm the pool so there is something live to kill
    for _ in range(3):
        _terminate_every_backend(observer)
        try:
            _missions(client)
        except psycopg.OperationalError as exc:  # pragma: no cover - the bug being prevented
            pytest.fail(f"a dead connection reached the request: {exc}")
