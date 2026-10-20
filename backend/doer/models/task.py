"""Tasks.

Two rules in this model are contractual rather than incidental:

- A completed task is permanent. Deletion is refused by the service AND by a
  database trigger, so no ORM path, bulk operation, or cascade can remove one.
- At most 4 primary tasks per logical day. Enforced in the service because the
  carry-forward precedence rule has to demote within the same transaction, which a
  blunt database constraint would fight.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from doer.models.base import Base, created_at_col, updated_at_col, uuid_pk

MAX_PRIMARIES = 4
SUCCESS_RATIO = 0.75
MIN_PRIMARIES_TO_SCORE = 2

ESTIMATION_STATUSES = ("pending", "estimated", "failed")
ESTIMATE_SOURCES = ("model", "user")

# Estimates are expressed in 15-minute buckets. An LLM does not have the precision
# that "37 minutes" implies, and buckets keep the estimated-versus-actual corpus
# analyzable.
BUCKET_MINUTES = 15
MIN_ESTIMATE_MINUTES = 15
MAX_ESTIMATE_MINUTES = 8 * 60


def snap_to_bucket(minutes: int) -> int:
    """Round up to the next 15-minute bucket, then clamp into the sane range."""
    snapped = -(-minutes // BUCKET_MINUTES) * BUCKET_MINUTES
    return max(MIN_ESTIMATE_MINUTES, min(MAX_ESTIMATE_MINUTES, snapped))


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    logical_day_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("logical_days.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    is_primary: Mapped[bool] = mapped_column(nullable=False, default=False)
    preference_kind: Mapped[str] = mapped_column(String(32), nullable=False, default="deep_work")
    sort_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    estimate_minutes: Mapped[int | None] = mapped_column(Integer)
    estimate_source: Mapped[str | None] = mapped_column(String(16))
    raw_model_minutes: Mapped[int | None] = mapped_column(Integer)
    estimation_status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    estimation_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    estimation_error: Mapped[str | None] = mapped_column(String(128))

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    actual_minutes: Mapped[int | None] = mapped_column(Integer)

    carry_forward_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Set when carry-forward precedence took this task's primary slot. The plan
    # requires the user be told which tasks were demoted, and an event alone is
    # not a channel the interface can read.
    carry_forward_demoted: Mapped[bool] = mapped_column(nullable=False, default=False)

    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    @property
    def is_complete(self) -> bool:
        return self.completed_at is not None

    @property
    def counts_toward_capacity(self) -> bool:
        return self.is_primary and not self.is_complete and self.estimate_minutes is not None

    __table_args__ = (
        CheckConstraint(
            "estimation_status IN ('pending','estimated','failed')", name="ck_task_est_status"
        ),
        CheckConstraint(
            "estimate_source IS NULL OR estimate_source IN ('model','user')",
            name="ck_task_est_source",
        ),
        CheckConstraint(
            "estimate_minutes IS NULL OR estimate_minutes % 15 = 0", name="ck_task_bucket"
        ),
        CheckConstraint("carry_forward_count >= 0", name="ck_task_carry_nonneg"),
    )
