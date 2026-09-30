"""How the host composes storage (ADR 0052 — the composition root; ADR 0053 — the read models;
ADR 0055 — the transaction boundary is the **command**).

**The property this module exists to hold:**

> No durable store lives in the application. Only factories live; each creates a store for one
> operation, and it is gone when the operation ends.

A `Store` has no business owning a lifetime — a *connection* owns one, and a `UnitOfWork` owns the
transaction around it. If the long-lived object were a store, then sooner or later someone would put
a `PostgresMissionStore` on `app.state` because "it's just a store", and the command-owned boundary
would quietly become a process-wide one. There is no such object here to share.

So the two sides are composed differently, on purpose:

- **Reads** go through a long-lived *reader service* that holds configuration, not state. Each
  `get` opens its own short connection, builds a store for that one read, and disposes both. It
  carries no transaction because a read is not a write.
- **Writes** go through a *command scope factory*. Opening a scope creates the `UnitOfWork` and,
  bound to its single connection, the mission store, the outbox sink, and the projection — the
  three participants ADR 0055 names. The command runs inside; on clean exit they commit together, on
  an exception they roll back together. Then all of it is discarded.

Two further decisions kept from the read-model wiring:

- **Production defaults to durable; a test declares its environment** (`storage=Storage.MEMORY`).
- **Nothing here creates schema.** A store that is asked to write does not build its own tables.
  Migrations are a deployment concern and land in their own change; the DDL already exists as
  `mission-store/migrations/*.sql` and `*_read_model.create_table_sql`.
"""

from __future__ import annotations

import contextlib
import enum
import logging
import os
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any

from document_read_model import InMemoryDocumentReadModel, PostgresDocumentReadModel
from document_read_model.schema import DEFAULT_TABLE as DOCUMENTS_TABLE
from event_bus import ALL_EVENTS, InProcessEventBus
from mission_engine import MissionEngine
from mission_read_model import InMemoryMissionListReadModel, PostgresMissionListReadModel
from mission_read_model.schema import DEFAULT_TABLE as MISSIONS_VIEW_TABLE
from mission_store import OutboxSink, PostgresMissionStore, UnitOfWork
from mission_store.config import TABLE as MISSIONS_TABLE
from mission_store.config import dsn as default_dsn
from mission_store.outbox_schema import OUTBOX_TABLE

from grc_api.launch import (
    MissionLaunchPort,
)

DSN_ENV_VAR = "MISSION_STORE_DSN"
GOVERNANCE_DSN_ENV_VAR = "GOVERNANCE_STORE_DSN"


def database_dsn() -> str:
    """The V2 database. One setting configures the missions, the outbox and the read models, so they
    cannot drift into different databases."""
    return os.environ.get(DSN_ENV_VAR) or default_dsn()


def governance_database_dsn() -> str:
    """The Governance Discovery tables' database (ADR 0066) — same isolated V2 database by
    default (`governance_store.config.dsn()`), overridable independently via its own env var."""
    from governance_store.config import dsn as default_governance_dsn

    return os.environ.get(GOVERNANCE_DSN_ENV_VAR) or default_governance_dsn()


class Storage(str, enum.Enum):
    """Which adapters the app is built with. There is no "unspecified": production defaults to
    `DURABLE`, and a test that wants `MEMORY` says so."""

    DURABLE = "durable"
    MEMORY = "memory"


@dataclass(frozen=True)
class Tables:
    """Where the durable composition writes. Overridable so a test can point the *host itself* at
    throwaway tables instead of handing it a pre-built store — which is what lets a test observe the
    real composition rather than a substitute for it."""

    missions: str = MISSIONS_TABLE
    outbox: str = OUTBOX_TABLE
    missions_view: str = MISSIONS_VIEW_TABLE
    documents_view: str = DOCUMENTS_TABLE


