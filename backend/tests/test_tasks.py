"""The commitment contract: the 4-primary cap, immutability, and reversal."""

from datetime import date

import pytest
from sqlalchemy import func, select

from doer.models import Event, Task
from doer.services import day_service, task_service
from doer.services.task_service import TaskRuleViolation

ANCHOR = date(2026, 3, 10)


@pytest.fixture
async def day(session, user):
    d = await day_service.open_day(session, user, ANCHOR)
    await session.commit()
    return d


async def make(session, user, day, title="task", primary=False, kind="deep_work"):
    task = await task_service.create_task(
        session, user, day, title=title, is_primary=primary, preference_kind=kind
    )
    await session.commit()
    return task


class TestPrimaryCap:
    async def test_four_primaries_are_allowed(self, session, user, day):
        for i in range(4):
            await make(session, user, day, f"p{i}", primary=True)
        assert await task_service.primary_count(session, day) == 4

    async def test_the_fifth_primary_is_rejected_with_a_remedy(self, session, user, day):
        """T-TASK-01 / AC-02. The refusal has to offer a way forward."""
        for i in range(4):
            await make(session, user, day, f"p{i}", primary=True)

        with pytest.raises(TaskRuleViolation) as exc:
            await make(session, user, day, "fifth", primary=True)

        assert exc.value.code == "primary_cap_reached"
        assert "demote" in exc.value.remedy.lower()

    async def test_the_rejection_is_logged(self, session, user, day):
        for i in range(4):
            await make(session, user, day, f"p{i}", primary=True)
        with pytest.raises(TaskRuleViolation):
            await make(session, user, day, "fifth", primary=True)
        await session.commit()

        count = await session.scalar(
            select(func.count()).select_from(Event).where(Event.name == "primary_cap_rejected")
        )
        assert count == 1

    async def test_demoting_frees_a_slot(self, session, user, day):
        """T-TASK-02."""
        first = await make(session, user, day, "p0", primary=True)
        for i in range(1, 4):
            await make(session, user, day, f"p{i}", primary=True)

        await task_service.set_primary(session, user, first, day, primary=False)
        await session.commit()

        new = await make(session, user, day, "replacement", primary=True)
        assert new.is_primary is True
        assert await task_service.primary_count(session, day) == 4

    async def test_non_primary_tasks_are_unlimited(self, session, user, day):
        """T-TASK-03."""
        for i in range(12):
            await make(session, user, day, f"n{i}", primary=False)
        tasks = await task_service.tasks_for_day(session, day)
        assert len(tasks) == 12


class TestImmutability:
    async def test_a_completed_task_cannot_be_deleted(self, session, user, day):
        """T-TASK-04 / AC-03."""
        task = await make(session, user, day, primary=True)
        await task_service.complete_task(session, user, task, day)
        await session.commit()

        with pytest.raises(TaskRuleViolation) as exc:
            await task_service.delete_task(session, user, task, day)
        assert exc.value.code == "completed_immutable"

    async def test_the_rejected_deletion_is_logged(self, session, user, day):
        """T-TASK-05."""
        task = await make(session, user, day, primary=True)
        await task_service.complete_task(session, user, task, day)
        await session.commit()
        with pytest.raises(TaskRuleViolation):
            await task_service.delete_task(session, user, task, day)
        await session.commit()

        count = await session.scalar(
            select(func.count()).select_from(Event).where(Event.name == "task_delete_rejected")
        )
        assert count == 1

    async def test_the_database_refuses_even_a_direct_delete(self, session, user, day):
        """The guarantee does not depend on going through the service."""
        task = await make(session, user, day, primary=True)
        await task_service.complete_task(session, user, task, day)
        await session.commit()

        with pytest.raises(Exception, match="cannot be deleted"):
            await session.execute(Task.__table__.delete().where(Task.id == task.id))
            await session.commit()

    async def test_an_incomplete_task_deletes_normally(self, session, user, day):
        task = await make(session, user, day)
        await task_service.delete_task(session, user, task, day)
        await session.commit()
        assert await task_service.tasks_for_day(session, day) == []


class TestReversal:
    async def test_reversal_is_allowed_while_the_day_is_open(self, session, user, day):
        """T-TASK-06 / AC-09."""
        task = await make(session, user, day, primary=True)
        await task_service.complete_task(session, user, task, day)
        await session.commit()

        await task_service.reverse_completion(session, user, task, day)
        await session.commit()
        assert task.is_complete is False

    async def test_reversal_is_rejected_once_the_day_has_closed(self, session, user, day):
        """T-TASK-07 / AC-09. The heatmap must never be rewritten retroactively."""
        from doer.daytime import utcnow

        task = await make(session, user, day, primary=True)
        await task_service.complete_task(session, user, task, day)
        day.closed_at = utcnow()
        day.verdict = "neutral"
        await session.commit()

        with pytest.raises(TaskRuleViolation) as exc:
            await task_service.reverse_completion(session, user, task, day)
        assert exc.value.code == "day_closed"

    async def test_the_rejected_reversal_is_logged(self, session, user, day):
        from doer.daytime import utcnow

        task = await make(session, user, day, primary=True)
        await task_service.complete_task(session, user, task, day)
        day.closed_at = utcnow()
        await session.commit()
        with pytest.raises(TaskRuleViolation):
            await task_service.reverse_completion(session, user, task, day)
        await session.commit()

        count = await session.scalar(
            select(func.count())
            .select_from(Event)
            .where(Event.name == "task_completion_reversal_rejected")
        )
        assert count == 1


