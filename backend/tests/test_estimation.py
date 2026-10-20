"""Estimation: buckets, retries, the sweeper, and the per-user cache.

The model is mocked by default so the suite is deterministic, offline, and free.
A separately tagged live suite (tests/test_live_llm.py) covers prompt drift.
"""

from datetime import date, timedelta

import pytest
from sqlalchemy import func, select

from doer.daytime import utcnow
from doer.models import Event
from doer.models.cache import EstimateCache
from doer.services import day_service, estimation, llm, task_service

ANCHOR = date(2026, 3, 10)


class FakeUsage:
    input_tokens = 530
    output_tokens = 12


class FakeResponse:
    def __init__(self, minutes: int | None):
        self.parsed_output = (
            estimation.EstimateOut(minutes=minutes) if minutes is not None else None
        )
        self.usage = FakeUsage()


class FakeMessages:
    def __init__(self, behavior):
        self.behavior = behavior
        self.calls = 0

    async def parse(self, **kwargs):
        self.calls += 1
        result = self.behavior(self.calls, kwargs)
        if isinstance(result, Exception):
            raise result
        return FakeResponse(result)


class FakeClient:
    def __init__(self, behavior):
        self.messages = FakeMessages(behavior)


@pytest.fixture
def fake_llm(monkeypatch):
    """Install a scripted model. Returns a setter so each test chooses behavior."""

    holder = {}

    def install(behavior):
        client = FakeClient(behavior)
        holder["client"] = client
        monkeypatch.setattr(llm, "client", lambda: client)
        return client

    return install


@pytest.fixture
async def day(session, user_with_focus):
    d = await day_service.open_day(session, user_with_focus, ANCHOR)
    await session.commit()
    return d


async def make(session, user, day, title="write the quarterly update"):
    task = await task_service.create_task(session, user, day, title=title, is_primary=True)
    await session.commit()
    return task


class TestEstimation:
    async def test_an_off_bucket_model_value_is_snapped_up(
        self, session, user_with_focus, day, fake_llm
    ):
        """T-EST-05. 37 minutes is stored as 45, with the raw value preserved."""
        fake_llm(lambda n, kw: 37)
        task = await make(session, user_with_focus, day)

        await estimation.estimate_task(session, user_with_focus, task, day)
        await session.commit()

        assert task.estimate_minutes == 45
        assert task.raw_model_minutes == 37
        assert task.estimation_status == "estimated"

    async def test_a_below_floor_value_is_clamped_and_logged(
        self, session, user_with_focus, day, fake_llm
    ):
        """T-EST-07. Both the raw and clamped values survive, so prompt quality
        stays measurable later."""
        fake_llm(lambda n, kw: 5)
        task = await make(session, user_with_focus, day)

        await estimation.estimate_task(session, user_with_focus, task, day)
        await session.commit()

        assert task.estimate_minutes == 15
        event = await session.scalar(select(Event).where(Event.name == "task_estimated"))
        assert event.properties["raw_model_minutes"] == 5
        assert event.properties["was_clamped"] is True

    async def test_an_exact_bucket_is_not_marked_snapped(
        self, session, user_with_focus, day, fake_llm
    ):
        fake_llm(lambda n, kw: 60)
        task = await make(session, user_with_focus, day)
        await estimation.estimate_task(session, user_with_focus, task, day)
        await session.commit()

        event = await session.scalar(select(Event).where(Event.name == "task_estimated"))
        assert event.properties["was_snapped"] is False

    async def test_the_estimation_model_is_the_one_configured(
        self, session, user_with_focus, day, fake_llm
    ):
        """Estimation must not silently run on the chat model."""
        client = fake_llm(lambda n, kw: 60)
        task = await make(session, user_with_focus, day)
        await estimation.estimate_task(session, user_with_focus, task, day)

        from doer.config import get_settings

        assert client.messages.calls == 1
        assert get_settings().estimation_model == "claude-haiku-4-5"

    async def test_thinking_is_not_sent_to_haiku(self, session, user_with_focus, day, fake_llm):
        """Haiku 4.5 predates adaptive thinking and rejects the effort parameter.

        Bucket estimation needs no reasoning, so neither is sent at all.
        """
        sent = {}

        def capture(n, kw):
            sent.update(kw)
            return 60

        fake_llm(capture)
        task = await make(session, user_with_focus, day)
        await estimation.estimate_task(session, user_with_focus, task, day)

        assert "thinking" not in sent
        assert "output_config" not in sent


