"""Logical day materialization, snapshot freezing, and concurrency."""

import asyncio
from datetime import date, time

import pytest
from sqlalchemy import func, select

from doer.daytime import utcnow
from doer.models import Event, LogicalDay
from doer.services import day_service

ANCHOR = date(2026, 3, 10)


class TestOpenDay:
    async def test_creates_the_day_with_resolved_bounds(self, session, user):
        day = await day_service.open_day(session, user, ANCHOR)
        await session.commit()

        assert day.anchor_date == ANCHOR
        assert day.duration_minutes == 15 * 60
        assert day.timezone == "Asia/Kolkata"
        assert day.end_at > day.start_at

    async def test_is_idempotent(self, session, user):
        first = await day_service.open_day(session, user, ANCHOR)
        await session.commit()
        second = await day_service.open_day(session, user, ANCHOR)
        await session.commit()
        assert first.id == second.id

    async def test_opening_emits_exactly_one_opened_event(self, session, user):
        """T-EVT-01 / AC-08, for the open transition."""
        await day_service.open_day(session, user, ANCHOR)
        await session.commit()
        await day_service.open_day(session, user, ANCHOR)
        await session.commit()

        count = await session.scalar(
            select(func.count()).select_from(Event).where(Event.name == "logical_day_opened")
        )
        assert count == 1, "a second open must not re-emit the event"

    async def test_capacity_event_accompanies_the_open(self, session, user):
        await day_service.open_day(session, user, ANCHOR)
        await session.commit()
        names = (await session.scalars(select(Event.name))).all()
        assert "day_capacity_computed" in names


class TestConcurrency:
    async def test_concurrent_opens_create_exactly_one_day(self, session_factory, user):
        """T-DAY-09 / AC-14.

        The guarantee lives in the database. Two sessions racing to open the same
        anchor date cannot both win, because the unique constraint on
        (user_id, anchor_date) refuses the second insert.
        """

        async def open_once():
            async with session_factory() as s:
                merged = await s.merge(user)
                await day_service.open_day(s, merged, ANCHOR)
                await s.commit()

        await asyncio.gather(*(open_once() for _ in range(5)), return_exceptions=True)

        async with session_factory() as s:
            count = await s.scalar(
                select(func.count()).select_from(LogicalDay).where(LogicalDay.anchor_date == ANCHOR)
            )
        assert count == 1

    async def test_concurrent_opens_emit_at_most_one_opened_event(self, session_factory, user):
        async def open_once():
            async with session_factory() as s:
                merged = await s.merge(user)
                await day_service.open_day(s, merged, ANCHOR)
                await s.commit()

        await asyncio.gather(*(open_once() for _ in range(5)), return_exceptions=True)

        async with session_factory() as s:
            count = await s.scalar(
                select(func.count()).select_from(Event).where(Event.name == "logical_day_opened")
            )
        assert count == 1


class TestSnapshotImmutability:
    async def test_changing_the_day_shape_does_not_rewrite_an_open_day(self, session, user):
        """T-DAY-04 / AC-13."""
        day = await day_service.open_day(session, user, ANCHOR)
        await session.commit()
        original = dict(day.shape_snapshot)

        user.day_start_time = time(9, 0)
        user.day_duration_minutes = 10 * 60
        user.capacity_ratio = 0.9
        await session.commit()
        await session.refresh(day)

        assert day.shape_snapshot == original
        assert day.shape_snapshot["day_start_time"] == "14:00:00"
        assert float(day.capacity_ratio) == 0.5

    async def test_the_new_shape_applies_to_the_next_day(self, session, user):
        await day_service.open_day(session, user, ANCHOR)
        await session.commit()

        user.day_start_time = time(9, 0)
        await session.commit()

        tomorrow = await day_service.open_day(session, user, date(2026, 3, 11))
        await session.commit()
        assert tomorrow.shape_snapshot["day_start_time"] == "09:00:00"


class TestIndeterminateByDefault:
    async def test_a_user_with_no_blocks_gets_an_indeterminate_day(self, session, user):
        """AC-16, end to end rather than in isolation."""
        day = await day_service.open_day(session, user, ANCHOR)
        await session.commit()
        assert day.is_indeterminate is True
        assert day.indeterminate_reason == "no_focus_blocks"
        assert day.capacity_base_minutes == 0


class TestAppendOnly:
    async def test_the_database_refuses_to_update_an_event(self, session, user):
        """T-EVT-02. Enforced by trigger, so no ORM path can route around it."""
        await day_service.open_day(session, user, ANCHOR)
        await session.commit()

        with pytest.raises(Exception, match="append-only"):
            await session.execute(Event.__table__.update().values(name="tampered"))
            await session.commit()

    async def test_the_database_refuses_to_delete_an_event(self, session, user):
        await day_service.open_day(session, user, ANCHOR)
        await session.commit()

        with pytest.raises(Exception, match="append-only"):
            await session.execute(Event.__table__.delete())
            await session.commit()


class TestCurrentDay:
    async def test_returns_none_in_the_gap_between_days(self, session, user):
        """09:00 is outside a 14:00-to-05:00 day. We surface it, we do not guess."""
        from datetime import UTC, datetime
        from zoneinfo import ZoneInfo

        gap = datetime(2026, 3, 11, 9, 0, tzinfo=ZoneInfo("Asia/Kolkata")).astimezone(UTC)
        assert await day_service.current_day(session, user, gap) is None

    async def test_opens_the_day_containing_the_instant(self, session, user):
        from datetime import UTC, datetime
        from zoneinfo import ZoneInfo

        late = datetime(2026, 3, 11, 3, 0, tzinfo=ZoneInfo("Asia/Kolkata")).astimezone(UTC)
        day = await day_service.current_day(session, user, late)
        await session.commit()
        assert day is not None
        assert day.anchor_date == date(2026, 3, 10), "03:00 belongs to the previous date"

    async def test_utcnow_is_timezone_aware(self):
        assert utcnow().tzinfo is not None