class TestEstimateBuckets:
    async def test_an_off_bucket_model_value_snaps_up(self, session, user, day):
        """T-EST-05 / AC-10. 37 minutes becomes 45, never 30."""
        task = await make(session, user, day)
        await task_service.set_estimate(session, user, task, day, minutes=37, source="model")
        assert task.estimate_minutes == 45
        assert task.raw_model_minutes == 37

    async def test_a_user_override_is_snapped_too(self, session, user, day):
        """T-EST-06 / AC-10. The rule is not only for model output."""
        task = await make(session, user, day)
        await task_service.set_estimate(session, user, task, day, minutes=20, source="user")
        assert task.estimate_minutes == 30

    async def test_values_below_the_floor_clamp_up(self, session, user, day):
        task = await make(session, user, day)
        await task_service.set_estimate(session, user, task, day, minutes=2, source="model")
        assert task.estimate_minutes == 15

    async def test_values_above_the_ceiling_clamp_down(self, session, user, day):
        task = await make(session, user, day)
        await task_service.set_estimate(session, user, task, day, minutes=900, source="model")
        assert task.estimate_minutes == 8 * 60

    async def test_an_exact_bucket_is_unchanged(self, session, user, day):
        task = await make(session, user, day)
        await task_service.set_estimate(session, user, task, day, minutes=45, source="model")
        assert task.estimate_minutes == 45


class TestOrdering:
    async def test_a_new_task_appends_to_the_end_of_its_block(self, session, user, day):
        """T-TASK-12 / AC-11."""
        first = await make(session, user, day, "first")
        second = await make(session, user, day, "second")
        assert second.sort_index > first.sort_index

    async def test_reorder_moves_within_the_block(self, session, user, day):
        """T-TASK-11."""
        a = await make(session, user, day, "a")
        b = await make(session, user, day, "b")
        c = await make(session, user, day, "c")

        await task_service.reorder(session, user, c, day, to_index=0)
        await session.commit()

        ordered = [t.title for t in await task_service.tasks_for_day(session, day)]
        assert ordered == ["c", "a", "b"]
        assert a.sort_index < b.sort_index

    async def test_blocks_do_not_interleave(self, session, user, day):
        """T-TASK-13. Ordering is scoped to a preference block."""
        deep = await make(session, user, day, "deep", kind="deep_work")
        personal = await make(session, user, day, "personal", kind="personal")

        await task_service.reorder(session, user, personal, day, to_index=0)
        await session.commit()

        assert personal.preference_kind == "personal"
        assert deep.preference_kind == "deep_work"


class TestCapacityIntegration:
    async def test_committed_minutes_sum_open_primaries_only(self, session, user, day):
        a = await make(session, user, day, "a", primary=True)
        b = await make(session, user, day, "b", primary=True)
        c = await make(session, user, day, "c", primary=False)
        for t in (a, b, c):
            await task_service.set_estimate(session, user, t, day, minutes=60, source="model")

        await task_service.recompute_capacity(session, user, day)
        await session.commit()
        assert day.committed_minutes == 120, "non-primary work is not a commitment"

    async def test_completing_a_primary_releases_its_commitment(self, session, user, day):
        a = await make(session, user, day, "a", primary=True)
        await task_service.set_estimate(session, user, a, day, minutes=60, source="model")
        await task_service.recompute_capacity(session, user, day)
        assert day.committed_minutes == 60

        await task_service.complete_task(session, user, a, day)
        await task_service.recompute_capacity(session, user, day)
        await session.commit()
        assert day.committed_minutes == 0

    async def test_an_unestimated_primary_makes_the_day_indeterminate(
        self, session, user_with_focus
    ):
        """AC-17, through the service rather than in isolation.

        Needs a user with focus blocks: otherwise no_focus_blocks is the correct
        reason and wins first, which is its own (separately tested) behavior.
        """
        user = user_with_focus
        day = await day_service.open_day(session, user, ANCHOR)
        await session.commit()
        await make(session, user, day, "unestimated", primary=True)
        await task_service.recompute_capacity(session, user, day)
        await session.commit()
        assert day.is_indeterminate is True
        assert day.indeterminate_reason == "unestimated_primaries"
