"""Doer Assistant: natural-language capture.

Scoped to capture and estimation in v1. It does not re-plan, reorder, or answer
analytics questions, and it does not decompose tasks into subtasks: without
context on dependencies and partial progress, decomposition would be wrong often
enough to erode trust in the estimates that the capacity math rests on.

Nothing is committed from a parse. The assistant returns a proposal, the user
confirms or edits it, and only then do tasks exist.
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from doer import events
from doer.config import get_settings
from doer.daytime import utcnow
from doer.models import LogicalDay, User
from doer.models.user import BLOCK_KINDS
from doer.services import llm

SYSTEM_PROMPT = f"""You turn what someone says into a list of concrete tasks for today.

Rules:
- One task per distinct piece of work. Do not split a single task into subtasks.
- Keep the person's own wording where you can. Do not invent work they did not mention.
- preference_kind must be one of: {", ".join(BLOCK_KINDS)}.
- If they said nothing task-like, return an empty list.

Estimate each task in minutes using these buckets only:
15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480."""


class ProposedTask(BaseModel):
    title: str = Field(max_length=500)
    preference_kind: str = "deep_work"
    estimate_minutes: int = Field(ge=5, le=600)


class Proposal(BaseModel):
    tasks: list[ProposedTask] = Field(default_factory=list)


async def parse_message(
    session: AsyncSession, user: User, day: LogicalDay, message: str
) -> tuple[str, list[ProposedTask]]:
    turn_id = str(uuid.uuid4())
    events.record(
        session,
        user_id=user.id,
        name="assistant_turn_sent",
        logical_day_id=day.id,
        anchor_date=day.anchor_date,
        properties={"turn_id": turn_id, "input_length": len(message)},
    )

    settings = get_settings()
    started = utcnow()
    try:
        response = await llm.client().messages.parse(
            model=settings.chat_model,
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": message}],
            output_format=Proposal,
        )
    except Exception as exc:  # noqa: BLE001
        raise llm.LLMUnavailable(str(exc)) from exc

    parsed = response.parsed_output or Proposal()
    tasks = [t for t in parsed.tasks if t.preference_kind in BLOCK_KINDS]

    usage = getattr(response, "usage", None)
    events.record(
        session,
        user_id=user.id,
        name="assistant_proposal_returned",
        logical_day_id=day.id,
        anchor_date=day.anchor_date,
        properties={
            "turn_id": turn_id,
            "proposed_task_count": len(tasks),
            "model": settings.chat_model,
            "input_tokens": getattr(usage, "input_tokens", 0) if usage else 0,
            "output_tokens": getattr(usage, "output_tokens", 0) if usage else 0,
            "latency_ms": int((utcnow() - started).total_seconds() * 1000),
        },
    )
    return turn_id, tasks


def record_confirmation(
    session: AsyncSession,
    user: User,
    day: LogicalDay,
    *,
    turn_id: str,
    confirmed: int,
    edited: int,
    discarded: int,
) -> None:
    """`edited` is the quality signal: a rising share means the parse is drifting."""
    events.record(
        session,
        user_id=user.id,
        name="assistant_proposal_confirmed",
        logical_day_id=day.id,
        anchor_date=day.anchor_date,
        properties={
            "turn_id": turn_id,
            "confirmed_count": confirmed,
            "edited_count": edited,
            "discarded_count": discarded,
        },
    )


def record_discard(
    session: AsyncSession, user: User, day: LogicalDay, *, turn_id: str, proposed: int
) -> None:
    events.record(
        session,
        user_id=user.id,
        name="assistant_proposal_discarded",
        logical_day_id=day.id,
        anchor_date=day.anchor_date,
        properties={"turn_id": turn_id, "proposed_task_count": proposed},
    )
