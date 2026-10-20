"""Assistant capture. Nothing is committed without confirmation."""

from datetime import date

import pytest
from sqlalchemy import func, select

from doer.models import Event, Task
from doer.services import assistant, day_service, llm, task_service

ANCHOR = date(2026, 3, 10)


class FakeResponse:
    def __init__(self, tasks):
        self.parsed_output = assistant.Proposal(tasks=tasks)
        self.usage = type("U", (), {"input_tokens": 800, "output_tokens": 120})()


class FakeMessages:
    def __init__(self, behavior):
        self.behavior = behavior
        self.calls = 0

    async def parse(self, **kwargs):
        self.calls += 1
        result = self.behavior(kwargs)
        if isinstance(result, Exception):
            raise result
        return FakeResponse(result)


@pytest.fixture
def fake_llm(monkeypatch):
    def install(behavior):
        client = type("C", (), {"messages": FakeMessages(behavior)})()
        monkeypatch.setattr(llm, "client", lambda: client)
        return client

    return install


@pytest.fixture
async def day(session, user_with_focus):
    d = await day_service.open_day(session, user_with_focus, ANCHOR)
    await session.commit()
    return d


def proposal(*titles):
    return [
        assistant.ProposedTask(title=t, preference_kind="deep_work", estimate_minutes=45)
        for t in titles
    ]


class TestParsing:
    async def test_a_message_becomes_proposed_tasks(self, session, user_with_focus, day, fake_llm):
        fake_llm(lambda kw: proposal("finish the update", "review two PRs", "call the bank"))
        turn_id, tasks = await assistant.parse_message(
            session, user_with_focus, day, "three things today"
        )
        await session.commit()

        assert len(tasks) == 3
        assert turn_id

    async def test_parsing_commits_nothing(self, session, user_with_focus, day, fake_llm):
        """The central guarantee: a proposal is not a task."""
        fake_llm(lambda kw: proposal("a", "b"))
        await assistant.parse_message(session, user_with_focus, day, "two things")
        await session.commit()

        count = await session.scalar(select(func.count()).select_from(Task))
        assert count == 0

    async def test_a_non_task_message_yields_nothing(self, session, user_with_focus, day, fake_llm):
        fake_llm(lambda kw: [])
        _, tasks = await assistant.parse_message(
            session, user_with_focus, day, "how am I doing this week"
        )
        assert tasks == []

    async def test_an_unknown_preference_kind_is_discarded(
        self, session, user_with_focus, day, fake_llm
    ):
        fake_llm(
            lambda kw: [
                assistant.ProposedTask(title="odd", preference_kind="napping", estimate_minutes=30)
            ]
        )
        _, tasks = await assistant.parse_message(session, user_with_focus, day, "nap")
        assert tasks == []

    async def test_the_chat_model_is_used_not_the_estimation_model(
        self, session, user_with_focus, day, fake_llm
    ):
        sent = {}

        def capture(kw):
            sent.update(kw)
            return proposal("a")

        fake_llm(capture)
        await assistant.parse_message(session, user_with_focus, day, "one thing")
        assert sent["model"] == "claude-opus-5"

    async def test_both_turn_events_are_recorded(self, session, user_with_focus, day, fake_llm):
        fake_llm(lambda kw: proposal("a"))
        await assistant.parse_message(session, user_with_focus, day, "one thing")
        await session.commit()

        names = set((await session.scalars(select(Event.name))).all())
        assert {"assistant_turn_sent", "assistant_proposal_returned"} <= names

    async def test_the_message_text_is_not_stored_in_events(
        self, session, user_with_focus, day, fake_llm
    ):
        """Metrics carry shape, not content."""
        fake_llm(lambda kw: proposal("a"))
        secret = "buy a present for my partner"
        await assistant.parse_message(session, user_with_focus, day, secret)
        await session.commit()

        event = await session.scalar(select(Event).where(Event.name == "assistant_turn_sent"))
        assert secret not in str(event.properties)
        assert event.properties["input_length"] == len(secret)


class TestConfirmation:
    async def test_confirming_creates_the_tasks_with_their_estimates(
        self, session, user_with_focus, day
    ):
        created = []
        for p in proposal("one", "two"):
            task = await task_service.create_task(
                session, user_with_focus, day, title=p.title, source="chat"
            )
            await task_service.set_estimate(
                session,
                user_with_focus,
                task,
                day,
                minutes=p.estimate_minutes,
                source="model",
            )
            created.append(task)
        await session.commit()

        assert [t.estimate_minutes for t in created] == [45, 45]
        assert all(t.estimate_source == "model" for t in created)

    async def test_confirmation_records_the_edit_count(self, session, user_with_focus, day):
        """A rising edited share means the parse is drifting."""
        assistant.record_confirmation(
            session, user_with_focus, day, turn_id="t1", confirmed=3, edited=1, discarded=0
        )
        await session.commit()

        event = await session.scalar(
            select(Event).where(Event.name == "assistant_proposal_confirmed")
        )
        assert event.properties["edited_count"] == 1
        assert event.properties["confirmed_count"] == 3

    async def test_discarding_is_recorded(self, session, user_with_focus, day):
        assistant.record_discard(session, user_with_focus, day, turn_id="t1", proposed=2)
        await session.commit()

        event = await session.scalar(
            select(Event).where(Event.name == "assistant_proposal_discarded")
        )
        assert event.properties["proposed_task_count"] == 2
