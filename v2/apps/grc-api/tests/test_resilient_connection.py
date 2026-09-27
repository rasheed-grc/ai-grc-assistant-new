"""A launch's connection sits idle through every slow LLM step, and a managed pooler reaps idle
sessions. These tests pin the two guarantees that stop that from stranding a mission:

1. `_ResilientConnection` replaces a dead connection (checked after a quiet spell, or discovered
   mid-statement) and repeats the autocommit statement on a fresh one.
2. `DurableMissionLaunch` never leaves a mission `resumed`/`executing` with no driver: when the
   engine blows up it settles the mission as failed on a fresh connection, then re-raises.
"""

from __future__ import annotations

import psycopg
import pytest
from grc_api import composition
from grc_api.composition import _ResilientConnection
from grc_api.launch import DurableMissionLaunch
from mission_engine import MissionStatus


class _Conn:
    def __init__(self, name: str, *, dead: bool = False) -> None:
        self.name, self.dead, self.calls = name, dead, []

    def execute(self, sql, params=None):
        self.calls.append(sql)
        if self.dead:
            raise psycopg.OperationalError("server closed the connection unexpectedly")
        return f"{self.name}:ok"

    def cursor(self, *a, **k):
        return f"{self.name}:cursor"


class _Pool:
    def __init__(self, conns):
        self._conns, self.returned = list(conns), []

    def getconn(self):
        return self._conns.pop(0)

    def putconn(self, conn):
        self.returned.append(conn)


def test_a_statement_on_a_connection_that_died_mid_statement_is_retried_on_a_fresh_one():
    dead, fresh = _Conn("dead", dead=True), _Conn("fresh")
    conn = _ResilientConnection(_Pool([fresh]), dead)
    assert conn.execute("UPDATE missions SET x = 1") == "fresh:ok"
    assert fresh.calls == ["UPDATE missions SET x = 1"]


def test_an_idle_connection_is_health_checked_and_replaced_before_use(monkeypatch):
    dead, fresh = _Conn("dead", dead=True), _Conn("fresh")
    pool = _Pool([fresh])
    conn = _ResilientConnection(pool, dead)
    conn._last_used -= composition._IDLE_RECHECK_SECONDS + 1  # a long LLM step went by
    assert conn.execute("SELECT 2") == "fresh:ok"
    assert dead.calls == ["SELECT 1"], "the liveness probe must run first"
    assert pool.returned == [dead], "the dead session goes back to the pool, which discards it"


def test_a_healthy_recently_used_connection_is_not_probed():
    live = _Conn("live")
    conn = _ResilientConnection(_Pool([]), live)
    conn.execute("SELECT 2")
    assert live.calls == ["SELECT 2"]


def test_an_unrelated_error_is_not_swallowed():
    class _Boom(_Conn):
        def execute(self, sql, params=None):
            raise psycopg.errors.UndefinedTable("no such table")

    with pytest.raises(psycopg.errors.UndefinedTable):
        _ResilientConnection(_Pool([]), _Boom("b")).execute("SELECT * FROM nope")


class _Mission:
    def __init__(self):
        self.status, self.reason = MissionStatus.RESUMED, None

    def fail(self, reason=""):
        self.status, self.reason = MissionStatus.FAILED, reason


def test_a_launch_whose_engine_crashes_settles_the_mission_as_failed_and_re_raises(monkeypatch):
    import grc_api.launch as launch

    mission, saved, projected = _Mission(), [], []

    class _Store:
        def __init__(self, connection, table):
            pass

        def get(self, mission_id, tenant):
            return mission

        def save(self, m):
            saved.append(m.status)

    class _Conn2:
        def close(self):
            pass

    monkeypatch.setattr(launch, "PostgresMissionStore", _Store)
    monkeypatch.setattr(launch, "OutboxSink", lambda **kw: type("S", (), {"write": lambda *a: None})())
    monkeypatch.setattr(launch, "MissionEngine", lambda *a, **k: object())
    monkeypatch.setattr(launch, "_drive_reloaded", lambda e, m: (_ for _ in ()).throw(RuntimeError("boom")))
    durable = DurableMissionLaunch(
        executor=None, missions_table="m", outbox_table="o",
        connect=_Conn2, project=lambda c, m: projected.append(m.status),
    )
    with pytest.raises(RuntimeError, match="boom"):
        durable.launch("mis_1", tenant=object())
    assert mission.status is MissionStatus.FAILED
    assert saved == [MissionStatus.FAILED] and projected == [MissionStatus.FAILED]
