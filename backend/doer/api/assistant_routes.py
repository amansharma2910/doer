"""Assistant chat and the estimation sweep endpoint."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from doer.api.deps import current_user
from doer.api.tasks import _resolve_day, rule_error, serialize
from doer.db import get_session
from doer.models import User
from doer.schemas.task import TaskOut
from doer.services import assistant, estimation, llm, task_service
from doer.services.assistant import ProposedTask
from doer.services.task_service import TaskRuleViolation

router = APIRouter(prefix="/assistant", tags=["assistant"])


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


class ChatResponse(BaseModel):
    turn_id: str
    tasks: list[ProposedTask]


class ConfirmRequest(BaseModel):
    turn_id: str
    tasks: list[ProposedTask]
    edited_count: int = 0
    discarded_count: int = 0


@router.post("/chat")
async def chat(
    payload: ChatRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> ChatResponse:
    day = await _resolve_day(session, user)
    try:
        turn_id, tasks = await assistant.parse_message(session, user, day, payload.message)
    except llm.LLMUnavailable as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "the assistant is unavailable right now; you can still add tasks with the plus button",
        ) from exc
    return ChatResponse(turn_id=turn_id, tasks=tasks)


@router.post("/confirm", status_code=status.HTTP_201_CREATED)
async def confirm(
    payload: ConfirmRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[TaskOut]:
    """Commit a proposal. Nothing reached the database before this point."""
    day = await _resolve_day(session, user)

    if not payload.tasks:
        assistant.record_discard(
            session, user, day, turn_id=payload.turn_id, proposed=payload.discarded_count
        )
        return []

    created = []
    for proposed in payload.tasks:
        try:
            task = await task_service.create_task(
                session,
                user,
                day,
                title=proposed.title,
                is_primary=False,
                preference_kind=proposed.preference_kind,
                source="chat",
            )
        except TaskRuleViolation as exc:
            raise rule_error(exc) from exc

        # The assistant already produced an estimate, so there is no reason to
        # pay for a second model call to re-derive it.
        await task_service.set_estimate(
            session,
            user,
            task,
            day,
            minutes=proposed.estimate_minutes,
            source="model",
            raw_minutes=proposed.estimate_minutes,
        )
        created.append(task)

    assistant.record_confirmation(
        session,
        user,
        day,
        turn_id=payload.turn_id,
        confirmed=len(created),
        edited=payload.edited_count,
        discarded=payload.discarded_count,
    )
    await task_service.recompute_capacity(session, user, day)
    return [serialize(t, day) for t in created]


@router.post("/sweep")
async def sweep(user: User = Depends(current_user)) -> dict:
    """Retry due estimates on demand.

    The same callable the in-process loop runs. Exposed so that a scheduler can
    drive it once Doer is deployed somewhere without an always-on process, which
    makes that move configuration rather than a rewrite.
    """
    swept = await asyncio.shield(estimation.sweep())
    return {"swept": swept}
