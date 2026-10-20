"""Duration estimation.

Estimates are 15-minute buckets. An LLM does not have the precision that "37
minutes" implies, and false precision makes the capacity math feel authoritative
when it is a guess.

Durability without a worker process: estimation state lives on the task row
(status, attempts, next_attempt_at), an attempt runs inline on creation, and a
sweeper retries anything stale. The sweep logic sits behind one callable that an
HTTP endpoint also exposes, so moving to a scheduler-driven sweep after deployment
is configuration rather than a rewrite (ADR 0001).
"""

from __future__ import annotations

import uuid
from datetime import timedelta

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from doer import events
from doer.config import get_settings
from doer.daytime import utcnow
from doer.db import SessionLocal
from doer.models import LogicalDay, Task, User
from doer.models.cache import EstimateCache, normalize
from doer.models.task import snap_to_bucket
from doer.services import llm, task_service

SYSTEM_PROMPT = """You estimate how long a single task will take one focused person.

Reply with a duration in minutes, chosen from these buckets only:
15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480.

Estimate the whole task to completion, including the thinking and setup around it,
not just the part that is visible in the title. Most real tasks take longer than
they sound. If the task is vague, assume an ordinary instance of it rather than
the smallest possible one."""

BACKOFF_SECONDS = (30, 120, 600)


class EstimateOut(BaseModel):
    minutes: int = Field(ge=5, le=600)


async def _call_model(title: str, notes: str | None, preference_kind: str) -> tuple[int, int, int]:
    """Returns (minutes, input_tokens, output_tokens).

    Token counts come back so cost is computed from what was actually billed
    rather than from an assumption baked into a spreadsheet.
    """
    settings = get_settings()
    detail = f"Task: {title}"
    if notes:
        detail += f"\nNotes: {notes}"
    detail += f"\nContext: this is {preference_kind.replace('_', ' ')} time."

    try:
        response = await llm.client().messages.parse(
            model=settings.estimation_model,
            max_tokens=256,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": detail}],
            output_format=EstimateOut,
        )
    except Exception as exc:  # noqa: BLE001 - classified by the caller
        raise llm.LLMUnavailable(str(exc)) from exc

    parsed = response.parsed_output
    if parsed is None:
        raise llm.LLMUnavailable("model returned no parsable estimate")

    usage = getattr(response, "usage", None)
    return (
        parsed.minutes,
        getattr(usage, "input_tokens", 0) if usage else 0,
        getattr(usage, "output_tokens", 0) if usage else 0,
    )


async def estimate_task(session: AsyncSession, user: User, task: Task, day: LogicalDay) -> Task:
    """One estimation attempt. Never raises: failure is recorded on the task."""
    cached = await session.scalar(
        select(EstimateCache).where(
            EstimateCache.user_id == user.id,
            EstimateCache.normalized_title == normalize(task.title),
        )
    )
    if cached is not None:
        await _apply(
            session,
            user,
            task,
            day,
            minutes=cached.estimate_minutes,
            raw=cached.raw_model_minutes,
            cache_hit=True,
            input_tokens=0,
            output_tokens=0,
            latency_ms=0,
        )
        return task

    task.estimation_attempts += 1
    started = utcnow()

    try:
        raw_minutes, input_tokens, output_tokens = await _call_model(
            task.title, task.notes, task.preference_kind
        )
    except llm.LLMUnavailable as exc:
        return await _record_failure(session, user, task, day, exc)

    latency_ms = int((utcnow() - started).total_seconds() * 1000)
    snapped = snap_to_bucket(raw_minutes)

    session.add(
        EstimateCache(
            user_id=user.id,
            normalized_title=normalize(task.title),
            estimate_minutes=snapped,
            raw_model_minutes=raw_minutes,
        )
    )
    await _apply(
        session,
        user,
        task,
        day,
        minutes=snapped,
        raw=raw_minutes,
        cache_hit=False,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        latency_ms=latency_ms,
    )
    return task


async def _apply(
    session: AsyncSession,
    user: User,
    task: Task,
    day: LogicalDay,
    *,
    minutes: int,
    raw: int,
    cache_hit: bool,
    input_tokens: int,
    output_tokens: int,
    latency_ms: int,
) -> None:
    snapped = snap_to_bucket(minutes)
    task.estimate_minutes = snapped
    task.raw_model_minutes = raw
    task.estimate_source = "model"
    task.estimation_status = "estimated"
    task.next_attempt_at = None
    task.estimation_error = None

    events.record(
        session,
        user_id=user.id,
        name="task_estimated",
        logical_day_id=day.id,
        anchor_date=day.anchor_date,
        properties={
            "task_id": task.id,
            "estimate_minutes": snapped,
            "raw_model_minutes": raw,
            "was_snapped": snapped != raw,
            "was_clamped": raw < 15 or raw > 480,
            "model": get_settings().estimation_model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "latency_ms": latency_ms,
            "attempt": task.estimation_attempts,
            "cache_hit": cache_hit,
        },
    )


async def _record_failure(
    session: AsyncSession, user: User, task: Task, day: LogicalDay, exc: Exception
) -> Task:
    settings = get_settings()
    will_retry = task.estimation_attempts < settings.estimation_max_attempts

    if will_retry:
        delay = BACKOFF_SECONDS[min(task.estimation_attempts - 1, len(BACKOFF_SECONDS) - 1)]
        task.next_attempt_at = utcnow() + timedelta(seconds=delay)
        task.estimation_status = "pending"
    else:
        # Out of attempts. The task stays usable and unestimated, which makes its
        # day read indeterminate rather than falsely safe.
        task.next_attempt_at = None
        task.estimation_status = "failed"

    task.estimation_error = type(exc).__name__

    events.record(
        session,
        user_id=user.id,
        name="task_estimation_failed",
        logical_day_id=day.id,
        anchor_date=day.anchor_date,
        properties={
            "task_id": task.id,
            "attempt": task.estimation_attempts,
            "error_class": type(exc).__name__,
            "will_retry": will_retry,
            "next_attempt_at": task.next_attempt_at,
        },
    )
    return task


async def estimate_in_background(task_id: uuid.UUID) -> None:
    """Run one attempt in its own session, detached from the request."""
    async with SessionLocal() as session:
        try:
            row = await session.execute(
                select(Task, LogicalDay, User)
                .join(LogicalDay, Task.logical_day_id == LogicalDay.id)
                .join(User, Task.user_id == User.id)
                .where(Task.id == task_id)
            )
            found = row.one_or_none()
            if found is None:
                return
            task, day, user = found
            if task.estimation_status == "estimated":
                return

            await estimate_task(session, user, task, day)
            await task_service.recompute_capacity(session, user, day)
            await session.commit()
        except Exception:
            await session.rollback()


async def sweep() -> int:
    """Retry every estimate that is due.

    Idempotent: a task already estimated is skipped, so running the sweep twice
    neither double-counts attempts nor double-bills. This is the single callable
    the in-process loop and the HTTP endpoint both use.
    """
    now = utcnow()
    async with SessionLocal() as session:
        due = await session.execute(
            select(Task.id).where(
                Task.estimation_status == "pending",
                Task.estimate_minutes.is_(None),
                (Task.next_attempt_at.is_(None)) | (Task.next_attempt_at <= now),
            )
        )
        task_ids = list(due.scalars())

    for task_id in task_ids:
        await estimate_in_background(task_id)
    return len(task_ids)
