"""Opening, resolving, and snapshotting logical days."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from doer import events
from doer.daytime import day_bounds, resolve_anchor_date, utcnow
from doer.models import LogicalDay, PreferenceBlock, User
from doer.services import capacity


async def _blocks(session: AsyncSession, user: User) -> list[PreferenceBlock]:
    result = await session.execute(
        select(PreferenceBlock)
        .where(PreferenceBlock.user_id == user.id)
        .order_by(PreferenceBlock.start_offset_minutes)
    )
    return list(result.scalars())


def project_blocks(blocks: list[PreferenceBlock]) -> list[dict]:
    return [
        {
            "id": str(b.id),
            "kind": b.kind,
            "start_offset_minutes": b.start_offset_minutes,
            "end_offset_minutes": b.end_offset_minutes,
        }
        for b in blocks
    ]


def build_snapshot(user: User, blocks: list[PreferenceBlock]) -> dict:
    """Freeze the shape and blocks as they are right now.

    The shape half is never recomputed: changing the day shape tomorrow cannot
    alter what today's capacity was calculated against (AC-13). The block half is
    refreshable through `refresh_blocks`, because AC-13 scopes that freeze to the
    day shape (start time and duration), and the dashboard asks for a focus block
    in terms that only make sense if adding one counts today.
    """
    return {
        "day_start_time": user.day_start_time.isoformat(),
        "day_duration_minutes": user.day_duration_minutes,
        "timezone": user.timezone,
        "capacity_ratio": float(user.capacity_ratio),
        "blocks": project_blocks(blocks),
    }


async def get_day(session: AsyncSession, user: User, anchor: date) -> LogicalDay | None:
    result = await session.execute(
        select(LogicalDay).where(LogicalDay.user_id == user.id, LogicalDay.anchor_date == anchor)
    )
    return result.scalar_one_or_none()


async def open_day(session: AsyncSession, user: User, anchor: date) -> LogicalDay:
    """Materialize the logical day for `anchor`, or return the existing one.

    Insert-on-conflict-do-nothing plus a re-select is what makes this safe under
    concurrency: two simultaneous requests cannot both create the row, because the
    unique constraint on (user_id, anchor_date) refuses the second one (AC-14).
    """
    existing = await get_day(session, user, anchor)
    if existing is not None:
        return existing

    blocks = await _blocks(session, user)
    snapshot = build_snapshot(user, blocks)
    start_at, end_at, real_minutes = day_bounds(
        anchor, user.day_start_time, user.day_duration_minutes, user.timezone
    )
    cap = capacity.compute(
        snapshot=snapshot,
        anchor=anchor,
        tz=user.timezone,
        ratio=float(user.capacity_ratio),
    )

    stmt = (
        pg_insert(LogicalDay)
        .values(
            id=uuid.uuid4(),
            user_id=user.id,
            anchor_date=anchor,
            start_at=start_at,
            end_at=end_at,
            timezone=user.timezone,
            duration_minutes=real_minutes,
            shape_snapshot=snapshot,
            capacity_ratio=float(user.capacity_ratio),
            capacity_base_minutes=cap.base_minutes,
            busy_minutes_subtracted=cap.busy_minutes_subtracted,
            threshold_minutes=cap.threshold_minutes,
            committed_minutes=0,
            calendar_state="absent",
            is_indeterminate=cap.is_indeterminate,
            indeterminate_reason=cap.indeterminate_reason,
            is_at_risk=False,
        )
        .on_conflict_do_nothing(index_elements=["user_id", "anchor_date"])
        .returning(LogicalDay.id)
    )
    result = await session.execute(stmt)
    inserted_id = result.scalar_one_or_none()

    if inserted_id is None:
        # Lost the race. The winner's row is the real one.
        await session.flush()
        day = await get_day(session, user, anchor)
        assert day is not None
        return day

    day = await get_day(session, user, anchor)
    assert day is not None

    events.record(
        session,
        user_id=user.id,
        name="logical_day_opened",
        logical_day_id=day.id,
        anchor_date=anchor,
        properties={
            "start_at": start_at,
            "end_at": end_at,
            "duration_minutes": real_minutes,
            "timezone": user.timezone,
            "day_shape_snapshot": snapshot,
        },
    )
    events.record(
        session,
        user_id=user.id,
        name="day_capacity_computed",
        logical_day_id=day.id,
        anchor_date=anchor,
        properties={
            "focus_block_minutes": cap.base_minutes + cap.busy_minutes_subtracted,
            "busy_minutes_subtracted": cap.busy_minutes_subtracted,
            "capacity_base_minutes": cap.base_minutes,
            "ratio": float(user.capacity_ratio),
            "threshold_minutes": cap.threshold_minutes,
            "calendar_state": "absent",
            "is_indeterminate": cap.is_indeterminate,
            "indeterminate_reason": cap.indeterminate_reason,
        },
    )
    return day


async def refresh_blocks(
    session: AsyncSession, user: User, now: datetime | None = None
) -> LogicalDay | None:
    """Re-freeze the preference blocks onto the day in progress.

    Returns the day when its snapshot changed, so the caller can recompute
    capacity against it, and None when there is nothing to refresh.

    Two things it deliberately does not do. It never materializes a day, because
    editing settings should not open one the user has not reached yet. It never
    touches a closed day, because that day has already been scored.
    """
    now = now or utcnow()
    anchor = resolve_anchor_date(now, user.day_start_time, user.day_duration_minutes, user.timezone)
    if anchor is None:
        return None
    day = await get_day(session, user, anchor)
    if day is None or day.is_closed:
        return None
    # Replaced rather than mutated in place: a plain dict on a JSONB column is not
    # tracked for mutation, so assigning a new one is what marks the row dirty.
    day.shape_snapshot = {
        **day.shape_snapshot,
        "blocks": project_blocks(await _blocks(session, user)),
    }
    return day


async def current_day(
    session: AsyncSession, user: User, now: datetime | None = None
) -> LogicalDay | None:
    """The logical day containing `now`, opening it if it does not exist yet.

    Returns None when `now` falls in the gap between days, which is possible for any
    day shape shorter than 24 hours. The caller surfaces that rather than guessing.
    """
    now = now or utcnow()
    anchor = resolve_anchor_date(now, user.day_start_time, user.day_duration_minutes, user.timezone)
    if anchor is None:
        return None
    return await open_day(session, user, anchor)
