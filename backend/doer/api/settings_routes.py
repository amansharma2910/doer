"""Day shape and preference block configuration."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from doer.api.deps import current_user
from doer.db import get_session
from doer.models import PreferenceBlock, User
from doer.models.user import FOCUS_KINDS
from doer.schemas.day import BlockIn, BlockOut, DayShapeUpdate
from doer.services import calendar, day_service, task_service

router = APIRouter(prefix="/settings", tags=["settings"])


def _serialize(block: PreferenceBlock) -> BlockOut:
    return BlockOut(
        id=str(block.id),
        kind=block.kind,
        start_offset_minutes=block.start_offset_minutes,
        end_offset_minutes=block.end_offset_minutes,
        is_focus=block.kind in FOCUS_KINDS,
    )


async def _all_blocks(session: AsyncSession, user: User) -> list[PreferenceBlock]:
    result = await session.execute(
        select(PreferenceBlock)
        .where(PreferenceBlock.user_id == user.id)
        .order_by(PreferenceBlock.start_offset_minutes)
    )
    return list(result.scalars())


async def _apply_to_open_day(session: AsyncSession, user: User) -> None:
    """Make a block edit count today rather than only from tomorrow.

    Blocks are not day shape. AC-13 freezes the shape so a day that has already
    been scored cannot be rewritten, and says nothing about blocks. The dashboard
    tells a user with no focus blocks to go and define one, which is only honest
    if doing so takes effect on the day they are looking at.

    The stored availability is passed back in so a calendar-connected user keeps
    their busy time subtracted instead of seeing the threshold jump.
    """
    day = await day_service.refresh_blocks(session, user)
    if day is None:
        return
    await task_service.recompute_capacity(session, user, day, busy=calendar.stored_busy(day))


@router.patch("/day-shape")
async def update_day_shape(
    payload: DayShapeUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Change the day shape.

    Takes effect from the next logical day. Days already open or closed keep the
    snapshot they were created with, so this can never rewrite history (AC-13).
    """
    if payload.timezone is not None:
        user.timezone = payload.timezone
    if payload.day_start_time is not None:
        user.day_start_time = payload.day_start_time
    if payload.day_duration_minutes is not None:
        user.day_duration_minutes = payload.day_duration_minutes
    if payload.capacity_ratio is not None:
        user.capacity_ratio = payload.capacity_ratio

    blocks = await _all_blocks(session, user)
    overflow = [b for b in blocks if b.end_offset_minutes > user.day_duration_minutes]
    if overflow:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{len(overflow)} preference block(s) extend past the new day duration; "
            "adjust or remove them first",
        )

    return {
        "timezone": user.timezone,
        "day_start_time": user.day_start_time.isoformat(),
        "day_duration_minutes": user.day_duration_minutes,
        "capacity_ratio": float(user.capacity_ratio),
        "applies_from": "next logical day",
    }


@router.get("/blocks")
async def list_blocks(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> list[BlockOut]:
    return [_serialize(b) for b in await _all_blocks(session, user)]


@router.post("/blocks", status_code=status.HTTP_201_CREATED)
async def create_block(
    payload: BlockIn,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> BlockOut:
    if payload.end_offset_minutes > user.day_duration_minutes:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"block ends at minute {payload.end_offset_minutes} but the day is only "
            f"{user.day_duration_minutes} minutes long",
        )

    existing = await _all_blocks(session, user)
    _reject_overlap(existing, payload.start_offset_minutes, payload.end_offset_minutes)

    block = PreferenceBlock(
        user_id=user.id,
        kind=payload.kind,
        start_offset_minutes=payload.start_offset_minutes,
        end_offset_minutes=payload.end_offset_minutes,
    )
    session.add(block)
    await session.flush()
    await _apply_to_open_day(session, user)
    return _serialize(block)


@router.delete("/blocks/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_block(
    block_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    result = await session.execute(
        select(PreferenceBlock).where(
            PreferenceBlock.id == block_id, PreferenceBlock.user_id == user.id
        )
    )
    block = result.scalar_one_or_none()
    if block is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "block not found")
    await session.delete(block)
    await session.flush()
    await _apply_to_open_day(session, user)


def _reject_overlap(
    existing: list[PreferenceBlock], start: int, end: int, *, skip_id: uuid.UUID | None = None
) -> None:
    for block in existing:
        if skip_id is not None and block.id == skip_id:
            continue
        if start < block.end_offset_minutes and end > block.start_offset_minutes:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"overlaps an existing {block.kind} block at minutes "
                f"{block.start_offset_minutes}-{block.end_offset_minutes}",
            )
