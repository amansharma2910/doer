"""Day close: the 75% verdict, carry-forward, and idempotency."""

import asyncio
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from doer.models import Event, LogicalDay, Task
from doer.services import close_service, day_service, task_service
from doer.services.close_service import verdict_for

ANCHOR = date(2026, 3, 10)
TZ = "Asia/Kolkata"


def after_day(anchor: date, hours: int = 6) -> datetime:
    """An instant comfortably past the end of the day starting on `anchor`."""
    return datetime(anchor.year, anchor.month, anchor.day, 14, 0, tzinfo=ZoneInfo(TZ)).astimezone(
        UTC
    ) + timedelta(hours=15 + hours)


class TestVerdictRule:
    """AC-05. The whole scoring table, including the cases that are easy to get wrong."""

    def test_four_of_four_is_success(self):
        assert verdict_for(4, 4, 4) == "success"

    def test_three_of_four_is_success(self):
        """T-SCORE-01. Exactly the 75% bar."""
        assert verdict_for(4, 4, 3) == "success"

    def test_two_of_four_is_failure(self):
        """T-SCORE-02."""
        assert verdict_for(4, 4, 2) == "failure"

    def test_three_of_three_is_success(self):
        assert verdict_for(3, 3, 3) == "success"

    def test_two_of_three_is_failure(self):
        """T-SCORE-03. 0.67 is below the bar, so a 3-task day needs all three."""
        assert verdict_for(3, 3, 2) == "failure"

    def test_two_of_two_is_success(self):
        assert verdict_for(2, 2, 2) == "success"

    def test_one_of_two_is_failure(self):
        """T-SCORE-04. 50% does not clear 75%."""
        assert verdict_for(2, 2, 1) == "failure"

    def test_one_primary_completed_is_neutral(self):
        """T-SCORE-05. A single-task day is not scoreable in either direction."""
        assert verdict_for(1, 1, 1) == "neutral"

    def test_one_primary_uncompleted_is_also_neutral(self):
        assert verdict_for(1, 1, 0) == "neutral"

    def test_no_tasks_at_all_is_unscheduled(self):
        """T-SCORE-06. Unscheduled paints nothing; it is not a failure."""
        assert verdict_for(0, 0, 0) == "unscheduled"

    def test_non_primary_tasks_alone_are_neutral_not_unscheduled(self):
        """The day was used, but nothing was committed to, so there is nothing to score."""
        assert verdict_for(5, 0, 0) == "neutral"


class TestClose:
    async def test_closing_scores_the_day(self, session, user):
        day = await day_service.open_day(session, user, ANCHOR)
        for i in range(4):
            t = await task_service.create_task(session, user, day, title=f"p{i}", is_primary=True)
            if i < 3:
                await task_service.complete_task(session, user, t, day)
        await session.commit()

        closed = await close_service.close_day(session, user, ANCHOR)
        await session.commit()

        assert closed.verdict == "success"
        assert closed.scheduled_primary_count == 4
        assert closed.completed_primary_count == 3
        assert float(closed.completion_ratio) == 0.75
        assert closed.closed_at is not None

    async def test_non_primary_completions_do_not_change_the_verdict(self, session, user):
        """T-SCORE-07."""
        day = await day_service.open_day(session, user, ANCHOR)
        for i in range(2):
            t = await task_service.create_task(session, user, day, title=f"p{i}", is_primary=True)
            if i == 0:
                await task_service.complete_task(session, user, t, day)
        for i in range(5):
            t = await task_service.create_task(session, user, day, title=f"n{i}", is_primary=False)
            await task_service.complete_task(session, user, t, day)
        await session.commit()

        closed = await close_service.close_day(session, user, ANCHOR)
        await session.commit()
        assert closed.verdict == "failure", "1 of 2 primaries is 50%, five extras change nothing"

    async def test_closing_twice_is_a_no_op(self, session, user):
        day = await day_service.open_day(session, user, ANCHOR)
        await task_service.create_task(session, user, day, title="t", is_primary=True)
        await session.commit()

        first = await close_service.close_day(session, user, ANCHOR)
        await session.commit()
        closed_at = first.closed_at

        second = await close_service.close_day(session, user, ANCHOR)
        await session.commit()
        assert second.closed_at == closed_at

    async def test_closing_emits_exactly_one_scored_event(self, session, user):
        day = await day_service.open_day(session, user, ANCHOR)
        await task_service.create_task(session, user, day, title="t", is_primary=True)
        await session.commit()

        await close_service.close_day(session, user, ANCHOR)
        await session.commit()
        await close_service.close_day(session, user, ANCHOR)
        await session.commit()

        count = await session.scalar(
            select(func.count()).select_from(Event).where(Event.name == "day_scored")
        )
        assert count == 1


