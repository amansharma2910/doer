"""Logical day routes."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from doer.api.deps import current_user
from doer.db import get_session
from doer.models import LogicalDay, User
from doer.schemas.day import DayOut
from doer.services import close_service, day_service

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
