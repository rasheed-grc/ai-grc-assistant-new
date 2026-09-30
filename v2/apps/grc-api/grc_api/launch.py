"""`MissionLaunchPort` — the boundary between command completion and execution start (ADR 0055,
Realization).

It exists to make one sentence true, structurally rather than by a choice of connection mode:

> The command owns the transaction, but not progress.

A command commits its decision, then hands a mission id to this Port; execution begins **through**
the Port, outside the command's transaction. The command knows nothing of `Engine`, `Runtime`,
`Driver`, `Queue`, or `Worker` — only "this mission is ready to launch".

**This is a responsibility boundary, not an execution layer.** Its whole surface is `launch`.
Scheduling, retry, cancellation, and background dispatch are all *implementations* of this boundary
(the ADR's deferred decision), chosen behind it — never methods added to it. If this Port ever grows
a second responsibility, it has stopped being a boundary and become the "Execution Manager" the ADR
forbids.

Two things it does **not** do: it does not decide *how* execution runs (synchronous today; a worker
or queue later — the boundary's implementation, ADR 0055 §Deferred decision), and it does not
remove the frozen engine's begin+drive coupling — it *isolates* it, so that coupling is execution's
concern, reached only from behind this seam and never from a command.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any, Protocol

from event_bus import ALL_EVENTS, InProcessEventBus
from mission_engine import MissionEngine, MissionStatus
from mission_store import OutboxSink, PostgresMissionStore
from pipeline_contracts import TenantContext

LOGGER = logging.getLogger(__name__)

# States from which "launch" means *begin the plan* vs *continue past an approved gate*. A launch
# on any other state is a no-op: nothing to start (already running, or terminal).
_STARTABLE = frozenset({MissionStatus.CREATED, MissionStatus.PLANNED})
# States in which a mission is being driven; one of these with no driver alive is a stuck mission.
_IN_FLIGHT = frozenset({MissionStatus.EXECUTING, MissionStatus.RESUMED})


class MissionLaunchPort(Protocol):
    """The seam a command reaches to begin a mission's execution. One operation, by id — an id is
    all a worker or a queue could carry, which is what keeps async possible behind this boundary
    without the command ever changing."""

    def launch(self, mission_id: str, tenant: TenantContext) -> None: ...


def _drive_reloaded(engine: Any, mission: Any) -> Any:
    """Dispatch a reloaded mission to the frozen engine's driver: `execute` to begin the plan,
    `resume` to continue past an approved gate. Anything else is a no-op — the mission is already
    running or finished, so a stray launch does nothing (idempotent at the boundary). Returns the
    mission after driving, so the caller can project its final state."""
    if mission.status in _STARTABLE:
        return engine.execute(mission)
    if mission.status is MissionStatus.RESUMED:
        return engine.resume(mission)
    return mission


class MemoryMissionLaunch:
    """The in-memory implementation: drive the shared in-memory engine directly. No connection, no
    transaction — the dictionary is the store, so "outside the command's transaction" is automatic
    (there is none).

    Execution is a *write*, so — like the command's decision — it projects its own result to
    the read model when it finishes. Without this the read surfaces would go stale the moment
    execution moved behind the launch boundary (the command projected the pre-execution status;
    the launch owns the post-execution one)."""

    def __init__(self, engine: Any, store: Any, project: Callable[[Any], None]) -> None:
        self._engine = engine
        self._store = store
        self._project = project

    def launch(self, mission_id: str, tenant: TenantContext) -> None:
        mission = self._store.get(mission_id, tenant)
        if mission is None:
            return
        self._project(_drive_reloaded(self._engine, mission))


class DurableMissionLaunch:
    """The durable implementation: reload the mission on its **own** connection and drive it there,
    so execution never runs inside a command's transaction.

    This is *an* implementation of the boundary, deliberately the simplest one that works — the
    choice of implementation is ADR 0055's deferred decision, not this Port's contract. It opens an
    autocommit connection, so each frozen per-step `save` and its event commit as they happen; that
    is what makes progress observable per step on today's engine. Its execution events are captured
    to the outbox via a sink on the same connection.

    *Known limitation, owned by the boundary's **implementation** (a later commit), not by this
    seam:* on autocommit a step's state and its event commit as two statements, so a crash between
    them could drop that one execution event — the per-step "short transaction" of ADR 0055's Option
    D is the refinement, and it changes only this class. The command boundary above is already
    correct and does not move when it lands.
    """

    def __init__(
        self,
        *,
        executor: Any,
        missions_table: str,
        outbox_table: str,
        connect: Callable[[], Any],
        project: Callable[[Any, Any], None],
    ) -> None:
        self._executor = executor
        self._missions_table = missions_table
        self._outbox_table = outbox_table
        self._connect = connect
        self._project = project

    def launch(self, mission_id: str, tenant: TenantContext) -> None:
        connection = self._connect()
        try:
            store = PostgresMissionStore(connection=connection, table=self._missions_table)
            mission = store.get(mission_id, tenant)
            if mission is None:
                return
            capture = InProcessEventBus()
            capture.subscribe(
                ALL_EVENTS, OutboxSink(connection=connection, table=self._outbox_table).write
            )
            engine = MissionEngine(store, self._executor, events=capture)
            try:
                driven = _drive_reloaded(engine, mission)
            except Exception:
                # Anything the resilient connection could not absorb. The one outcome that must
                # never happen is a mission left `executing`/`resumed` forever with nobody running
                # it: settle it as failed, on a fresh connection, then let the error surface.
                LOGGER.exception("mission_launch_failed: mission_id=%s", mission_id)
                self._settle_as_failed(mission_id, tenant)
                raise
            # Execution is a write; it projects its result — on THIS connection, so the read model
            # reflects the finished mission and never goes stale behind the launch boundary.
            self._project(connection, driven)
        finally:
            connection.close()

    def _settle_as_failed(self, mission_id: str, tenant: TenantContext) -> None:
        try:
            recovery = self._connect()
        except Exception:  # noqa: BLE001 - no database at all; nothing more can be recorded
            LOGGER.exception("mission_settle_failed: could not open a connection: %s", mission_id)
            return
        try:
            store = PostgresMissionStore(connection=recovery, table=self._missions_table)
            mission = store.get(mission_id, tenant)
            if mission is None or mission.status not in _IN_FLIGHT:
                return
            mission.fail("execution was interrupted")
            store.save(mission)
            self._project(recovery, mission)
        except Exception:  # noqa: BLE001 - recovery is best effort; never mask the original error
            LOGGER.exception("mission_settle_failed: mission_id=%s", mission_id)
        finally:
            recovery.close()
