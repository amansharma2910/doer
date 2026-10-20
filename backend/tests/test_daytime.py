"""Logical day arithmetic: the highest-risk logic in the application.

Every test pins an explicit timezone and an explicit instant. None may depend on
the machine's clock or local timezone.
"""

from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

from doer.daytime import (
    day_bounds,
    elapsed_anchor_dates,
    offset_bounds,
    resolve_anchor_date,
)

# The canonical late-night shape from the plan: 14:00 start, 15 hours, ending 05:00.
LATE = dict(start_time=time(14, 0), duration_minutes=15 * 60, tz="Asia/Kolkata")


def _at(y, m, d, hh, mm, tz="Asia/Kolkata"):
    return datetime(y, m, d, hh, mm, tzinfo=ZoneInfo(tz)).astimezone(UTC)


class TestAnchorResolution:
    def test_completion_at_0300_belongs_to_the_previous_date(self):
        """T-DAY-01 / AC-01. The reason this product exists."""
        instant = _at(2026, 3, 11, 3, 0)
        assert resolve_anchor_date(instant, **LATE) == date(2026, 3, 10)

    def test_completion_at_1500_belongs_to_the_same_date(self):
        """T-DAY-02."""
        instant = _at(2026, 3, 10, 15, 0)
        assert resolve_anchor_date(instant, **LATE) == date(2026, 3, 10)

    def test_instant_exactly_at_day_start_is_inside_the_day(self):
        instant = _at(2026, 3, 10, 14, 0)
        assert resolve_anchor_date(instant, **LATE) == date(2026, 3, 10)

    def test_instant_exactly_at_day_end_belongs_to_the_next_day(self):
        """The interval is half-open, so 05:00 starts the gap, not the day."""
        instant = _at(2026, 3, 11, 5, 0)
        assert resolve_anchor_date(instant, **LATE) is None

    def test_instant_in_the_gap_between_days_resolves_to_nothing(self):
        """09:00 is after the 05:00 end and before the 14:00 start. We do not guess."""
        instant = _at(2026, 3, 11, 9, 0)
        assert resolve_anchor_date(instant, **LATE) is None

    def test_a_24_hour_day_has_no_gap(self):
        shape = dict(start_time=time(6, 0), duration_minutes=24 * 60, tz="Asia/Kolkata")
        for hour in range(24):
            instant = _at(2026, 3, 11, hour, 30)
            assert resolve_anchor_date(instant, **shape) is not None


class TestDstTransitions:
    """AC-12 / T-DAY-06 and T-DAY-07.

    A wall-clock duration that spans a transition yields a day that is genuinely
    shorter or longer in real time, and capacity has to follow that, because the
    user really does have one less (or one more) hour available.
    """

    # US spring forward 2026: 2026-03-08, 02:00 -> 03:00 local.
    SPRING = dict(start_time=time(14, 0), duration_minutes=15 * 60, tz="America/New_York")

    def test_spring_forward_day_is_one_hour_shorter(self):
        _, _, real = day_bounds(date(2026, 3, 7), **self.SPRING)
        assert real == 14 * 60, "15 wall-clock hours across spring-forward is 14 real hours"

    def test_fall_back_day_is_one_hour_longer(self):
        # US fall back 2026: 2026-11-01, 02:00 -> 01:00 local.
        shape = dict(start_time=time(14, 0), duration_minutes=15 * 60, tz="America/New_York")
        _, _, real = day_bounds(date(2026, 10, 31), **shape)
        assert real == 16 * 60

    def test_ordinary_day_matches_its_configured_duration(self):
        _, _, real = day_bounds(date(2026, 6, 15), **self.SPRING)
        assert real == 15 * 60

    def test_a_block_spanning_the_transition_is_also_adjusted(self):
        # Block at offsets 660-840 is 01:00-04:00 local, straddling the 02:00 jump.
        _, _, minutes = offset_bounds(date(2026, 3, 7), time(14, 0), 660, 840, "America/New_York")
        assert minutes == 120, "3 wall-clock hours across the jump is 2 real hours"

    def test_timezone_without_dst_is_never_adjusted(self):
        _, _, real = day_bounds(date(2026, 3, 7), time(14, 0), 15 * 60, "Asia/Kolkata")
        assert real == 15 * 60


class TestBlockOffsets:
    def test_block_crossing_midnight_needs_no_special_case(self):
        """23:00 to 00:30 inside a 14:00 day is just offsets 540 to 630."""
        start, end, minutes = offset_bounds(
            date(2026, 3, 10), time(14, 0), 540, 630, "Asia/Kolkata"
        )
        assert minutes == 90
        local_start = start.astimezone(ZoneInfo("Asia/Kolkata"))
        local_end = end.astimezone(ZoneInfo("Asia/Kolkata"))
        assert (local_start.hour, local_start.minute) == (23, 0)
        assert local_start.date() == date(2026, 3, 10)
        assert (local_end.hour, local_end.minute) == (0, 30)
        assert local_end.date() == date(2026, 3, 11), "crossed into the next calendar date"


class TestElapsedDays:
    def test_catches_up_in_order_after_the_app_was_closed(self):
        """T-DAY-08. Three elapsed days must close in anchor order, oldest first."""
        now = _at(2026, 3, 14, 20, 0)
        elapsed = elapsed_anchor_dates(date(2026, 3, 10), now, **LATE)
        assert elapsed == [date(2026, 3, 11), date(2026, 3, 12), date(2026, 3, 13)]

    def test_a_day_still_running_is_not_elapsed(self):
        now = _at(2026, 3, 11, 20, 0)  # inside the day that began 2026-03-11 14:00
        assert elapsed_anchor_dates(date(2026, 3, 10), now, **LATE) == []

    def test_nothing_elapsed_when_called_immediately(self):
        now = _at(2026, 3, 10, 16, 0)
        assert elapsed_anchor_dates(date(2026, 3, 10), now, **LATE) == []
