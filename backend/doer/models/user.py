"""User, auth session, OAuth token, and preference block models."""

import uuid
from datetime import datetime, time

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Time,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from doer.models.base import Base, created_at_col, updated_at_col, uuid_pk

FOCUS_KINDS = ("deep_work", "personal_project")
BLOCK_KINDS = (*FOCUS_KINDS, "personal", "social", "other")


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    google_sub: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    name: Mapped[str | None] = mapped_column(String(255))

    # Fixed account-level IANA timezone. All day boundaries resolve against this.
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")

    # Current day shape. Logical days snapshot it at open, so editing it never
    # rewrites a day that is already open or closed.
    day_start_time: Mapped[time] = mapped_column(Time, nullable=False, default=time(9, 0))
    day_duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=16 * 60)

    capacity_ratio: Mapped[float] = mapped_column(Numeric(3, 2), nullable=False, default=0.50)

    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    blocks: Mapped[list["PreferenceBlock"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="PreferenceBlock.start_offset_minutes",
    )
    oauth_token: Mapped["OAuthToken | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )

    __table_args__ = (
        CheckConstraint("day_duration_minutes BETWEEN 60 AND 1440", name="ck_user_day_duration"),
        CheckConstraint("capacity_ratio > 0 AND capacity_ratio <= 1", name="ck_user_ratio"),
    )


class AuthSession(Base):
    """Opaque server-side session. The cookie carries the raw token; we store its hash."""

    __tablename__ = "auth_sessions"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = created_at_col()


class OAuthToken(Base):
    """Encrypted Google tokens. Plaintext never touches a column."""

    __tablename__ = "oauth_tokens"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    refresh_token_encrypted: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    access_token_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary)
    access_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scopes: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_reason: Mapped[str | None] = mapped_column(String(64))

    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    user: Mapped[User] = relationship(back_populates="oauth_token")

    __table_args__ = (CheckConstraint("status IN ('active','revoked')", name="ck_oauth_status"),)


class PreferenceBlock(Base):
    """A typed slice of the user's day, stored as wall-clock offsets from day start.

    Offsets rather than wall-clock times is what makes a block crossing midnight
    (for example 23:00 to 00:30 inside a 14:00 day) representable without special cases.
    """

    __tablename__ = "preference_blocks"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    start_offset_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    end_offset_minutes: Mapped[int] = mapped_column(Integer, nullable=False)

    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    user: Mapped[User] = relationship(back_populates="blocks")

    @property
    def is_focus(self) -> bool:
        return self.kind in FOCUS_KINDS

    @property
    def duration_minutes(self) -> int:
        return self.end_offset_minutes - self.start_offset_minutes

    __table_args__ = (
        CheckConstraint(
            "kind IN ('deep_work','personal_project','personal','social','other')",
            name="ck_block_kind",
        ),
        CheckConstraint("start_offset_minutes >= 0", name="ck_block_start_nonneg"),
        CheckConstraint("end_offset_minutes > start_offset_minutes", name="ck_block_order"),
    )
