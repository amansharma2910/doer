"""Task lifecycle: the product's commitment contract in code."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from doer import events
from doer.daytime import utcnow
from doer.models import LogicalDay, Task, User
from doer.models.task import MAX_PRIMARIES, snap_to_bucket
from doer.services import capacity


class TaskRuleViolation(Exception):
    """A contract rule refused the operation. Carries a remedy, not just a refusal."""

    def __init__(self, message: str, *, code: str, remedy: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.remedy = remedy


@dataclass
class DemotionNotice:
    task_id: uuid.UUID
    title: str


async def tasks_for_day(session: AsyncSession, day: LogicalDay) -> list[Task]:
    result = await session.execute(
        select(Task).where(Task.logical_day_id == day.id).order_by(Task.sort_index, Task.created_at)
    )
    return list(result.scalars())


async def primary_count(session: AsyncSession, day: LogicalDay) -> int:
    return (
        await session.scalar(
            select(func.count())
            .select_from(Task)
            .where(Task.logical_day_id == day.id, Task.is_primary.is_(True))
        )
        or 0
    )


async def _next_sort_index(session: AsyncSession, day: LogicalDay, kind: str) -> int:
    """New tasks append to the end of their preference block (AC-11)."""
    highest = await session.scalar(
        select(func.max(Task.sort_index)).where(
            Task.logical_day_id == day.id, Task.preference_kind == kind
        )
    )
    return (highest or 0) + 1


async def create_task(
    session: AsyncSession,
    user: User,
    day: LogicalDay,
    *,
    title: str,
    notes: str | None = None,
    is_primary: bool = False,
    preference_kind: str = "deep_work",
    source: str = "manual",
) -> Task:
    if is_primary:
        count = await primary_count(session, day)
        if count >= MAX_PRIMARIES:
            events.record(
                session,
                user_id=user.id,
                name="primary_cap_rejected",
                logical_day_id=day.id,
                anchor_date=day.anchor_date,
                properties={"attempted_source": source, "remedy_offered": "demote_or_non_primary"},
            )
            raise TaskRuleViolation(
                f"this day already holds {MAX_PRIMARIES} primary tasks",
                code="primary_cap_reached",
                remedy="demote an existing primary, or add this one as non-primary",
            )

    task = Task(
        user_id=user.id,
        logical_day_id=day.id,
        title=title,
        notes=notes,
        is_primary=is_primary,
        preference_kind=preference_kind,
        sort_index=await _next_sort_index(session, day, preference_kind),
        estimation_status="pending",
    )
    session.add(task)
    await session.flush()

    events.record(
        session,
        user_id=user.id,
        name="task_created",
        logical_day_id=day.id,
        anchor_date=day.anchor_date,
        properties={
            "task_id": task.id,
            "is_primary": is_primary,
            "preference_type": preference_kind,
            "source": source,
            # Task titles are user content and never enter the metrics stream.
            "title_length": len(title),
            "target_anchor_date": day.anchor_date,
        },
    )
    return task


async def start_task(session: AsyncSession, user: User, task: Task, day: LogicalDay) -> Task:
    """Mark a task as started.

    Optional, but it is the only way actual_minutes is ever populated, and the
    estimation-error indicator in the tracking plan has nothing to measure without
    it.
    """
    if task.started_at is not None or task.is_complete:
        return task

    task.started_at = utcnow()
    events.record(
        session,
        user_id=user.id,
        name="task_started",
        logical_day_id=day.id,
        anchor_date=day.anchor_date,
        properties={"task_id": task.id, "started_at": task.started_at},
    )
    return task


async def record_update(
    session: AsyncSession, user: User, task: Task, day: LogicalDay, fields: list[str]
) -> None:
    """Emit task_updated for non-estimate field changes.

    Estimate changes have their own event, so they are excluded here rather than
    double-counted.
    """
    if not fields:
        return
    events.record(
        session,
        user_id=user.id,
        name="task_updated",
        logical_day_id=day.id,
        anchor_date=day.anchor_date,
        properties={"task_id": task.id, "fields_changed": fields},
    )


async def complete_task(session: AsyncSession, user: User, task: Task, day: LogicalDay) -> Task:
    if task.is_complete:
        return task
    if day.is_closed:
        raise TaskRuleViolation(
            "this day has closed", code="day_closed", remedy="work on the current day instead"
        )

    now = utcnow()
    task.completed_at = now
    if task.started_at is not None:
        task.actual_minutes = int((now - task.started_at).total_seconds() // 60)

    events.record(
        session,
        user_id=user.id,
        name="task_completed",
        logical_day_id=day.id,
        anchor_date=day.anchor_date,
        properties={
            "task_id": task.id,
            "is_primary": task.is_primary,
            "estimate_minutes": task.estimate_minutes,
            "actual_minutes": task.actual_minutes,
            "carry_forward_count": task.carry_forward_count,
            "completed_at": now,
        },
    )
    return task


async def reverse_completion(
    session: AsyncSession, user: User, task: Task, day: LogicalDay
) -> Task:
    """Undo a completion, but only while the day is still open (AC-09).

    After close the verdict is permanent, so the heatmap can never be rewritten
    retroactively. A mis-click is recoverable; history is not editable.
    """
    if not task.is_complete:
        return task

    if day.is_closed:
        events.record(
            session,
            user_id=user.id,
            name="task_completion_reversal_rejected",
            logical_day_id=day.id,
            anchor_date=day.anchor_date,
            properties={"task_id": task.id, "reason": "day_closed"},
        )
        raise TaskRuleViolation(
            "this day has closed and its verdict is final",
            code="day_closed",
            remedy=None,
        )

    was_completed_at = task.completed_at
    task.completed_at = None
    task.actual_minutes = None

    events.record(
        session,
        user_id=user.id,
        name="task_completion_reversed",
        logical_day_id=day.id,
        anchor_date=day.anchor_date,
        properties={
            "task_id": task.id,
            "was_completed_at": was_completed_at,
            "reversed_at": utcnow(),
        },
    )
    return task


async def delete_task(session: AsyncSession, user: User, task: Task, day: LogicalDay) -> None:
    """Delete an incomplete task. A completed one is refused and the attempt logged."""
    if task.is_complete:
        events.record(
            session,
            user_id=user.id,
            name="task_delete_rejected",
            logical_day_id=day.id,
            anchor_date=day.anchor_date,
            properties={"task_id": task.id, "reason": "completed_immutable"},
        )
        raise TaskRuleViolation(
            "completed tasks are permanent and cannot be deleted",
            code="completed_immutable",
            remedy=None,
        )

    events.record(
        session,
        user_id=user.id,
        name="task_deleted",
        logical_day_id=day.id,
        anchor_date=day.anchor_date,
        properties={
            "task_id": task.id,
            "was_primary": task.is_primary,
            "carry_forward_count": task.carry_forward_count,
        },
    )
    await session.delete(task)


async def set_primary(
    session: AsyncSession, user: User, task: Task, day: LogicalDay, *, primary: bool
) -> Task:
    if task.is_primary == primary:
        return task

    if primary:
        count = await primary_count(session, day)
        if count >= MAX_PRIMARIES:
            raise TaskRuleViolation(
                f"this day already holds {MAX_PRIMARIES} primary tasks",
                code="primary_cap_reached",
                remedy="demote an existing primary first",
            )

    task.is_primary = primary
    if primary:
        task.carry_forward_demoted = False
    events.record(
        session,
        user_id=user.id,
        name="task_promoted" if primary else "task_demoted",
        logical_day_id=day.id,
        anchor_date=day.anchor_date,
        properties={"task_id": task.id, "trigger": "user"},
    )
    return task


async def set_estimate(
    session: AsyncSession,
    user: User,
    task: Task,
    day: LogicalDay,
    *,
    minutes: int,
    source: str,
    raw_minutes: int | None = None,
) -> Task:
    """Store an estimate, snapped to a 15-minute bucket and clamped (AC-10)."""
    snapped = snap_to_bucket(minutes)
    previous = task.estimate_minutes

    task.estimate_minutes = snapped
    task.estimate_source = source
    task.estimation_status = "estimated"
    if source == "model":
        task.raw_model_minutes = raw_minutes if raw_minutes is not None else minutes

    if source == "user":
        events.record(
            session,
            user_id=user.id,
            name="task_estimate_overridden",
            logical_day_id=day.id,
            anchor_date=day.anchor_date,
            properties={
                "task_id": task.id,
                "previous_minutes": previous,
                "new_minutes": snapped,
                "was_snapped": snapped != minutes,
            },
        )
    return task


async def reorder(
    session: AsyncSession, user: User, task: Task, day: LogicalDay, *, to_index: int
) -> Task:
    """Move a task within its preference block.

    Ordering is scoped to the block: a task cannot be interleaved into a different
    block by dragging (T-TASK-13). Changing block is a preference-kind change.
    """
    siblings = [
        t for t in await tasks_for_day(session, day) if t.preference_kind == task.preference_kind
    ]
    from_index = siblings.index(task)
    siblings.pop(from_index)
    siblings.insert(max(0, min(to_index, len(siblings))), task)

    for position, sibling in enumerate(siblings):
        sibling.sort_index = position

    events.record(
        session,
        user_id=user.id,
        name="task_reordered",
        logical_day_id=day.id,
        anchor_date=day.anchor_date,
        properties={
            "task_id": task.id,
            "preference_type": task.preference_kind,
            "from_index": from_index,
            "to_index": siblings.index(task),
        },
    )
    return task


async def recompute_capacity(
    session: AsyncSession,
    user: User,
    day: LogicalDay,
    *,
    busy: list[tuple] | None = None,
    calendar_state: str | None = None,
) -> LogicalDay:
    """Recompute committed minutes, capacity, and the at-risk flag for a day."""
    tasks = await tasks_for_day(session, day)
    open_primaries = [t for t in tasks if t.is_primary and not t.is_complete]

    committed = sum(t.estimate_minutes or 0 for t in open_primaries)
    has_unestimated = any(t.estimate_minutes is None for t in open_primaries)

    result = capacity.compute(
        snapshot=day.shape_snapshot,
        anchor=day.anchor_date,
        tz=day.timezone,
        ratio=float(day.capacity_ratio),
        busy=busy,
        committed_minutes=committed,
        has_unestimated_primary=has_unestimated,
    )

    was_at_risk = day.is_at_risk
    day.committed_minutes = committed
    day.capacity_base_minutes = result.base_minutes
    day.busy_minutes_subtracted = result.busy_minutes_subtracted
    day.threshold_minutes = result.threshold_minutes
    day.is_indeterminate = result.is_indeterminate
    day.indeterminate_reason = result.indeterminate_reason
    day.is_at_risk = result.is_at_risk
    if result.is_at_risk:
        day.ever_at_risk = True
    if calendar_state is not None:
        day.calendar_state = calendar_state

    events.record(
        session,
        user_id=user.id,
        name="day_capacity_computed",
        logical_day_id=day.id,
        anchor_date=day.anchor_date,
        properties={
            "focus_block_minutes": result.base_minutes + result.busy_minutes_subtracted,
            "busy_minutes_subtracted": result.busy_minutes_subtracted,
            "capacity_base_minutes": result.base_minutes,
            "ratio": float(day.capacity_ratio),
            "threshold_minutes": result.threshold_minutes,
            "calendar_state": day.calendar_state,
            "is_indeterminate": result.is_indeterminate,
            "indeterminate_reason": result.indeterminate_reason,
        },
    )

    # The flag events fire on transition only, never on every recomputation.
    if result.is_at_risk and not was_at_risk:
        events.record(
            session,
            user_id=user.id,
            name="day_risk_flag_raised",
            logical_day_id=day.id,
            anchor_date=day.anchor_date,
            properties={
                "committed_minutes": committed,
                "threshold_minutes": result.threshold_minutes,
                "primary_count": len(open_primaries),
            },
        )
    elif was_at_risk and not result.is_at_risk:
        events.record(
            session,
            user_id=user.id,
            name="day_risk_flag_cleared",
            logical_day_id=day.id,
            anchor_date=day.anchor_date,
            properties={
                "committed_minutes": committed,
                "threshold_minutes": result.threshold_minutes,
                "primary_count": len(open_primaries),
            },
        )
    return day
