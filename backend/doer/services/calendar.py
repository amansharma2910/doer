"""Google Calendar availability.

Reads availability only, through `freebusy.query`. Event titles, descriptions,
attendees, and locations never reach this server, so there is nothing to discard
and nothing that could leak into a log by accident.

One consequence of that choice worth knowing: `calendar.freebusy` does not permit
enumerating the user's calendar list (that needs the broader `calendar.readonly`
scope), so v1 reads the primary calendar. Supporting more means letting the user
name them, not discovering them.
"""

from __future__ import annotations

from datetime import datetime

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from doer import events
from doer.daytime import utcnow
from doer.logging import get_logger
from doer.models import LogicalDay, User
from doer.services import capacity, task_service
from doer.services.token_store import CalendarUnavailable, access_token_for

FREEBUSY_ENDPOINT = "https://www.googleapis.com/calendar/v3/freeBusy"

log = get_logger(__name__)


async def fetch_busy(
    access_token: str, window_start: datetime, window_end: datetime
) -> list[tuple[datetime, datetime]]:
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            FREEBUSY_ENDPOINT,
            headers={"Authorization": f"Bearer {access_token}"},
            json={
                "timeMin": window_start.isoformat(),
                "timeMax": window_end.isoformat(),
                "items": [{"id": "primary"}],
            },
        )

    if response.status_code != 200:
        error = CalendarUnavailable(f"freebusy returned {response.status_code}")
        error.http_status = response.status_code
        raise error

    payload = response.json()
    intervals: list[tuple[datetime, datetime]] = []
    for entry in payload.get("calendars", {}).values():
        for slot in entry.get("busy", []):
            start = datetime.fromisoformat(slot["start"])
            end = datetime.fromisoformat(slot["end"])
            # Clip to the queried window: an event that began before the day
            # started only subtracts the part that falls inside it.
            start = max(start, window_start)
            end = min(end, window_end)
            if end > start:
                intervals.append((start, end))
    return capacity.merge_intervals(intervals)


def _stored(day: LogicalDay) -> list[tuple[datetime, datetime]]:
    return [
        (datetime.fromisoformat(s), datetime.fromisoformat(e)) for s, e in (day.busy_snapshot or [])
    ]


async def sync_day(
    session: AsyncSession, user: User, day: LogicalDay, *, force: bool = False
) -> LogicalDay:
    """Refresh the day's availability and recompute capacity.

    A failure never fails the caller. The app stays fully usable with the calendar
    disconnected, degraded to raw focus-block capacity with the day marked so the
    number is not mistaken for a calendar-aware one.
    """
    if day.is_closed and not force:
        return day

    try:
        token = await access_token_for(session, user)
    except CalendarUnavailable:
        return await _degrade(session, user, day, state="revoked")

    started = utcnow()
    try:
        busy = await fetch_busy(token, day.start_at, day.end_at)
    except (CalendarUnavailable, httpx.HTTPError) as exc:
        events.record(
            session,
            user_id=user.id,
            name="calendar_query_failed",
            logical_day_id=day.id,
            anchor_date=day.anchor_date,
            properties={
                "error_class": type(exc).__name__,
                "http_status": getattr(exc, "http_status", None),
                "fell_back_to": "cache" if day.busy_snapshot else "none",
            },
        )
        log.warning(
            "calendar.query_failed",
            anchor_date=str(day.anchor_date),
            error=type(exc).__name__,
            has_snapshot=bool(day.busy_snapshot),
        )
        # Keep using the last good snapshot, but say it is stale.
        return await _degrade(
            session, user, day, state="stale" if day.busy_snapshot else "absent", keep=True
        )

    day.busy_snapshot = [[s.isoformat(), e.isoformat()] for s, e in busy]
    day.calendar_synced_at = utcnow()

    events.record(
        session,
        user_id=user.id,
        name="calendar_queried",
        logical_day_id=day.id,
        anchor_date=day.anchor_date,
        properties={
            "window_start": day.start_at,
            "window_end": day.end_at,
            "calendar_count": 1,
            "interval_count": len(busy),
            "busy_minutes_total": sum(int((e - s).total_seconds() // 60) for s, e in busy),
            "latency_ms": int((utcnow() - started).total_seconds() * 1000),
            "source": "live",
            "is_stale": False,
        },
    )
    await task_service.recompute_capacity(session, user, day, busy=busy, calendar_state="connected")
    return day


async def _degrade(
    session: AsyncSession,
    user: User,
    day: LogicalDay,
    *,
    state: str,
    keep: bool = False,
) -> LogicalDay:
    busy = _stored(day) if keep else []
    await task_service.recompute_capacity(session, user, day, busy=busy, calendar_state=state)
    return day


def is_stale(day: LogicalDay) -> bool:
    """A snapshot taken before the day began no longer describes this day."""
    return day.calendar_synced_at is None or day.calendar_synced_at < day.start_at
