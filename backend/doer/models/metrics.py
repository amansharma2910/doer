"""Per-day aggregate rows.

A read convenience, never a source of truth. Everything here is derivable from
the event log, and a test asserts the two agree. The log is what survives a
disagreement.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from doer.models.base import Base, created_at_col, updated_at_col, uuid_pk


class DailyMetrics(Base):
    __tablename__ = "daily_metrics"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    anchor_date: Mapped[date] = mapped_column(Date, nullable=False)

    scheduled_primary_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    scheduled_non_primary_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_primary_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_non_primary_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    carried_in_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    carried_out_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    total_estimated_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_actual_minutes: Mapped[int | None] = mapped_column(Integer)
    unestimated_primary_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    capacity_base_minutes: Mapped[int | None] = mapped_column(Integer)
    busy_minutes_subtracted: Mapped[int | None] = mapped_column(Integer)
    threshold_minutes: Mapped[int | None] = mapped_column(Integer)
    committed_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    was_at_risk: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_indeterminate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    verdict: Mapped[str | None] = mapped_column(String(16))
    completion_ratio: Mapped[float | None] = mapped_column(Numeric(4, 3))
    calendar_state: Mapped[str] = mapped_column(String(16), nullable=False, default="absent")

    estimation_calls: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    estimation_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    estimation_output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    chat_turns: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    chat_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    chat_output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    inference_cost_usd: Mapped[float] = mapped_column(Numeric(10, 6), nullable=False, default=0)

    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    __table_args__ = (
        UniqueConstraint("user_id", "anchor_date", name="uq_daily_metrics_user_anchor"),
    )