# --- connection pooling (B3) --------------------------------------------------------------
#
# Every store operation used to open its own connection. Managed Postgres caps connections
# aggressively (often 20-100 on small tiers), so with W workers x concurrent requests the ceiling
# is CONNECTIONS, not CPU — and connection setup cost was paid on every single operation.
#
# TWO pools, because `UnitOfWork` REJECTS an autocommit connection outright: autocommit makes
# commit/rollback no-ops and would silently destroy the atomicity it exists to provide. Mixing the
# two modes in one pool would hand a command a connection that cannot be transactional.
#
LOGGER = logging.getLogger(__name__)

# Sizes are per PROCESS. Total connections = instances x workers x (POOL_MAX x 2), which must stay
# under the database's cap with headroom for migrations and human access — see the production
# architecture doc.
POOL_MIN_SIZE = int(os.environ.get("DB_POOL_MIN_SIZE", "1"))
POOL_MAX_SIZE = int(os.environ.get("DB_POOL_MAX_SIZE", "5"))
# A caller that waits longer than this gets an error instead of hanging: a request queued forever
# on a pool is indistinguishable from a hung service, and it will trip a health probe. 30s, not
# 10: a launch keeps its connection for the whole of an execution (minutes of LLM calls), so a few
# missions running at once legitimately queue the next request for a while — that is contention to
# wait out, not an outage to report.
POOL_TIMEOUT_SECONDS = float(os.environ.get("DB_POOL_TIMEOUT", "30"))
POOL_APPLICATION_NAME = "grc-api"

_pools: dict[bool, Any] = {}


def _pool(*, autocommit: bool) -> Any:
    """The pool for one connection mode, created on first use.

    Lazy so that importing this module never opens a socket — a test that uses `Storage.MEMORY`,
    and `--help`, must not require a database.
    """
    existing = _pools.get(autocommit)
    if existing is not None:
        return existing

    from psycopg_pool import ConnectionPool

    pool = ConnectionPool(
        conninfo=database_dsn(),
        min_size=POOL_MIN_SIZE,
        max_size=POOL_MAX_SIZE,
        timeout=POOL_TIMEOUT_SECONDS,
        # `application_name` lands in `pg_stat_activity`, which is how an operator (or a test that
        # simulates a pooler reaping idle sessions) tells this service's connections apart from
        # everything else sharing the database.
        kwargs={"autocommit": autocommit, "application_name": POOL_APPLICATION_NAME},
        # Hand out a connection only after checking it is alive. Without this, the first request
        # after a database failover or an idle-timeout reaper gets a dead connection and fails for
        # a reason that has nothing to do with it.
        check=ConnectionPool.check_connection,
        open=True,
        name=f"grc-api-{'autocommit' if autocommit else 'transactional'}",
    )
    _pools[autocommit] = pool
    return pool


class _PooledConnection:
    """A borrowed connection that RETURNS to the pool when closed instead of being destroyed.

    Every call site already follows `connection = _connect(...)` / `finally: connection.close()`.
    Rather than rewrite each one — and risk changing transaction handling while doing it — `close`
    is redefined to mean "give it back". Everything else delegates untouched.

    Deliberately no `__enter__`/`__exit__`: psycopg's own context manager CLOSES the connection on
    exit, which would defeat pooling. Dunder lookup skips `__getattr__`, so `with connection:`
    raises loudly here rather than quietly leaking a connection out of the pool.
    """

    def __init__(self, pool: Any, connection: Any) -> None:
        self._pool = pool
        self._connection = connection

    def __getattr__(self, name: str) -> Any:
        return getattr(self._connection, name)

    def close(self) -> None:
        self._pool.putconn(self._connection)


def _connect(*, autocommit: bool) -> Any:
    return _PooledConnection(_pool(autocommit=autocommit), _pool(autocommit=autocommit).getconn())


def close_pools() -> None:
    """Close every pool. For shutdown and for tests that must not leak connections between cases."""
    while _pools:
        _, pool = _pools.popitem()
        pool.close()


# A launch holds ONE connection for a whole execution, and an execution is dominated by LLM calls
# that can take minutes. A managed pooler (Supabase's Supavisor) reaps sessions that sit idle, so
# the next `save` after a slow step used to hit a dead socket: the mission was left `resumed`
# forever and the caller got a 502 even though the step's work had already been done. Every
# statement on this connection is autocommit — self-contained — so replacing a dead connection
# and repeating the statement is safe.
_IDLE_RECHECK_SECONDS = 10.0


