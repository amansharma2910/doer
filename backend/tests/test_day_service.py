"""Logical day materialization, snapshot freezing, and concurrency."""

import asyncio
from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import func, select

from doer.daytime import utcnow
from doer.models import Event, LogicalDay, PreferenceBlock
from doer.services import day_service, task_service

ANCHOR = date(2026, 3, 10)
# 16:00 Kolkata on the anchor date, which is inside the 14:00-to-05:00 day.
MIDDAY = datetime(2026, 3, 10, 16, 0, tzinfo=ZoneInfo("Asia/Kolkata")).astimezone(UTC)


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
        """T-DAY-03 and T-DAY-04 / AC-13.

        Covers both the snapshot taken at open and the refusal to recompute it.
        """
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

    async def test_a_closed_day_is_untouched_by_a_later_settings_edit(self, session, user):
        """T-DAY-05. Closed days are history, not state."""
        from doer.daytime import utcnow

        day = await day_service.open_day(session, user, ANCHOR)
        day.closed_at = utcnow()
        day.verdict = "success"
        await session.commit()
        before = (dict(day.shape_snapshot), day.capacity_base_minutes, day.verdict)

        user.day_start_time = time(7, 0)
        user.capacity_ratio = 0.9
        await session.commit()
        await session.refresh(day)

        assert (dict(day.shape_snapshot), day.capacity_base_minutes, day.verdict) == before

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


class TestBlockRefresh:
    """Block edits reach the day in progress, unlike day shape edits (AC-13).

    AC-13 freezes the day shape, which plan line 54 defines as start time and
    duration. Blocks are a separate setting, and the dashboard tells a user with
    none to go and define one, so that has to take effect on the day they are
    looking at rather than the next one.
    """

    async def test_adding_a_focus_block_clears_the_nudge_the_same_day(self, session, user):
        day = await day_service.open_day(session, user, ANCHOR)
        await session.commit()
        assert day.indeterminate_reason == "no_focus_blocks"
        frozen_shape = dict(day.shape_snapshot)

        session.add(
            PreferenceBlock(
                user_id=user.id,
                kind="deep_work",
                start_offset_minutes=60,
                end_offset_minutes=240,
            )
        )
        await session.commit()

        refreshed = await day_service.refresh_blocks(session, user, MIDDAY)
        assert refreshed is not None
        await task_service.recompute_capacity(session, user, refreshed)
        await session.commit()

        assert refreshed.is_indeterminate is False
        assert refreshed.indeterminate_reason is None
        assert refreshed.capacity_base_minutes == 180
        assert refreshed.threshold_minutes == 90

        # The shape half of the snapshot is still frozen.
        for key in ("day_start_time", "day_duration_minutes", "timezone", "capacity_ratio"):
            assert refreshed.shape_snapshot[key] == frozen_shape[key]
        assert float(refreshed.capacity_ratio) == 0.5

    async def test_deleting_the_last_focus_block_restores_the_nudge(
        self, session, user_with_focus
    ):
        user = user_with_focus
        day = await day_service.open_day(session, user, ANCHOR)
        await session.commit()
        assert day.is_indeterminate is False

        for block in await day_service._blocks(session, user):
            await session.delete(block)
        await session.flush()

        refreshed = await day_service.refresh_blocks(session, user, MIDDAY)
        assert refreshed is not None
        await task_service.recompute_capacity(session, user, refreshed)
        await session.commit()

        assert refreshed.is_indeterminate is True
        assert refreshed.indeterminate_reason == "no_focus_blocks"
        assert refreshed.capacity_base_minutes == 0

    async def test_a_closed_day_is_never_refreshed(self, session, user):
        """A scored day is history. A later block edit must not rewrite it."""
        day = await day_service.open_day(session, user, ANCHOR)
        day.closed_at = utcnow()
        day.verdict = "failure"
        await session.commit()
        before = dict(day.shape_snapshot)

        session.add(
            PreferenceBlock(
                user_id=user.id,
                kind="deep_work",
                start_offset_minutes=60,
                end_offset_minutes=240,
            )
        )
        await session.commit()

        assert await day_service.refresh_blocks(session, user, MIDDAY) is None
        await session.refresh(day)
        assert dict(day.shape_snapshot) == before
        assert day.verdict == "failure"

    async def test_nothing_happens_in_the_gap_between_days(self, session, user):
        await day_service.open_day(session, user, ANCHOR)
        await session.commit()
        gap = datetime(2026, 3, 11, 9, 0, tzinfo=ZoneInfo("Asia/Kolkata")).astimezone(UTC)
        assert await day_service.refresh_blocks(session, user, gap) is None

    async def test_an_unopened_day_is_not_materialized(self, session, user):
        """Editing settings must not open a day the user has not reached yet."""
        assert await day_service.refresh_blocks(session, user, MIDDAY) is None
        count = await session.scalar(select(func.count()).select_from(LogicalDay))
        assert count == 0


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
