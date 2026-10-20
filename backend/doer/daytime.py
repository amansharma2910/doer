"""Logical day arithmetic.

The single hardest piece of Doer. A logical day is defined by a wall-clock start
time and a wall-clock duration in the user's fixed timezone, and it may span
midnight. Two consequences drive everything here:

1. A day's *real* elapsed time differs from its configured wall-clock duration on a
   DST transition day. A 15-hour day that contains a spring-forward transition
   really lasts 14 hours, and the user really does have one less hour to work, so
   capacity follows real elapsed minutes (plan AC-12).

2. Block positions are stored as wall-clock offsets from day start, not as clock
   times. A block at 23:00 to 00:30 inside a day that starts at 14:00 is simply
   offsets 540 to 630, with no midnight special case anywhere.

Every function takes an explicit timezone. Nothing here reads the system clock's
timezone, and no test may depend on it.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo


def _localize(naive: datetime, tz: str) -> datetime:
    """Attach a zone to a naive wall-clock time and convert to UTC.

    For a time that does not exist (inside a spring-forward gap) or occurs twice
    (inside a fall-back overlap), Python resolves deterministically via PEP 495
    fold semantics. Deterministic is what matters: the same input always yields the
    same instant, so a closed day can never be re-resolved differently later.
    """
    return naive.replace(tzinfo=ZoneInfo(tz)).astimezone(UTC)


def day_bounds(
    anchor: date, start_time: time, duration_minutes: int, tz: str
) -> tuple[datetime, datetime, int]:
    """Return (start_utc, end_utc, real_duration_minutes) for one logical day.

    The end is computed by wall-clock arithmetic on the local time, then converted.
    That is what makes a DST day genuinely shorter or longer in real terms.
    """
    naive_start = datetime.combine(anchor, start_time)
    naive_end = naive_start + timedelta(minutes=duration_minutes)

    start_utc = _localize(naive_start, tz)
    end_utc = _localize(naive_end, tz)

    real_minutes = int((end_utc - start_utc).total_seconds() // 60)
    return start_utc, end_utc, real_minutes


def offset_bounds(
    anchor: date, start_time: time, offset_start: int, offset_end: int, tz: str
) -> tuple[datetime, datetime, int]:
    """Resolve a wall-clock offset range within a day into real UTC instants."""
    naive_day_start = datetime.combine(anchor, start_time)
    naive_a = naive_day_start + timedelta(minutes=offset_start)
    naive_b = naive_day_start + timedelta(minutes=offset_end)

    a = _localize(naive_a, tz)
    b = _localize(naive_b, tz)
    return a, b, int((b - a).total_seconds() // 60)


def resolve_anchor_date(
    instant: datetime, start_time: time, duration_minutes: int, tz: str
) -> date | None:
    """Which logical day does this instant belong to?

    Returns None when the instant falls outside any day, which happens whenever the
    configured duration is shorter than 24 hours and the user acts during the gap.
    Callers decide what to do with that; this function does not guess.
    """
    if instant.tzinfo is None:
        raise ValueError("instant must be timezone-aware")

    local_date = instant.astimezone(ZoneInfo(tz)).date()

    # A day beginning yesterday can still be running (the 03:00 case), so the
    # candidate that starts earlier is checked first.
    for candidate in (local_date - timedelta(days=1), local_date):
        start, end, _ = day_bounds(candidate, start_time, duration_minutes, tz)
        if start <= instant < end:
            return candidate
    return None


def elapsed_anchor_dates(
    last_anchor: date, now: datetime, start_time: time, duration_minutes: int, tz: str
) -> list[date]:
    """Anchor dates strictly after last_anchor whose day has fully ended by `now`.

    Used by lazy close to catch up in order after the app has been shut for days.
    """
    out: list[date] = []
    cursor = last_anchor + timedelta(days=1)
    while True:
        _, end, _ = day_bounds(cursor, start_time, duration_minutes, tz)
        if end > now:
            break
        out.append(cursor)
        cursor += timedelta(days=1)
        if len(out) > 400:  # guard against a misconfigured clock looping forever
            break
    return out


def utcnow() -> datetime:
    return datetime.now(UTC)
