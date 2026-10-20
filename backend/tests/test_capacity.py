"""Capacity base, threshold, and the at-risk signal."""

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from doer.services import capacity

TZ = "Asia/Kolkata"
ANCHOR = date(2026, 3, 10)

# 14:00 start. Deep work 15:00-18:00 (offsets 60-240) and personal project
# 21:00-23:00 (offsets 420-540) give 5 focus hours. Social 23:00-00:30 is not focus.
SNAPSHOT = {
    "day_start_time": "14:00:00",
    "day_duration_minutes": 900,
    "blocks": [
        {"kind": "deep_work", "start_offset_minutes": 60, "end_offset_minutes": 240},
        {"kind": "personal_project", "start_offset_minutes": 420, "end_offset_minutes": 540},
        {"kind": "social", "start_offset_minutes": 540, "end_offset_minutes": 630},
        {"kind": "personal", "start_offset_minutes": 0, "end_offset_minutes": 60},
    ],
}


def busy(y, m, d, h1, m1, h2, m2):
    a = datetime(y, m, d, h1, m1, tzinfo=ZoneInfo(TZ)).astimezone(UTC)
    b = datetime(y, m, d, h2, m2, tzinfo=ZoneInfo(TZ)).astimezone(UTC)
    return (a, b)


def compute(**kwargs):
    return capacity.compute(
        snapshot=SNAPSHOT, anchor=ANCHOR, tz=TZ, ratio=0.5, **kwargs
    )


class TestBase:
    def test_base_counts_only_focus_blocks(self):
        """T-CAP-05. Social and personal time are not capacity."""
        assert compute().base_minutes == 300

    def test_threshold_is_the_ratio_of_the_base(self):
        """T-CAP-06. 50% of 5 hours is 2h30."""
        assert compute().threshold_minutes == 150

    def test_a_different_ratio_moves_the_threshold(self):
        result = capacity.compute(snapshot=SNAPSHOT, anchor=ANCHOR, tz=TZ, ratio=0.4)
        assert result.threshold_minutes == 120


class TestBusySubtraction:
    def test_busy_inside_a_focus_block_subtracts(self):
        """T-CAP-01."""
        result = compute(busy=[busy(2026, 3, 10, 16, 0, 17, 0)])
        assert result.busy_minutes_subtracted == 60
        assert result.base_minutes == 240

    def test_busy_partially_overlapping_subtracts_only_the_overlap(self):
        """T-CAP-02. 14:30-15:30 overlaps deep work (15:00-18:00) by 30 minutes."""
        result = compute(busy=[busy(2026, 3, 10, 14, 30, 15, 30)])
        assert result.busy_minutes_subtracted == 30

    def test_busy_entirely_outside_focus_blocks_subtracts_nothing(self):
        """T-CAP-03. 19:00-20:00 falls between the two focus blocks."""
        result = compute(busy=[busy(2026, 3, 10, 19, 0, 20, 0)])
        assert result.busy_minutes_subtracted == 0
        assert result.base_minutes == 300

    def test_overlapping_busy_intervals_are_not_double_counted(self):
        """T-CAP-04."""
        result = compute(
            busy=[busy(2026, 3, 10, 16, 0, 17, 0), busy(2026, 3, 10, 16, 30, 17, 30)]
        )
        assert result.busy_minutes_subtracted == 90

    def test_busy_spanning_two_focus_blocks_counts_both_overlaps(self):
        result = compute(busy=[busy(2026, 3, 10, 15, 0, 23, 0)])
        assert result.busy_minutes_subtracted == 300
        assert result.base_minutes == 0


class TestRiskFlag:
    def test_committed_above_threshold_is_at_risk(self):
        """T-CAP-07."""
        assert compute(committed_minutes=151).is_at_risk is True

    def test_committed_exactly_at_threshold_is_not_at_risk(self):
        """T-CAP-07 boundary. Strictly greater, not greater-or-equal."""
        assert compute(committed_minutes=150).is_at_risk is False

    def test_committed_below_threshold_is_not_at_risk(self):
        assert compute(committed_minutes=90).is_at_risk is False


class TestIndeterminate:
    def test_no_focus_blocks_is_indeterminate_and_does_not_fall_back(self):
        """T-CAP-08 / AC-16.

        The refusal that matters: falling back to the full 15-hour day span would
        count sleep-adjacent and social hours as capacity and make the at-risk flag
        meaningless. Plan §8 forbids it explicitly.
        """
        snapshot = {**SNAPSHOT, "blocks": [
            {"kind": "social", "start_offset_minutes": 0, "end_offset_minutes": 600}
        ]}
        result = capacity.compute(snapshot=snapshot, anchor=ANCHOR, tz=TZ, ratio=0.5)
        assert result.is_indeterminate is True
        assert result.indeterminate_reason == "no_focus_blocks"
        assert result.base_minutes == 0
        assert result.base_minutes != 900, "must not fall back to the full day span"

    def test_unestimated_primary_makes_the_day_indeterminate_not_safe(self):
        """T-CAP-09 / AC-17. Unknown capacity must never read as headroom."""
        result = compute(committed_minutes=60, has_unestimated_primary=True)
        assert result.is_indeterminate is True
        assert result.indeterminate_reason == "unestimated_primaries"
        assert result.is_at_risk is False

    def test_a_fully_estimated_day_is_determinate(self):
        assert compute(committed_minutes=60).is_indeterminate is False


class TestMergeIntervals:
    def test_adjacent_intervals_merge(self):
        a = busy(2026, 3, 10, 15, 0, 16, 0)
        b = busy(2026, 3, 10, 16, 0, 17, 0)
        assert len(capacity.merge_intervals([a, b])) == 1

    def test_disjoint_intervals_do_not_merge(self):
        a = busy(2026, 3, 10, 15, 0, 16, 0)
        b = busy(2026, 3, 10, 17, 0, 18, 0)
        assert len(capacity.merge_intervals([a, b])) == 2

    def test_empty_input_is_empty_output(self):
        assert capacity.merge_intervals([]) == []
