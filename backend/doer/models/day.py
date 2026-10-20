"""Logical day: the materialized unit everything else is attributed to.

A logical day is a row, not a derivation. ADR 0001 and plan AC-13/AC-14 require a
snapshot taken at open (so a later settings edit cannot rewrite history) and a
uniqueness constraint on (user, anchor_date) (so lazy close is idempotent under
concurrency). Neither is possible if the day is computed from a timestamp at read time.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from doer.models.base import Base, created_at_col, updated_at_col, uuid_pk

VERDICTS = ("success", "failure", "neutral", "unscheduled")
CALENDAR_STATES = ("connected", "revoked", "stale", "absent")
INDETERMINATE_REASONS = ("no_focus_blocks", "unestimated_primaries")


class LogicalDay(Base):
    __tablename__ = "logical_days"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # The date the day began. Everything is attributed through this, never through
    # the raw completion timestamp.
    anchor_date: Mapped[date] = mapped_column(Date, nullable=False)

    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)

    # Real elapsed minutes between start_at and end_at. Differs from the configured
    # wall-clock duration on a DST transition day, which is the intended behavior.
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)

    # Frozen copy of the day shape and preference blocks as they were at open.
    shape_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)

    capacity_ratio: Mapped[float] = mapped_column(Numeric(3, 2), nullable=False)
    capacity_base_minutes: Mapped[int | None] = mapped_column(Integer)
    busy_minutes_subtracted: Mapped[int | None] = mapped_column(Integer)
    threshold_minutes: Mapped[int | None] = mapped_column(Integer)
    committed_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    calendar_state: Mapped[str] = mapped_column(String(16), nullable=False, default="absent")

    # Last successful availability read, kept so a failed refresh degrades to
    # stale data rather than to nothing. Only start and end instants: no event
    # titles exist to store, because freebusy never returns them.
    busy_snapshot: Mapped[list | None] = mapped_column(JSONB)
    calendar_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_indeterminate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    indeterminate_reason: Mapped[str | None] = mapped_column(String(32))
    is_at_risk: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Latching companion to is_at_risk. The over-commitment rate asks whether a
    # day was ever flagged, and the live flag clears as soon as work is completed,
    # so reading it at close would record false for most days that were flagged.
    ever_at_risk: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verdict: Mapped[str | None] = mapped_column(String(16))
    scheduled_primary_count: Mapped[int | None] = mapped_column(Integer)
    completed_primary_count: Mapped[int | None] = mapped_column(Integer)
    completion_ratio: Mapped[float | None] = mapped_column(Numeric(4, 3))

    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    @property
    def is_closed(self) -> bool:
        return self.closed_at is not None

    __table_args__ = (
        # The constraint AC-14 rests on: concurrent lazy closes cannot double-close
        # or double-carry-forward because they cannot both insert this row.
        UniqueConstraint("user_id", "anchor_date", name="uq_logical_day_user_anchor"),
        CheckConstraint("end_at > start_at", name="ck_day_bounds"),
        CheckConstraint(
            "verdict IS NULL OR verdict IN ('success','failure','neutral','unscheduled')",
            name="ck_day_verdict",
        ),
        CheckConstraint(
            "calendar_state IN ('connected','revoked','stale','absent')", name="ck_day_cal_state"
        ),
    )
