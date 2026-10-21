"""Logical day routes."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from doer.api.deps import current_user
from doer.daytime import grid_days, local_date, utcnow
from doer.db import get_session
from doer.models import LogicalDay, Task, User
from doer.schemas.day import DayOut
from doer.services import calendar, close_service, day_service

router = APIRouter(prefix="/days", tags=["days"])


def serialize(day: LogicalDay) -> DayOut:
    return DayOut(
        id=str(day.id),
        anchor_date=day.anchor_date.isoformat(),
        start_at=day.start_at.isoformat(),
        end_at=day.end_at.isoformat(),
        timezone=day.timezone,
        duration_minutes=day.duration_minutes,
        capacity_base_minutes=day.capacity_base_minutes,
        busy_minutes_subtracted=day.busy_minutes_subtracted,
        threshold_minutes=day.threshold_minutes,
        committed_minutes=day.committed_minutes,
        calendar_state=day.calendar_state,
        is_indeterminate=day.is_indeterminate,
        indeterminate_reason=day.indeterminate_reason,
        is_at_risk=day.is_at_risk,
        closed_at=day.closed_at.isoformat() if day.closed_at else None,
        verdict=day.verdict,
        calendar_synced_at=(day.calendar_synced_at.isoformat() if day.calendar_synced_at else None),
        calendar_is_stale=calendar.is_stale(day),
    )


class HeatmapCell(BaseModel):
    anchor_date: str
    completed_total: int
    completed_primary: int
    scheduled_primary: int
    verdict: str | None
    is_at_risk: bool


class HeatmapGrid(BaseModel):
    days: list[str]
    cells: list[HeatmapCell]


@router.get("/heatmap")
async def heatmap(
    weeks: int = Query(default=26, ge=1, le=53),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> HeatmapGrid:
    """The grid dates and the per-day cells for both heatmap views.

    The dates come from here rather than from the client because cells are keyed
    by anchor dates resolved in the user's timezone, and a client deriving them
    from its own clock puts the whole grid a day out for any offset ahead of UTC.

    View 1 colours by `completed_total`, which counts primary and non-primary
    completions together: non-primary work is excluded from the verdict, not from
    tracking. View 2 colours by `verdict` and is primary-only. The two views use
    different denominators on purpose.
    """
    days = grid_days(local_date(utcnow(), user.timezone), weeks)
    start, end = days[0], days[-1]
    rows = await session.execute(
        select(
            LogicalDay.anchor_date,
            LogicalDay.verdict,
            LogicalDay.is_at_risk,
            LogicalDay.scheduled_primary_count,
            func.count(Task.id).filter(Task.completed_at.isnot(None)).label("completed_total"),
            func.count(Task.id)
            .filter(Task.completed_at.isnot(None), Task.is_primary.is_(True))
            .label("completed_primary"),
        )
        .outerjoin(Task, Task.logical_day_id == LogicalDay.id)
        .where(
            LogicalDay.user_id == user.id,
            LogicalDay.anchor_date >= start,
            LogicalDay.anchor_date <= end,
        )
        .group_by(
            LogicalDay.anchor_date,
            LogicalDay.verdict,
            LogicalDay.is_at_risk,
            LogicalDay.scheduled_primary_count,
        )
        .order_by(LogicalDay.anchor_date)
    )
    return HeatmapGrid(
        days=[d.isoformat() for d in days],
        cells=[
            HeatmapCell(
                anchor_date=row.anchor_date.isoformat(),
                completed_total=row.completed_total,
                completed_primary=row.completed_primary,
                scheduled_primary=row.scheduled_primary_count or 0,
                verdict=row.verdict,
                is_at_risk=row.is_at_risk,
            )
            for row in rows
        ],
    )


@router.get("/current")
async def get_current_day(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> DayOut:
    # Catch up on elapsed days before answering, so a day that ended while the
    # app was closed is scored and carried forward rather than silently skipped.
    await close_service.close_elapsed_days(session, user)
    day = await day_service.current_day(session, user)
    if day is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "the current time falls outside your defined day; adjust your day shape "
            "in settings or wait for the next day to begin",
        )
    if calendar.is_stale(day):
        await calendar.sync_day(session, user, day)
    return serialize(day)


@router.post("/current/refresh-calendar")
async def refresh_calendar(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> DayOut:
    """Explicit refresh. Never fails the request: a calendar problem degrades."""
    day = await day_service.current_day(session, user)
    if day is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "outside your defined day")
    await calendar.sync_day(session, user, day, force=True)
    return serialize(day)


@router.get("/{anchor}")
async def get_day(
    anchor: date,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> DayOut:
    day = await day_service.get_day(session, user, anchor)
    if day is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no logical day for that anchor date")
    return serialize(day)