class _ResilientConnection(_PooledConnection):
    """An autocommit pooled connection that survives being reaped while idle.

    Before the first statement after a quiet spell it checks the session is alive (`SELECT 1`);
    a statement that still fails on a broken connection is retried once on a fresh one. The
    frozen engine and stores above need no change — they only ever call `execute`/`cursor`.
    """

    def __init__(self, pool: Any, connection: Any) -> None:
        super().__init__(pool, connection)
        self._last_used = time.monotonic()

    def _replace(self) -> None:
        import psycopg

        try:
            self._pool.putconn(self._connection)  # broken → the pool discards it
        except psycopg.Error:
            pass
        self._connection = self._pool.getconn()

    def _ensure_alive(self) -> None:
        import psycopg

        if time.monotonic() - self._last_used >= _IDLE_RECHECK_SECONDS:
            try:
                self._connection.execute("SELECT 1")
            except psycopg.Error:
                LOGGER.warning("db_connection_replaced: idle connection was dropped by the server")
                self._replace()
        self._last_used = time.monotonic()

    def execute(self, *args: Any, **kwargs: Any) -> Any:
        import psycopg

        self._ensure_alive()
        try:
            return self._connection.execute(*args, **kwargs)
        except (psycopg.OperationalError, psycopg.InterfaceError):
            LOGGER.warning("db_statement_retried: connection broke mid-statement")
            self._replace()
            return self._connection.execute(*args, **kwargs)

    def cursor(self, *args: Any, **kwargs: Any) -> Any:
        self._ensure_alive()
        return self._connection.cursor(*args, **kwargs)


def open_autocommit_connection() -> Any:
    """A fresh autocommit connection to the V2 database — the seam the durable launch opens its own
    connection through, so execution never borrows the command's. Resilient to being reaped while
    a long LLM step keeps it idle (see `_ResilientConnection`)."""
    pool = _pool(autocommit=True)
    return _ResilientConnection(pool, pool.getconn())


# --- reads: a service that holds configuration, never a store -----------------------------


class DurableMissionReader:
    """Loads a mission for the read side. Owns **no** store and **no** connection: it creates both
    for the one read and disposes them, so nothing durable outlives the call. Autocommit, because a
    read carries no transaction."""

    def __init__(self, table: str) -> None:
        self._table = table

    def get(self, mission_id: str, tenant: Any) -> Any:
        connection = _connect(autocommit=True)
        try:
            store = PostgresMissionStore(connection=connection, table=self._table)
            return store.get(mission_id, tenant)
        finally:
            connection.close()


class _PerCallAdapter:
    """Builds the read-model adapter around a POOLED connection for each call, and gives the
    connection back when the call returns. The same rule `DurableMissionReader` follows above:
    nothing durable outlives the call.

    This replaces an adapter that was constructed once, from a DSN, and kept its own connection for
    the lifetime of the process — outside the pool, and so outside `check_connection`. Against a
    local Postgres that connection lives forever and the arrangement looks fine. Against a managed
    Postgres it does not: the pooler reaps an idle connection, and because nothing ever rebuilt the
    adapter, `/v1/missions` then returned 500 `the connection is closed` FOREVER — only a restart
    of the process brought it back. That was observed in production, not theorised.

    Deferring construction also preserves what the earlier lazy adapter existed for: `grc_api.app`
    builds a module-level `app = create_app()` for uvicorn, and that import must work with no
    database reachable.

    Every method of both read-model ports is a call — `record`, `get`, `list_missions`,
    `list_documents` — so forwarding attribute access as a bound call is the whole surface. A
    non-callable attribute would come back wrapped and fail loudly rather than quietly, which is
    the right way round for a seam this thin.
    """

    def __init__(self, factory: Callable[[Any], Any], *, name: str) -> None:
        self._factory = factory
        self._name = name

    def __getattr__(self, attribute: str) -> Any:
        def call(*args: Any, **kwargs: Any) -> Any:
            connection = _connect(autocommit=True)
            try:
                return getattr(self._factory(connection), attribute)(*args, **kwargs)
            finally:
                connection.close()  # returns it to the pool; see `_PooledConnection`

        return call

    def __repr__(self) -> str:
        return f"<durable {self._name} (pooled, one connection per call)>"


