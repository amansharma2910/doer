"""Request and response shapes for settings, blocks, and days."""

from __future__ import annotations

from datetime import time

from pydantic import BaseModel, Field, field_validator

from doer.models.user import BLOCK_KINDS


class DayShapeUpdate(BaseModel):
    timezone: str | None = None
    day_start_time: time | None = None
    day_duration_minutes: int | None = Field(default=None, ge=60, le=1440)
    capacity_ratio: float | None = Field(default=None, gt=0, le=1)

    @field_validator("timezone")
    @classmethod
    def _known_zone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"unknown IANA timezone: {value}") from exc
        return value


class BlockIn(BaseModel):
    kind: str
    start_offset_minutes: int = Field(ge=0, le=1440)
    end_offset_minutes: int = Field(ge=1, le=1440)

    @field_validator("kind")
    @classmethod
    def _known_kind(cls, value: str) -> str:
        if value not in BLOCK_KINDS:
            raise ValueError(f"kind must be one of {BLOCK_KINDS}")
        return value

    @field_validator("end_offset_minutes")
    @classmethod
    def _ordered(cls, value: int, info) -> int:
        start = info.data.get("start_offset_minutes")
        if start is not None and value <= start:
            raise ValueError("end_offset_minutes must be after start_offset_minutes")
        return value


class BlockOut(BaseModel):
    id: str
    kind: str
    start_offset_minutes: int
    end_offset_minutes: int
    is_focus: bool


class DayOut(BaseModel):
    id: str
    anchor_date: str
    start_at: str
    end_at: str
    timezone: str
    duration_minutes: int
    capacity_base_minutes: int | None
    busy_minutes_subtracted: int | None
    threshold_minutes: int | None
    committed_minutes: int
    calendar_state: str
    is_indeterminate: bool
    indeterminate_reason: str | None
    is_at_risk: bool
    closed_at: str | None
    verdict: str | None
