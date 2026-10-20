"""Per-user estimate cache.

Scoped to the user, never global. Two people writing "review the deck" mean
different amounts of work, and a shared cache would leak one person's calibration
into another's capacity math.
"""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from doer.models.base import Base, created_at_col, uuid_pk


def normalize(title: str) -> str:
    return " ".join(title.lower().split())


class EstimateCache(Base):
    __tablename__ = "estimate_cache"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    normalized_title: Mapped[str] = mapped_column(String(500), nullable=False)
    estimate_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    raw_model_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = created_at_col()

    __table_args__ = (
        UniqueConstraint("user_id", "normalized_title", name="uq_estimate_cache_user_title"),
    )