class TestCarryForward:
    async def test_incomplete_tasks_roll_to_the_next_day(self, session, user):
        """T-TASK-08 / AC-04."""
        day = await day_service.open_day(session, user, ANCHOR)
        done = await task_service.create_task(session, user, day, title="done", is_primary=True)
        await task_service.complete_task(session, user, done, day)
        pending = await task_service.create_task(
            session, user, day, title="pending", is_primary=True
        )
        original_created = pending.created_at
        await session.commit()

        await close_service.close_day(session, user, ANCHOR)
        await session.commit()

        tomorrow = await day_service.get_day(session, user, date(2026, 3, 11))
        carried = await task_service.tasks_for_day(session, tomorrow)
        assert [t.title for t in carried] == ["pending"]
        assert carried[0].carry_forward_count == 1
        assert carried[0].is_primary is True
        assert carried[0].created_at == original_created, "creation date is preserved"

    async def test_completed_tasks_do_not_roll(self, session, user):
        day = await day_service.open_day(session, user, ANCHOR)
        done = await task_service.create_task(session, user, day, title="done", is_primary=True)
        await task_service.complete_task(session, user, done, day)
        await session.commit()

        await close_service.close_day(session, user, ANCHOR)
        await session.commit()

        remaining = await task_service.tasks_for_day(
            session, await day_service.get_day(session, user, ANCHOR)
        )
        assert [t.title for t in remaining] == ["done"]

    async def test_a_carried_task_can_still_be_deleted(self, session, user):
        """T-TASK-09. Carry-forward is unconditional; triage happens after the roll."""
        day = await day_service.open_day(session, user, ANCHOR)
        task = await task_service.create_task(session, user, day, title="unwanted")
        await session.commit()
        await close_service.close_day(session, user, ANCHOR)
        await session.commit()

        tomorrow = await day_service.get_day(session, user, date(2026, 3, 11))
        await task_service.delete_task(session, user, task, tomorrow)
        await session.commit()
        assert await task_service.tasks_for_day(session, tomorrow) == []

    async def test_carrying_across_three_days_increments_three_times(self, session, user):
        """T-DAY-08 / AC-04. Once per day survived, not once in total."""
        day = await day_service.open_day(session, user, ANCHOR)
        task = await task_service.create_task(session, user, day, title="stubborn", is_primary=True)
        await session.commit()

        closed = await close_service.close_elapsed_days(session, user, after_day(date(2026, 3, 13)))
        await session.commit()

        assert len(closed) == 4, "2026-03-10 through 2026-03-13 inclusive"
        assert [d.anchor_date for d in closed] == [
            date(2026, 3, 10),
            date(2026, 3, 11),
            date(2026, 3, 12),
            date(2026, 3, 13),
        ], "closed oldest first"
        await session.refresh(task)
        assert task.carry_forward_count == 4

    async def test_each_roll_emits_one_carry_event(self, session, user):
        day = await day_service.open_day(session, user, ANCHOR)
        await task_service.create_task(session, user, day, title="stubborn", is_primary=True)
        await session.commit()

        await close_service.close_elapsed_days(session, user, after_day(date(2026, 3, 12)))
        await session.commit()

        count = await session.scalar(
            select(func.count()).select_from(Event).where(Event.name == "task_carried_forward")
        )
        assert count == 3


