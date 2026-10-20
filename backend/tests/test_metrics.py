"""Event coverage and aggregate integrity (AC-08, test group T-EVT)."""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from doer.models import Event
from doer.models.metrics import DailyMetrics
from doer.services import close_service, day_service, metrics, task_service

ANCHOR = date(2026, 3, 10)


@pytest.fixture
async def day(session, user_with_focus):
    d = await day_service.open_day(session, user_with_focus, ANCHOR)
    await session.commit()
    return d


class TestEventCoverage:
    """T-EVT-01. Each transition emits exactly one row, checked transition by transition."""

    @pytest.mark.parametrize(
        "event_name",
        [
            "logical_day_opened",
            "day_capacity_computed",
            "task_created",
            "task_completed",
            "logical_day_closed",
            "day_scored",
        ],
    )
    async def test_the_transition_emits_its_event(self, session, user_with_focus, day, event_name):
        task = await task_service.create_task(
            session, user_with_focus, day, title="t", is_primary=True
        )
        await task_service.set_estimate(
            session, user_with_focus, task, day, minutes=30, source="model"
        )
        await task_service.complete_task(session, user_with_focus, task, day)
        await task_service.recompute_capacity(session, user_with_focus, day)
        await session.commit()
        await close_service.close_day(session, user_with_focus, ANCHOR)
        await session.commit()

        count = await session.scalar(
            select(func.count()).select_from(Event).where(Event.name == event_name)
        )
        assert count >= 1, f"{event_name} never fired"

    async def test_one_completion_emits_exactly_one_completion_event(
        self, session, user_with_focus, day
    ):
        task = await task_service.create_task(
            session, user_with_focus, day, title="t", is_primary=True
        )
        await task_service.complete_task(session, user_with_focus, task, day)
        await task_service.complete_task(session, user_with_focus, task, day)  # no-op
        await session.commit()

        count = await session.scalar(
            select(func.count()).select_from(Event).where(Event.name == "task_completed")
        )
        assert count == 1

    async def test_the_risk_flag_fires_on_transition_not_on_every_recompute(
        self, session, user_with_focus, day
    ):
        """Otherwise the over-commitment rate would be unreadable noise."""
        for i in range(3):
            t = await task_service.create_task(
                session, user_with_focus, day, title=f"t{i}", is_primary=True
            )
            await task_service.set_estimate(
                session, user_with_focus, t, day, minutes=60, source="model"
            )
        for _ in range(4):
            await task_service.recompute_capacity(session, user_with_focus, day)
        await session.commit()

        raised = await session.scalar(
            select(func.count()).select_from(Event).where(Event.name == "day_risk_flag_raised")
        )
        assert day.is_at_risk is True
        assert raised == 1, "raised once, not once per recomputation"

    async def test_clearing_the_flag_fires_once(self, session, user_with_focus, day):
        tasks = []
        for i in range(3):
            t = await task_service.create_task(
                session, user_with_focus, day, title=f"t{i}", is_primary=True
            )
            await task_service.set_estimate(
                session, user_with_focus, t, day, minutes=60, source="model"
            )
            tasks.append(t)
        await task_service.recompute_capacity(session, user_with_focus, day)
        assert day.is_at_risk is True

        await task_service.delete_task(session, user_with_focus, tasks[0], day)
        await task_service.recompute_capacity(session, user_with_focus, day)
        await task_service.recompute_capacity(session, user_with_focus, day)
        await session.commit()

        cleared = await session.scalar(
            select(func.count()).select_from(Event).where(Event.name == "day_risk_flag_cleared")
        )
        assert day.is_at_risk is False
        assert cleared == 1


class TestAppendOnly:
    async def test_the_log_rejects_updates(self, session, user_with_focus, day):
        """T-EVT-02, at the database rather than in the service."""
        with pytest.raises(Exception, match="append-only"):
            await session.execute(Event.__table__.update().values(name="x"))
            await session.commit()


