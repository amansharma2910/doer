"""Task routes."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from doer.api.deps import current_user
from doer.db import get_session
from doer.models import LogicalDay, Task, User
from doer.schemas.task import (
    PrimaryRequest,
    ReorderRequest,
    TaskCreate,
    TaskOut,
    TaskUpdate,
)
from doer.services import close_service, day_service, task_service
from doer.services.task_service import TaskRuleViolation

router = APIRouter(prefix="/tasks", tags=["tasks"])


def serialize(task: Task, day: LogicalDay) -> TaskOut:
    return TaskOut(
        id=str(task.id),
        logical_day_id=str(task.logical_day_id),
        anchor_date=day.anchor_date.isoformat(),
        title=task.title,
        notes=task.notes,
        is_primary=task.is_primary,
        preference_kind=task.preference_kind,
        sort_index=task.sort_index,
        estimate_minutes=task.estimate_minutes,
        estimate_source=task.estimate_source,
        estimation_status=task.estimation_status,
        started_at=task.started_at.isoformat() if task.started_at else None,
        completed_at=task.completed_at.isoformat() if task.completed_at else None,
        actual_minutes=task.actual_minutes,
        carry_forward_count=task.carry_forward_count,
        is_complete=task.is_complete,
    )


def rule_error(exc: TaskRuleViolation) -> HTTPException:
    """Refusals carry the remedy, so the interface can offer a way forward."""
    return HTTPException(
        status.HTTP_409_CONFLICT,
        detail={"message": str(exc), "code": exc.code, "remedy": exc.remedy},
    )


async def _resolve_day(session: AsyncSession, user: User) -> LogicalDay:
    """Catch up on any elapsed days, then return the day in progress.

    Close runs here rather than on a timer. That is what makes the app correct
    after being shut for a week: the next read closes every elapsed day in order.
    """
    await close_service.close_elapsed_days(session, user)
    day = await day_service.current_day(session, user)
    if day is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "the current time falls outside your defined day",
        )
    return day


async def _load(session: AsyncSession, user: User, task_id: uuid.UUID) -> tuple[Task, LogicalDay]:
    result = await session.execute(
        select(Task, LogicalDay)
        .join(LogicalDay, Task.logical_day_id == LogicalDay.id)
        .where(Task.id == task_id, Task.user_id == user.id)
    )
    row = result.one_or_none()
    if row is None:
        # 404 rather than 403 for another user's task: never confirm existence.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "task not found")
    return row[0], row[1]


@router.get("")
async def list_today(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> list[TaskOut]:
    day = await _resolve_day(session, user)
    return [serialize(t, day) for t in await task_service.tasks_for_day(session, day)]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create(
    payload: TaskCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> TaskOut:
    day = await _resolve_day(session, user)
    try:
        task = await task_service.create_task(
            session,
            user,
            day,
            title=payload.title,
            notes=payload.notes,
            is_primary=payload.is_primary,
            preference_kind=payload.preference_kind,
            source="manual",
        )
    except TaskRuleViolation as exc:
        raise rule_error(exc) from exc

    await task_service.recompute_capacity(session, user, day)
    return serialize(task, day)


@router.patch("/{task_id}")
async def update(
    task_id: uuid.UUID,
    payload: TaskUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> TaskOut:
    task, day = await _load(session, user, task_id)
    if task.is_complete:
        raise HTTPException(status.HTTP_409_CONFLICT, "completed tasks cannot be edited")

    if payload.title is not None:
        task.title = payload.title
    if payload.notes is not None:
        task.notes = payload.notes
    if payload.preference_kind is not None:
        task.preference_kind = payload.preference_kind
    if payload.estimate_minutes is not None:
        await task_service.set_estimate(
            session, user, task, day, minutes=payload.estimate_minutes, source="user"
        )

    await task_service.recompute_capacity(session, user, day)
    return serialize(task, day)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete(
    task_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    task, day = await _load(session, user, task_id)
    try:
        await task_service.delete_task(session, user, task, day)
    except TaskRuleViolation as exc:
        raise rule_error(exc) from exc
    await task_service.recompute_capacity(session, user, day)


@router.post("/{task_id}/complete")
async def complete(
    task_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> TaskOut:
    task, day = await _load(session, user, task_id)
    try:
        await task_service.complete_task(session, user, task, day)
    except TaskRuleViolation as exc:
        raise rule_error(exc) from exc
    await task_service.recompute_capacity(session, user, day)
    return serialize(task, day)


@router.delete("/{task_id}/complete")
async def reverse(
    task_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> TaskOut:
    task, day = await _load(session, user, task_id)
    try:
        await task_service.reverse_completion(session, user, task, day)
    except TaskRuleViolation as exc:
        raise rule_error(exc) from exc
    await task_service.recompute_capacity(session, user, day)
    return serialize(task, day)


@router.post("/{task_id}/primary")
async def set_primary(
    task_id: uuid.UUID,
    payload: PrimaryRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> TaskOut:
    task, day = await _load(session, user, task_id)
    try:
        await task_service.set_primary(session, user, task, day, primary=payload.is_primary)
    except TaskRuleViolation as exc:
        raise rule_error(exc) from exc
    await task_service.recompute_capacity(session, user, day)
    return serialize(task, day)


@router.post("/{task_id}/reorder")
async def reorder(
    task_id: uuid.UUID,
    payload: ReorderRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> TaskOut:
    task, day = await _load(session, user, task_id)
    await task_service.reorder(session, user, task, day, to_index=payload.to_index)
    return serialize(task, day)
