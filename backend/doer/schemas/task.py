"""Task request and response shapes."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from doer.models.user import BLOCK_KINDS


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    notes: str | None = None
    is_primary: bool = False
    preference_kind: str = "deep_work"
    anchor_date: str | None = None

    @field_validator("preference_kind")
    @classmethod
    def _known_kind(cls, value: str) -> str:
        if value not in BLOCK_KINDS:
            raise ValueError(f"preference_kind must be one of {BLOCK_KINDS}")
        return value


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    notes: str | None = None
    preference_kind: str | None = None
    estimate_minutes: int | None = Field(default=None, ge=1, le=8 * 60)


class ReorderRequest(BaseModel):
    to_index: int = Field(ge=0)


class PrimaryRequest(BaseModel):
    is_primary: bool


class TaskOut(BaseModel):
    id: str
    logical_day_id: str
    anchor_date: str
    title: str
    notes: str | None
    is_primary: bool
    preference_kind: str
    sort_index: int
    estimate_minutes: int | None
    estimate_source: str | None
    estimation_status: str
    started_at: str | None
    completed_at: str | None
    actual_minutes: int | None
    carry_forward_count: int
    carry_forward_demoted: bool
    is_complete: bool