class TestCarryForwardPrecedence:
    """AC-21. Unfinished commitments outrank intentions made in advance."""

    async def test_carried_primaries_claim_slots_and_excess_pre_assigned_demote(
        self, session, user
    ):
        """T-TASK-10."""
        today = await day_service.open_day(session, user, ANCHOR)
        for i in range(4):
            await task_service.create_task(
                session, user, today, title=f"carried{i}", is_primary=True
            )

        tomorrow = await day_service.open_day(session, user, date(2026, 3, 11))
        pre = []
        for i in range(3):
            pre.append(
                await task_service.create_task(
                    session, user, tomorrow, title=f"pre{i}", is_primary=True
                )
            )
        await session.commit()

        await close_service.close_day(session, user, ANCHOR)
        await session.commit()

        tasks = await task_service.tasks_for_day(session, tomorrow)
        primaries = [t for t in tasks if t.is_primary]
        assert len(primaries) == 4, "the cap holds after carry-forward"
        assert {t.title for t in primaries} == {f"carried{i}" for i in range(4)}
        for t in pre:
            await session.refresh(t)
            assert t.is_primary is False, "pre-assigned tasks gave up their slots"

    async def test_partial_carry_leaves_room_for_some_pre_assigned(self, session, user):
        """Two carried plus three pre-assigned keeps the two oldest pre-assigned."""
        today = await day_service.open_day(session, user, ANCHOR)
        for i in range(2):
            await task_service.create_task(
                session, user, today, title=f"carried{i}", is_primary=True
            )

        tomorrow = await day_service.open_day(session, user, date(2026, 3, 11))
        pre = [
            await task_service.create_task(
                session, user, tomorrow, title=f"pre{i}", is_primary=True
            )
            for i in range(3)
        ]
        await session.commit()

        await close_service.close_day(session, user, ANCHOR)
        await session.commit()

        for t in pre:
            await session.refresh(t)
        assert [t.is_primary for t in pre] == [True, True, False], "oldest keep their slots"

    async def test_each_precedence_demotion_is_logged(self, session, user):
        """T-TASK-14."""
        today = await day_service.open_day(session, user, ANCHOR)
        for i in range(4):
            await task_service.create_task(session, user, today, title=f"c{i}", is_primary=True)
        tomorrow = await day_service.open_day(session, user, date(2026, 3, 11))
        for i in range(2):
            await task_service.create_task(
                session, user, tomorrow, title=f"pre{i}", is_primary=True
            )
        await session.commit()

        await close_service.close_day(session, user, ANCHOR)
        await session.commit()

        result = await session.execute(select(Event).where(Event.name == "task_demoted"))
        demotions = list(result.scalars())
        assert len(demotions) == 2
        assert all(d.properties["trigger"] == "carry_forward_precedence" for d in demotions)

    async def test_a_day_never_exceeds_four_primaries_after_carry(self, session, user):
        """T-TASK-15. The invariant, under the worst combination."""
        today = await day_service.open_day(session, user, ANCHOR)
        for i in range(4):
            await task_service.create_task(session, user, today, title=f"c{i}", is_primary=True)
        tomorrow = await day_service.open_day(session, user, date(2026, 3, 11))
        for i in range(4):
            await task_service.create_task(session, user, tomorrow, title=f"p{i}", is_primary=True)
        await session.commit()

        await close_service.close_day(session, user, ANCHOR)
        await session.commit()

        count = await session.scalar(
            select(func.count())
            .select_from(Task)
            .where(Task.logical_day_id == tomorrow.id, Task.is_primary.is_(True))
        )
        assert count == 4


class TestConcurrentClose:
    async def test_racing_closes_produce_one_close_and_one_carry(self, session_factory, user):
        """T-DAY-09 and T-DAY-10 / AC-14.

        Two tabs, or two devices, hitting the dashboard at the same moment must not
        double-close the day or carry the same task forward twice.
        """
        async with session_factory() as s:
            u = await s.merge(user)
            day = await day_service.open_day(s, u, ANCHOR)
            await task_service.create_task(s, u, day, title="pending", is_primary=True)
            await s.commit()

        async def close_once():
            async with session_factory() as s:
                u = await s.merge(user)
                await close_service.close_day(s, u, ANCHOR)
                await s.commit()

        await asyncio.gather(*(close_once() for _ in range(4)), return_exceptions=True)

        async with session_factory() as s:
            closes = await s.scalar(
                select(func.count()).select_from(Event).where(Event.name == "logical_day_closed")
            )
            carries = await s.scalar(
                select(func.count()).select_from(Event).where(Event.name == "task_carried_forward")
            )
            days = await s.scalar(
                select(func.count())
                .select_from(LogicalDay)
                .where(LogicalDay.anchor_date == date(2026, 3, 11))
            )
        assert closes == 1
        assert carries == 1
        assert days == 1
