"""Day close: scoring and carry-forward.

Close is lazy and idempotent. It runs on the next authenticated read rather than
on a timer, so a day still scores correctly when the app was never open at the
boundary (AC-04). Idempotency rests on two things: a row lock taken before the
closed_at check, and the unique constraint on (user_id, anchor_date) that stops two
racing transactions from both creating the next day.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from doer import events
from doer.daytime import utcnow
from doer.models import LogicalDay, Task, User
from doer.models.task import MAX_PRIMARIES, MIN_PRIMARIES_TO_SCORE, SUCCESS_RATIO
from doer.services import day_service, task_service


def verdict_for(total_tasks: int, scheduled_primaries: int, completed_primaries: int) -> str:
    """The 75% rule.

    A day with no tasks at all is unscheduled and paints nothing. A day with fewer
    than two primaries is neutral: it is excluded from streaks and rates, because
    a one-task day is either trivially easy or trivially harsh and tells us nothing.
    Scheduling one primary is also the easiest way to dodge ever failing, which is
    why the neutral rate is a tracked guardrail.
    """
    if total_tasks == 0:
        return "unscheduled"
    if scheduled_primaries < MIN_PRIMARIES_TO_SCORE:
        return "neutral"
    ratio = completed_primaries / scheduled_primaries
    return "success" if ratio >= SUCCESS_RATIO else "failure"


async def close_day(session: AsyncSession, user: User, anchor: date) -> LogicalDay | None:
    """Close one day. Safe to call repeatedly and concurrently."""
    locked = await session.execute(
        select(LogicalDay)
        .where(LogicalDay.user_id == user.id, LogicalDay.anchor_date == anchor)
        .with_for_update()
    )
    day = locked.scalar_one_or_none()
    if day is None or day.is_closed:
        return day

    tasks = await task_service.tasks_for_day(session, day)
    primaries = [t for t in tasks if t.is_primary]
    completed_primaries = [t for t in primaries if t.is_complete]

    verdict = verdict_for(len(tasks), len(primaries), len(completed_primaries))
    ratio = (len(completed_primaries) / len(primaries)) if primaries else None

    incomplete = [t for t in tasks if not t.is_complete]
    if incomplete:
        await _carry_forward(session, user, day, incomplete)

    day.closed_at = utcnow()
    day.verdict = verdict
    day.scheduled_primary_count = len(primaries)
    day.completed_primary_count = len(completed_primaries)
    day.completion_ratio = round(ratio, 3) if ratio is not None else None

    events.record(
        session,
        user_id=user.id,
        name="logical_day_closed",
        logical_day_id=day.id,
        anchor_date=anchor,
        properties={"closed_at": day.closed_at, "close_trigger": "lazy_read"},
    )
    events.record(
        session,
        user_id=user.id,
        name="day_scored",
        logical_day_id=day.id,
        anchor_date=anchor,
        properties={
            "scheduled_primary_count": len(primaries),
            "completed_primary_count": len(completed_primaries),
            "completion_ratio": day.completion_ratio,
            "verdict": verdict,
            "was_at_risk": day.is_at_risk,
            "committed_minutes": day.committed_minutes,
            "completed_minutes": sum(t.estimate_minutes or 0 for t in completed_primaries),
        },
    )
    return day


async def _carry_forward(
    session: AsyncSession, user: User, day: LogicalDay, incomplete: list[Task]
) -> None:
    """Roll incomplete tasks into the next day, applying precedence.

    Carried primaries claim slots ahead of tasks that were pre-assigned to tomorrow
    while it was still in the future. An unfinished commitment outranks a new
    intention, so the excess pre-assigned tasks demote to non-primary rather than
    the day quietly holding more than four primaries.
    """
    target_anchor = day.anchor_date + timedelta(days=1)
    target = await day_service.open_day(session, user, target_anchor)

    carried_primaries = [t for t in incomplete if t.is_primary]
    pre_assigned = [
        t
        for t in await task_service.tasks_for_day(session, target)
        if t.is_primary and not t.is_complete
    ]

    slots_left = max(0, MAX_PRIMARIES - len(carried_primaries))
    if len(pre_assigned) > slots_left:
        # Oldest pre-assigned tasks keep whatever slots remain; the rest demote.
        for demoted in sorted(pre_assigned, key=lambda t: t.created_at)[slots_left:]:
            demoted.is_primary = False
            events.record(
                session,
                user_id=user.id,
                name="task_demoted",
                logical_day_id=target.id,
                anchor_date=target_anchor,
                properties={"task_id": demoted.id, "trigger": "carry_forward_precedence"},
            )

    for task in incomplete:
        task.logical_day_id = target.id
        task.carry_forward_count += 1
        task.sort_index = await task_service._next_sort_index(session, target, task.preference_kind)
        events.record(
            session,
            user_id=user.id,
            name="task_carried_forward",
            logical_day_id=target.id,
            anchor_date=target_anchor,
            properties={
                "task_id": task.id,
                "from_anchor_date": day.anchor_date,
                "to_anchor_date": target_anchor,
                "carry_forward_count": task.carry_forward_count,
                "is_primary": task.is_primary,
            },
        )

    await session.flush()
    await task_service.recompute_capacity(session, user, target)


async def close_elapsed_days(
    session: AsyncSession, user: User, now: datetime | None = None
) -> list[LogicalDay]:
    """Close every day whose end has passed, oldest first.

    Ordering matters: a task that sat unfinished for three days must carry forward
    once per day it survived, landing on today with a count of three, not once with
    a count of one.
    """
    now = now or utcnow()
    closed: list[LogicalDay] = []

    # Re-query each pass rather than snapshotting the list once. Closing a day
    # creates the next one through carry-forward, and that new day may itself
    # already have elapsed. Taking the list up front stops after a single day and
    # silently loses every day in between, which is precisely the
    # app-was-closed-for-a-week case this function exists to handle.
    while True:
        anchor = await session.scalar(
            select(LogicalDay.anchor_date)
            .where(
                LogicalDay.user_id == user.id,
                LogicalDay.closed_at.is_(None),
                LogicalDay.end_at <= now,
            )
            .order_by(LogicalDay.anchor_date)
            .limit(1)
        )
        if anchor is None:
            return closed

        day = await close_day(session, user, anchor)
        if day is None or not day.is_closed:
            return closed
        closed.append(day)

        if len(closed) > 400:  # a misconfigured clock must not loop forever
            return closed
