"""Append-only event log.

Every row is written inside the same transaction as the state change it records.
That is what makes AC-08 ("exactly one event row per transition") provable: a
transaction that rolls back takes its event with it. An UPDATE/DELETE trigger
installed by the migration enforces append-only at the database, not just in code.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from doer.models.base import Base, uuid_pk


class Event(Base):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    logical_day_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("logical_days.id", ondelete="SET NULL"), index=True
    )
    anchor_date: Mapped[date | None] = mapped_column(Date, index=True)

    name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    properties: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