class TestFailureAndRetry:
    async def test_a_failure_leaves_the_task_unestimated_and_schedules_a_retry(
        self, session, user_with_focus, day, fake_llm
    ):
        """T-EST-03. The task survives; the estimate is what is missing."""
        fake_llm(lambda n, kw: RuntimeError("upstream down"))
        task = await make(session, user_with_focus, day)

        await estimation.estimate_task(session, user_with_focus, task, day)
        await session.commit()

        assert task.estimate_minutes is None
        assert task.estimation_status == "pending"
        assert task.next_attempt_at is not None
        assert task.estimation_attempts == 1

    async def test_retries_stop_after_three_attempts(self, session, user_with_focus, day, fake_llm):
        """T-EST-04. Bounded, then it stays unestimated rather than retrying forever."""
        fake_llm(lambda n, kw: RuntimeError("still down"))
        task = await make(session, user_with_focus, day)

        for _ in range(3):
            task.next_attempt_at = None
            await estimation.estimate_task(session, user_with_focus, task, day)
        await session.commit()

        assert task.estimation_attempts == 3
        assert task.estimation_status == "failed"
        assert task.next_attempt_at is None

    async def test_backoff_grows_between_attempts(self, session, user_with_focus, day, fake_llm):
        fake_llm(lambda n, kw: RuntimeError("down"))
        task = await make(session, user_with_focus, day)

        await estimation.estimate_task(session, user_with_focus, task, day)
        first = task.next_attempt_at
        await estimation.estimate_task(session, user_with_focus, task, day)
        second = task.next_attempt_at

        assert second > first

    async def test_each_failed_attempt_is_logged(self, session, user_with_focus, day, fake_llm):
        fake_llm(lambda n, kw: RuntimeError("down"))
        task = await make(session, user_with_focus, day)
        await estimation.estimate_task(session, user_with_focus, task, day)
        await estimation.estimate_task(session, user_with_focus, task, day)
        await session.commit()

        count = await session.scalar(
            select(func.count()).select_from(Event).where(Event.name == "task_estimation_failed")
        )
        assert count == 2

    async def test_an_unparsable_response_counts_as_a_failure(
        self, session, user_with_focus, day, fake_llm
    ):
        fake_llm(lambda n, kw: None)
        task = await make(session, user_with_focus, day)
        await estimation.estimate_task(session, user_with_focus, task, day)
        await session.commit()
        assert task.estimate_minutes is None


class TestCache:
    async def test_an_identical_title_is_served_from_cache(
        self, session, user_with_focus, day, fake_llm
    ):
        """T-EST-10. No second model call, so no second charge."""
        client = fake_llm(lambda n, kw: 90)
        first = await make(session, user_with_focus, day, "Review The Deck")
        await estimation.estimate_task(session, user_with_focus, first, day)
        await session.commit()

        second = await task_service.create_task(
            session, user_with_focus, day, title="review the deck", is_primary=False
        )
        await session.commit()
        await estimation.estimate_task(session, user_with_focus, second, day)
        await session.commit()

        assert client.messages.calls == 1, "case and spacing normalize to the same key"
        assert second.estimate_minutes == 90

    async def test_a_cache_hit_is_marked_in_the_event(
        self, session, user_with_focus, day, fake_llm
    ):
        fake_llm(lambda n, kw: 90)
        first = await make(session, user_with_focus, day, "same title")
        await estimation.estimate_task(session, user_with_focus, first, day)
        second = await task_service.create_task(session, user_with_focus, day, title="same title")
        await estimation.estimate_task(session, user_with_focus, second, day)
        await session.commit()

        result = await session.execute(
            select(Event).where(Event.name == "task_estimated").order_by(Event.occurred_at)
        )
        hits = [e.properties["cache_hit"] for e in result.scalars()]
        assert hits == [False, True]

    async def test_the_cache_is_scoped_to_one_user(self, session, user_with_focus, day):
        """Two people writing the same words mean different amounts of work."""
        from doer.models import User

        other = User(google_sub="other", email="other@example.com", timezone="Asia/Kolkata")
        session.add(other)
        await session.commit()

        session.add(
            EstimateCache(
                user_id=user_with_focus.id,
                normalized_title="ship the thing",
                estimate_minutes=60,
                raw_model_minutes=60,
            )
        )
        await session.commit()

        leaked = await session.scalar(
            select(EstimateCache).where(
                EstimateCache.user_id == other.id,
                EstimateCache.normalized_title == "ship the thing",
            )
        )
        assert leaked is None


class TestSweeper:
    async def test_the_sweep_picks_up_a_due_task(self, session, user_with_focus, day, fake_llm):
        """T-EST-08."""
        fake_llm(lambda n, kw: 45)
        task = await make(session, user_with_focus, day)
        task.next_attempt_at = utcnow() - timedelta(minutes=1)
        await session.commit()

        swept = await estimation.sweep()
        assert swept == 1

        await session.refresh(task)
        assert task.estimate_minutes == 45

    async def test_a_task_not_yet_due_is_left_alone(self, session, user_with_focus, day, fake_llm):
        fake_llm(lambda n, kw: 45)
        task = await make(session, user_with_focus, day)
        task.next_attempt_at = utcnow() + timedelta(hours=1)
        await session.commit()

        assert await estimation.sweep() == 0

    async def test_sweeping_twice_does_not_double_count_attempts(
        self, session, user_with_focus, day, fake_llm
    ):
        """T-EST-09. Idempotent, so a scheduler firing twice costs nothing."""
        client = fake_llm(lambda n, kw: 45)
        task = await make(session, user_with_focus, day)
        task.next_attempt_at = utcnow() - timedelta(minutes=1)
        await session.commit()

        await estimation.sweep()
        await estimation.sweep()

        await session.refresh(task)
        assert client.messages.calls == 1
        assert task.estimation_attempts == 1