def build_mission_read_model(storage: Storage, tables: Tables) -> Any:
    if storage is Storage.MEMORY:
        return InMemoryMissionListReadModel()
    return _PerCallAdapter(
        lambda connection: PostgresMissionListReadModel(
            connection=connection, table=tables.missions_view
        ),
        name="mission read model",
    )


def build_document_read_model(storage: Storage, tables: Tables) -> Any:
    if storage is Storage.MEMORY:
        return InMemoryDocumentReadModel()
    return _PerCallAdapter(
        lambda connection: PostgresDocumentReadModel(
            connection=connection, table=tables.documents_view
        ),
        name="document read model",
    )


# --- writes: a factory that creates one transaction's worth of collaborators ---------------


@dataclass
class CommandScope:
    """One command's transactional world. Every participant here shares a single connection, so the
    mission write, its events and its projection commit together or not at all (ADR 0055).

    `launches` is the buffer the workflow appends to when a command asks to *start execution*. The
    scope does not run them — it fires them through the `MissionLaunchPort` **after** the
    transaction commits — which is what makes "the command owns the transaction, not progress"
    true."""

    engine: Any
    store: Any
    mission_read_model: Any
    launches: list[tuple[str, Any]] = field(default_factory=list)


CommandScopeFactory = Callable[[], "contextlib.AbstractContextManager[CommandScope]"]


def durable_command_scope_factory(
    executor: Any, tables: Tables, launch: MissionLaunchPort
) -> CommandScopeFactory:
    """The write side in production: a factory, and nothing else, lives in the app.

    Each scope opens a connection, wraps it in a `UnitOfWork`, and binds to that one connection the
    mission store, an `OutboxSink` subscribed to the engine's event bus, and the mission read model.
    Clean exit commits all three; an exception rolls back all three. **Then**, and only after the
    commit, any launch the command recorded is fired through the `MissionLaunchPort` — so execution
    starts outside the committed transaction, never inside it. A rolled-back command fires nothing.
    """

    @contextlib.contextmanager
    def scope() -> Iterator[CommandScope]:
        connection = _connect(autocommit=False)
        active: CommandScope | None = None
        try:
            with UnitOfWork(connection=connection) as unit:
                store = PostgresMissionStore(connection=unit.connection, table=tables.missions)
                # Synchronous capture bus: the sink writes inside this transaction, not after it.
                capture = InProcessEventBus()
                capture.subscribe(
                    ALL_EVENTS,
                    OutboxSink(connection=unit.connection, table=tables.outbox).write,
                )
                active = CommandScope(
                    engine=MissionEngine(store, executor, events=capture),
                    store=store,
                    mission_read_model=PostgresMissionListReadModel(
                        connection=unit.connection, table=tables.missions_view
                    ),
                )
                yield active
            # Reached only on a clean commit; a rollback raises out of the `with` and skips this.
            for mission_id, tenant in active.launches:
                launch.launch(mission_id, tenant)
        finally:
            connection.close()

    return scope


def memory_command_scope_factory(
    engine: Any, store: Any, mission_read_model: Any, launch: MissionLaunchPort
) -> CommandScopeFactory:
    """The in-memory equivalent: the same seam, no transaction. Launches still fire through the Port
    after the (no-op) scope, so a test exercises the same command→launch boundary as production."""

    @contextlib.contextmanager
    def scope() -> Iterator[CommandScope]:
        active = CommandScope(engine=engine, store=store, mission_read_model=mission_read_model)
        yield active
        for mission_id, tenant in active.launches:
            launch.launch(mission_id, tenant)

    return scope
