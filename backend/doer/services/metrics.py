"""Rolling up a closed day into its aggregate row.

Costs are computed from the token counts actually logged on events, not from an
assumption. Prices live in configuration rather than in this query, so changing a
price never silently rewrites what past days cost.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from doer.config import get_settings
from doer.models import Event, LogicalDay, Task, User
from doer.models.metrics import DailyMetrics

# USD per million tokens. Sourced from the tracking plan's unit economics.
PRICES = {
    "claude-haiku-4-5": (Decimal("1.00"), Decimal("5.00")),
    "claude-opus-5": (Decimal("5.00"), Decimal("25.00")),
    "claude-sonnet-5": (Decimal("3.00"), Decimal("15.00")),
}


def cost_for(model: str, input_tokens: int, output_tokens: int) -> Decimal:
    prices = PRICES.get(model)
    if prices is None:
        return Decimal(0)
    per_in, per_out = prices
    million = Decimal(1_000_000)
    return (Decimal(input_tokens) * per_in + Decimal(output_tokens) * per_out) / million


async def roll_up(
    session: AsyncSession,
    user: User,
    day: LogicalDay,
    *,
    tasks: list[Task] | None = None,
) -> DailyMetrics:
    """Summarize a day.

    `tasks` must be the day's membership as it stood BEFORE carry-forward moved
    incomplete tasks off it. Re-querying here instead would count only what
    remained, under-reporting scheduled primaries on precisely the days that had
    unfinished work, which is most failed days. That would quietly corrupt the
    denominator of the north star metric.
    """
    settings = get_settings()

    if tasks is None:
        tasks = list(
            (await session.scalars(select(Task).where(Task.logical_day_id == day.id))).all()
        )
    events = list(
        (
            await session.scalars(
                select(Event).where(Event.user_id == user.id, Event.anchor_date == day.anchor_date)
            )
        ).all()
    )

    primaries = [t for t in tasks if t.is_primary]
    non_primaries = [t for t in tasks if not t.is_primary]
    open_primaries = [t for t in primaries if not t.is_complete]

    estimation_events = [e for e in events if e.name == "task_estimated"]
    chat_events = [e for e in events if e.name == "assistant_proposal_returned"]

    est_in = sum(e.properties.get("input_tokens", 0) for e in estimation_events)
    est_out = sum(e.properties.get("output_tokens", 0) for e in estimation_events)
    chat_in = sum(e.properties.get("input_tokens", 0) for e in chat_events)
    chat_out = sum(e.properties.get("output_tokens", 0) for e in chat_events)

    cost = cost_for(settings.estimation_model, est_in, est_out) + cost_for(
        settings.chat_model, chat_in, chat_out
    )

    actuals = [t.actual_minutes for t in tasks if t.actual_minutes is not None]

    values = dict(
        user_id=user.id,
        anchor_date=day.anchor_date,
        scheduled_primary_count=len(primaries),
        scheduled_non_primary_count=len(non_primaries),
        completed_primary_count=len([t for t in primaries if t.is_complete]),
        completed_non_primary_count=len([t for t in non_primaries if t.is_complete]),
        carried_in_count=len([e for e in events if e.name == "task_carried_forward"]),
        carried_out_count=len([t for t in tasks if not t.is_complete]),
        total_estimated_minutes=sum(t.estimate_minutes or 0 for t in tasks),
        total_actual_minutes=sum(actuals) if actuals else None,
        unestimated_primary_count=len([t for t in open_primaries if t.estimate_minutes is None]),
        capacity_base_minutes=day.capacity_base_minutes,
        busy_minutes_subtracted=day.busy_minutes_subtracted,
        threshold_minutes=day.threshold_minutes,
        committed_minutes=day.committed_minutes,
        was_at_risk=day.is_at_risk,
        is_indeterminate=day.is_indeterminate,
        verdict=day.verdict,
        completion_ratio=day.completion_ratio,
        calendar_state=day.calendar_state,
        estimation_calls=len([e for e in estimation_events if not e.properties.get("cache_hit")]),
        estimation_input_tokens=est_in,
        estimation_output_tokens=est_out,
        chat_turns=len(chat_events),
        chat_input_tokens=chat_in,
        chat_output_tokens=chat_out,
        inference_cost_usd=cost,
    )

    stmt = (
        pg_insert(DailyMetrics)
        .values(**values)
        .on_conflict_do_update(
            index_elements=["user_id", "anchor_date"],
            set_={k: v for k, v in values.items() if k not in ("user_id", "anchor_date")},
        )
    )
    await session.execute(stmt)
    result = await session.execute(
        select(DailyMetrics).where(
            DailyMetrics.user_id == user.id, DailyMetrics.anchor_date == day.anchor_date
        )
    )
    return result.scalar_one()


async def verdict_from_events(session: AsyncSession, user: User, anchor) -> str | None:
    """Recompute a verdict from the log alone.

    The check that makes the log authoritative rather than decorative: if this
    disagrees with the stored verdict, the stored one is wrong.
    """
    event = await session.scalar(
        select(Event)
        .where(Event.user_id == user.id, Event.anchor_date == anchor, Event.name == "day_scored")
        .order_by(Event.occurred_at.desc())
        .limit(1)
    )
    if event is None:
        return None

    from doer.services.close_service import verdict_for

    scheduled = event.properties["scheduled_primary_count"]
    completed = event.properties["completed_primary_count"]
    total = scheduled if scheduled else 0
    return verdict_for(max(total, scheduled), scheduled, completed)