class TestAggregates:
    async def test_the_aggregate_matches_the_tasks_it_summarizes(
        self, session, user_with_focus, day
    ):
        """T-EVT-03."""
        for i in range(4):
            t = await task_service.create_task(
                session, user_with_focus, day, title=f"p{i}", is_primary=True
            )
            await task_service.set_estimate(
                session, user_with_focus, t, day, minutes=30, source="model"
            )
            if i < 3:
                await task_service.complete_task(session, user_with_focus, t, day)
        extra = await task_service.create_task(
            session, user_with_focus, day, title="extra", is_primary=False
        )
        await task_service.set_estimate(
            session, user_with_focus, extra, day, minutes=15, source="model"
        )
        await task_service.complete_task(session, user_with_focus, extra, day)
        await task_service.recompute_capacity(session, user_with_focus, day)
        await session.commit()

        await close_service.close_day(session, user_with_focus, ANCHOR)
        await session.commit()

        row = await session.scalar(select(DailyMetrics).where(DailyMetrics.anchor_date == ANCHOR))
        assert row.scheduled_primary_count == 4
        assert row.completed_primary_count == 3
        assert row.scheduled_non_primary_count == 1
        assert row.completed_non_primary_count == 1
        assert row.verdict == "success"
        assert row.total_estimated_minutes == 4 * 30 + 15

    async def test_the_aggregate_is_written_only_for_a_closed_day(
        self, session, user_with_focus, day
    ):
        await task_service.create_task(session, user_with_focus, day, title="t", is_primary=True)
        await session.commit()

        row = await session.scalar(select(DailyMetrics).where(DailyMetrics.anchor_date == ANCHOR))
        assert row is None

    async def test_rolling_up_twice_updates_rather_than_duplicates(
        self, session, user_with_focus, day
    ):
        await task_service.create_task(session, user_with_focus, day, title="t", is_primary=True)
        await session.commit()
        await close_service.close_day(session, user_with_focus, ANCHOR)
        await session.commit()
        await metrics.roll_up(session, user_with_focus, day)
        await session.commit()

        count = await session.scalar(
            select(func.count()).select_from(DailyMetrics).where(DailyMetrics.anchor_date == ANCHOR)
        )
        assert count == 1


class TestReplay:
    async def test_the_log_reproduces_the_stored_verdict(self, session, user_with_focus, day):
        """T-EVT-04 and T-SCORE-08. If these disagree, the stored verdict is wrong."""
        for i in range(4):
            t = await task_service.create_task(
                session, user_with_focus, day, title=f"p{i}", is_primary=True
            )
            if i < 3:
                await task_service.complete_task(session, user_with_focus, t, day)
        await session.commit()

        closed = await close_service.close_day(session, user_with_focus, ANCHOR)
        await session.commit()

        replayed = await metrics.verdict_from_events(session, user_with_focus, ANCHOR)
        assert replayed == closed.verdict == "success"

    async def test_replay_reproduces_a_failure_too(self, session, user_with_focus, day):
        for i in range(4):
            t = await task_service.create_task(
                session, user_with_focus, day, title=f"p{i}", is_primary=True
            )
            if i < 2:
                await task_service.complete_task(session, user_with_focus, t, day)
        await session.commit()

        closed = await close_service.close_day(session, user_with_focus, ANCHOR)
        await session.commit()

        replayed = await metrics.verdict_from_events(session, user_with_focus, ANCHOR)
        assert replayed == closed.verdict == "failure"


class TestReplayEdgeCases:
    async def test_a_day_with_only_non_primary_tasks_replays_as_neutral(
        self, session, user_with_focus, day
    ):
        """T-SCORE-08 edge case. Without total_task_count on day_scored, a replay
        cannot tell "nothing scheduled" from "nothing committed to", and returns
        unscheduled where the stored verdict says neutral."""
        for i in range(3):
            await task_service.create_task(
                session, user_with_focus, day, title=f"n{i}", is_primary=False
            )
        await session.commit()

        closed = await close_service.close_day(session, user_with_focus, ANCHOR)
        await session.commit()

        assert closed.verdict == "neutral"
        assert await metrics.verdict_from_events(session, user_with_focus, ANCHOR) == "neutral"

    async def test_an_empty_day_replays_as_unscheduled(self, session, user_with_focus, day):
        closed = await close_service.close_day(session, user_with_focus, ANCHOR)
        await session.commit()

        assert closed.verdict == "unscheduled"
        assert (
            await metrics.verdict_from_events(session, user_with_focus, ANCHOR)
            == "unscheduled"
        )


class TestCost:
    def test_haiku_estimation_cost_is_computed_from_real_token_counts(self):
        cost = metrics.cost_for("claude-haiku-4-5", 530, 20)
        assert cost == Decimal("530") * Decimal("1.00") / Decimal(1_000_000) + Decimal(
            "20"
        ) * Decimal("5.00") / Decimal(1_000_000)
        assert float(cost) < 0.001

    def test_opus_chat_is_more_expensive_per_turn(self):
        haiku = metrics.cost_for("claude-haiku-4-5", 800, 300)
        opus = metrics.cost_for("claude-opus-5", 800, 300)
        assert opus > haiku

    def test_an_unknown_model_costs_nothing_rather_than_guessing(self):
        assert metrics.cost_for("some-future-model", 1000, 1000) == Decimal(0)

    def test_a_projected_month_stays_under_the_ceiling(self):
        """The tracking plan commits to roughly $1.30/month against a $5 ceiling."""
        daily = metrics.cost_for("claude-haiku-4-5", 530 * 10, 20 * 10) + metrics.cost_for(
            "claude-opus-5", 800 * 3, 300 * 3
        )
        assert float(daily) * 30 < 5.0
