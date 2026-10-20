"""Event writer.

Every call adds a row to the session's current transaction. It is never flushed on
its own and never published out-of-band: if the surrounding state change rolls back,
so does the event. That is the whole mechanism behind acceptance criterion AC-08.

Event properties never carry user content. Task titles are logged as `title_length`,
and no calendar event text exists to log, because the `calendar.freebusy` scope
means it never reaches this server.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from doer.models import Event

SCHEMA_VERSION = 1


def record(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    name: str,
    properties: dict[str, Any] | None = None,
    logical_day_id: uuid.UUID | None = None,
    anchor_date: date | None = None,
) -> Event:
    """Append one event to the current transaction."""
    event = Event(
        user_id=user_id,
        logical_day_id=logical_day_id,
        anchor_date=anchor_date,
        name=name,
        properties=_clean(properties or {}),
        schema_version=SCHEMA_VERSION,
    )
    session.add(event)
    return event


def _clean(properties: dict[str, Any]) -> dict[str, Any]:
    """Make values JSON-safe without silently dropping information."""
    out: dict[str, Any] = {}
    for key, value in properties.items():
        if isinstance(value, uuid.UUID):
            out[key] = str(value)
        elif hasattr(value, "isoformat"):
            out[key] = value.isoformat()
        else:
            out[key] = value
    return out
