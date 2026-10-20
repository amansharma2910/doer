"""Capacity and the at-risk signal.

Capacity base is the real minutes inside focus blocks (work and personal project),
minus calendar busy time overlapping those blocks. The threshold is a configurable
fraction of that base, defaulting to 50%.

Two deliberate refusals, both from plan §8:

- With no focus blocks defined, the day is indeterminate. It does NOT fall back to
  the full declared day span: counting sleep-adjacent and social hours as available
  capacity would make the at-risk flag meaningless.
- With any unestimated primary, the day is indeterminate rather than safe. Unknown
  capacity must never read as headroom.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time

from doer.daytime import offset_bounds
from doer.models.user import FOCUS_KINDS


@dataclass(frozen=True)
class CapacityResult:
    base_minutes: int
    busy_minutes_subtracted: int
    threshold_minutes: int
    is_indeterminate: bool
    indeterminate_reason: str | None
    is_at_risk: bool


def focus_intervals(
    snapshot: dict, anchor: date, tz: str
) -> list[tuple[datetime, datetime, int]]:
    """Real UTC intervals for the focus blocks frozen into a day's snapshot."""
    start_time = time.fromisoformat(snapshot["day_start_time"])
    out = []
    for block in snapshot.get("blocks", []):
        if block["kind"] not in FOCUS_KINDS:
            continue
        a, b, minutes = offset_bounds(
            anchor, start_time, block["start_offset_minutes"], block["end_offset_minutes"], tz
        )
        out.append((a, b, minutes))
    return out


def merge_intervals(
    intervals: list[tuple[datetime, datetime]],
) -> list[tuple[datetime, datetime]]:
    """Merge overlapping intervals so busy time is never double-counted."""
    if not intervals:
        return []
    ordered = sorted(intervals, key=lambda i: i[0])
    merged = [ordered[0]]
    for start, end in ordered[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def overlap_minutes(
    focus: list[tuple[datetime, datetime, int]], busy: list[tuple[datetime, datetime]]
) -> int:
    """Minutes of busy time that actually land inside focus blocks.

    Busy time entirely outside the focus blocks subtracts nothing, and a partial
    overlap subtracts only the overlapping portion.
    """
    merged = merge_intervals(busy)
    total = 0
    for f_start, f_end, _ in focus:
        for b_start, b_end in merged:
            lo = max(f_start, b_start)
            hi = min(f_end, b_end)
            if hi > lo:
                total += int((hi - lo).total_seconds() // 60)
    return total


def compute(
    *,
    snapshot: dict,
    anchor: date,
    tz: str,
    ratio: float,
    busy: list[tuple[datetime, datetime]] | None = None,
    committed_minutes: int = 0,
    has_unestimated_primary: bool = False,
) -> CapacityResult:
    focus = focus_intervals(snapshot, anchor, tz)

    if not focus:
        return CapacityResult(
            base_minutes=0,
            busy_minutes_subtracted=0,
            threshold_minutes=0,
            is_indeterminate=True,
            indeterminate_reason="no_focus_blocks",
            is_at_risk=False,
        )

    raw_minutes = sum(minutes for _, _, minutes in focus)
    subtracted = overlap_minutes(focus, busy or [])
    base = max(0, raw_minutes - subtracted)
    threshold = int(base * float(ratio))

    if has_unestimated_primary:
        return CapacityResult(
            base_minutes=base,
            busy_minutes_subtracted=subtracted,
            threshold_minutes=threshold,
            is_indeterminate=True,
            indeterminate_reason="unestimated_primaries",
            is_at_risk=False,
        )

    # Strictly greater: a day committed exactly to its threshold is not at risk.
    return CapacityResult(
        base_minutes=base,
        busy_minutes_subtracted=subtracted,
        threshold_minutes=threshold,
        is_indeterminate=False,
        indeterminate_reason=None,
        is_at_risk=committed_minutes > threshold,
    )
