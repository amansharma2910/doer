/**
 * Clock times in, offsets out.
 *
 * Blocks are stored as minutes from the start of the logical day, which is what
 * makes a block crossing midnight ordinary rather than a special case. That model
 * is right for storage and wrong for people: nobody thinks "deep work from hour 1
 * to hour 4". These functions keep the offset model at the boundary.
 */

export const MINUTES_IN_DAY = 24 * 60;

/**
 * Is this a readable 24-hour wall clock time?
 *
 * Worth a predicate rather than a try/catch because an unreadable value is
 * ordinary, not exceptional: a cleared field reports "" and a half-typed one
 * reports whatever the user has reached so far. `parseClock` returns NaN for
 * those, and NaN compares false against everything, so an unguarded range reads
 * as valid all the way to the server, which rejects it.
 */
export function isClock(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function parseClock(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * The same clock time moved by some minutes, wrapping through midnight.
 *
 * `formatClock` already wraps in both directions, so 23:00 plus an hour is 00:00
 * and 00:00 minus an hour is 23:00 with nothing further to write.
 */
export function stepClock(clock: string, deltaMinutes: number): string {
  return formatClock(parseClock(clock) + deltaMinutes);
}

/**
 * The nearest multiple of `step` within the hour.
 *
 * "Nearest" and "never carries" genuinely conflict above the last multiple, and
 * the conflict is resolved deliberately in favour of never carrying: on a field
 * accepting only :00 and :30, a typed 45 settles to 30 rather than advancing the
 * hour. Jumping back by up to 29 minutes is the lesser surprise, because the
 * hour is a segment the person did not touch.
 */
export function snapMinute(minutes: number, step: number): number {
  if (step <= 1) return minutes;
  const last = Math.floor(59 / step) * step;
  return Math.min(Math.round(minutes / step) * step, last);
}

/**
 * The next or previous clock time whose minutes are a multiple of `step`.
 *
 * Not `stepClock` by `step`, which would preserve an off-grid value forever: a
 * field restricted to :00 and :30 that is handed 15:45 by the suggestion logic
 * would step 16:15, 16:45, 17:15 and never once land on a value it accepts.
 * Stepping to the multiple reaches the grid on the first press.
 */
export function stepToMultiple(clock: string, step: number, forward: boolean): string {
  if (step <= 1) return stepClock(clock, forward ? 1 : -1);
  const over = (parseClock(clock) % 60) % step;
  return stepClock(clock, forward ? step - over : -(over || step));
}

export function formatClock(minutesFromMidnight: number): string {
  const wrapped = ((minutesFromMidnight % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Minutes from the start of the day to this wall-clock time. */
export function clockToOffset(clock: string, dayStart: string): number {
  const offset = parseClock(clock) - parseClock(dayStart);
  // A clock time earlier than the day's start belongs to the following calendar
  // date, which for a 14:00 day is how 00:30 becomes offset 630.
  return offset < 0 ? offset + MINUTES_IN_DAY : offset;
}

export function offsetToClock(offset: number, dayStart: string): string {
  return formatClock(parseClock(dayStart) + offset);
}

export const DEFAULT_BLOCK_MINUTES = 60;

export type BlockRangeError =
  | { kind: "unreadable" }
  | { kind: "zero_length" }
  | { kind: "start_outside_day"; dayStartsAt: string; dayEndsAt: string }
  | { kind: "past_day_end"; endsAt: string; dayEndsAt: string };

/**
 * Convert a clock range into offsets, or explain why it cannot be one.
 *
 * An end at or before the start is read as crossing midnight rather than as an
 * error, because for a day that runs 14:00 to 05:00 a block from 23:00 to 00:30 is
 * entirely ordinary.
 */
export function toOffsets(
  from: string,
  to: string,
  dayStart: string,
  dayDurationMinutes: number,
): { start: number; end: number } | { error: BlockRangeError } {
  if (!isClock(from) || !isClock(to)) return { error: { kind: "unreadable" } };

  const start = clockToOffset(from, dayStart);
  if (start >= dayDurationMinutes) {
    // The start itself falls in the gap between days, which no end time can fix.
    return {
      error: {
        kind: "start_outside_day",
        dayStartsAt: dayStart,
        dayEndsAt: formatClock(parseClock(dayStart) + dayDurationMinutes),
      },
    };
  }

  let end = clockToOffset(to, dayStart);
  if (end <= start) end += MINUTES_IN_DAY;

  if (end === start) return { error: { kind: "zero_length" } };
  if (end > dayDurationMinutes) {
    return {
      error: {
        kind: "past_day_end",
        endsAt: formatClock(parseClock(dayStart) + end),
        dayEndsAt: formatClock(parseClock(dayStart) + dayDurationMinutes),
      },
    };
  }
  return { start, end };
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** The smallest shape placement needs from a block. */
export type BlockRange = {
  start_offset_minutes: number;
  end_offset_minutes: number;
};

/**
 * Does [start, end) collide with any existing block?
 *
 * Generic in the block type so callers that have a full block get it back with
 * its `kind` intact, while placement can pass bare ranges.
 */
export function findOverlap<T extends BlockRange>(
  start: number,
  end: number,
  blocks: T[],
): T | null {
  return (
    blocks.find((b) => start < b.end_offset_minutes && end > b.start_offset_minutes) ?? null
  );
}

/**
 * The first stretch of unclaimed time long enough to be worth suggesting.
 *
 * Defaulting the form to a slot that is already taken makes the first thing a
 * person tries fail, which is a poor way to introduce a concept they are still
 * learning.
 */
export function firstFreeGap(
  blocks: { start_offset_minutes: number; end_offset_minutes: number }[],
  dayDurationMinutes: number,
  preferredLength = 120,
): { start: number; end: number } | null {
  const ordered = [...blocks].sort(
    (a, b) => a.start_offset_minutes - b.start_offset_minutes,
  );

  let cursor = 0;
  for (const block of ordered) {
    if (block.start_offset_minutes - cursor >= 30) {
      return { start: cursor, end: Math.min(block.start_offset_minutes, cursor + preferredLength) };
    }
    cursor = Math.max(cursor, block.end_offset_minutes);
  }

  if (dayDurationMinutes - cursor >= 30) {
    return { start: cursor, end: Math.min(dayDurationMinutes, cursor + preferredLength) };
  }
  return null;
}

/**
 * An end time that makes the block valid, or null if the current one already does.
 *
 * Only consulted when the start changes. A start that leaves the end behind it is
 * usually a half-finished edit rather than an intention, and refusing to proceed
 * while knowing exactly what the person meant is pure friction. Note that an end
 * earlier on the clock than the start is often correct here: on a day running
 * 14:00 to 05:00, a block from 23:00 to 00:30 is ordinary, so the trigger is that
 * the range does not fit, never that the clock reads backwards.
 */
export function endForStart(
  from: string,
  to: string,
  dayStart: string,
  dayDurationMinutes: number,
  preferredMinutes = DEFAULT_BLOCK_MINUTES,
): string | null {
  const start = clockToOffset(from, dayStart);
  if (start >= dayDurationMinutes) return null;

  if ("start" in toOffsets(from, to, dayStart, dayDurationMinutes)) return null;

  // Take the hour if it is there, and whatever remains of the day if it is not.
  const end = Math.min(start + preferredMinutes, dayDurationMinutes);
  return end > start ? offsetToClock(end, dayStart) : null;
}

/**
 * The latest end a block may have: the moment the day itself ends.
 */
export function dayEndClock(dayStart: string, dayDurationMinutes: number): string {
  return offsetToClock(dayDurationMinutes, dayStart);
}

/**
 * Pull an end time back to the end of the day when it overruns, or null when it
 * already fits.
 *
 * Applied when the field settles rather than on every keystroke. Entry is
 * digit by digit, so clamping live would rewrite the 1 on the way to 14 into the
 * day's end before the 4 arrived. The reason predates the 24-hour control and
 * survives it: only the example changed, not the hazard.
 */
export function clampEndToDay(
  from: string,
  to: string,
  dayStart: string,
  dayDurationMinutes: number,
): string | null {
  const start = clockToOffset(from, dayStart);
  if (start >= dayDurationMinutes) return null;

  const range = toOffsets(from, to, dayStart, dayDurationMinutes);
  if ("start" in range) return null;

  const end = dayEndClock(dayStart, dayDurationMinutes);
  // Only worth clamping if it leaves an actual block behind.
  return clockToOffset(end, dayStart) > start || dayDurationMinutes > start ? end : null;
}

/**
 * Direct manipulation of a window on the day bar.
 *
 * Everything below works in offsets and never in clock strings, deliberately:
 * `toOffsets` reads an end at or before its start as crossing midnight, which is
 * right for a time someone typed and catastrophic for a gesture, where pulling an
 * edge backwards would become a 23.5 hour range and the window would vanish.
 *
 * A dragged edge comes to rest on a *candidate*: either a wall-clock half hour, or
 * an *anchor*, meaning a block's boundary or one end of the day. Anchors are what
 * make "flush against the neighbour" reachable at all, since nothing obliges a
 * stored block to start on a half hour. See ADR 0002.
 */

export const SNAP_MINUTES = 30;

/** No gesture may leave a window shorter than this, at any position. */
export const MIN_WINDOW_MINUTES = 30;

function unique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/** The wall-clock half hours that fall inside this day, as offsets. */
export function gridOffsets(dayStart: string, dayDurationMinutes: number): number[] {
  // A day starting at 09:15 puts the half hours at offsets 15, 45, 75, so the grid
  // is phase-shifted rather than simply every 30 minutes from zero.
  const phase = (SNAP_MINUTES - (parseClock(dayStart) % SNAP_MINUTES)) % SNAP_MINUTES;
  const offsets: number[] = [];
  for (let o = phase; o <= dayDurationMinutes; o += SNAP_MINUTES) offsets.push(o);
  return offsets;
}

/** The day's own two ends, plus every boundary of every block. */
export function anchorOffsets(
  dayDurationMinutes: number,
  blocks: BlockRange[],
): number[] {
  const offsets = [0, dayDurationMinutes];
  for (const block of blocks) {
    offsets.push(block.start_offset_minutes, block.end_offset_minutes);
  }
  return unique(offsets.filter((o) => o >= 0 && o <= dayDurationMinutes));
}

/** Every position a dragged edge may come to rest on, ascending. */
export function candidatePositions(
  dayStart: string,
  dayDurationMinutes: number,
  blocks: BlockRange[],
): number[] {
  return unique([
    ...gridOffsets(dayStart, dayDurationMinutes),
    ...anchorOffsets(dayDurationMinutes, blocks),
  ]);
}

/**
 * The value in `pool` closest to `target`, ties going the way the drag is headed.
 *
 * The tie-break is what decides when a window pops past a block: the two parked
 * positions are equidistant at exactly one point, and travelling right should
 * resolve rightwards.
 */
function nearest(pool: number[], target: number, forward: boolean): number {
  let best = pool[0];
  let bestDistance = Math.abs(best - target);
  for (const value of pool) {
    const distance = Math.abs(value - target);
    if (distance < bestDistance) {
      best = value;
      bestDistance = distance;
    } else if (distance === bestDistance && (forward ? value > best : value < best)) {
      best = value;
    }
  }
  return best;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Candidate starts for a window of this length, bounded by the day. */
function startCandidates(
  length: number,
  dayStart: string,
  dayDurationMinutes: number,
  blocks: BlockRange[],
): number[] {
  const maxStart = dayDurationMinutes - length;
  const anchors = anchorOffsets(dayDurationMinutes, blocks);
  return unique(
    [
      ...gridOffsets(dayStart, dayDurationMinutes),
      ...anchors,
      // The window's *end* on an anchor, which is how it sits flush against a
      // block on its right.
      ...anchors.map((a) => a - length),
    ].filter((s) => s >= 0 && s <= maxStart),
  );
}

/**
 * Slide a whole window, keeping its length.
 *
 * Magnetic: of the candidate positions, only those overlapping nothing are
 * considered, so a body drag cannot produce an illegal window. Pushing into a
 * block therefore parks flush against it, and carrying the pointer far enough
 * pops the window to the free space beyond. When the window fits nowhere at all,
 * which only typed input can arrange, the legality filter is dropped so the
 * control still responds and the existing invalid state does the talking.
 */
export function slideWindow(
  start: number,
  length: number,
  deltaMinutes: number,
  dayStart: string,
  dayDurationMinutes: number,
  blocks: BlockRange[],
): { start: number; end: number } {
  if (length <= 0 || length > dayDurationMinutes) return { start, end: start + length };

  const target = clamp(start + deltaMinutes, 0, dayDurationMinutes - length);
  const candidates = startCandidates(length, dayStart, dayDurationMinutes, blocks);
  const legal = candidates.filter((s) => findOverlap(s, s + length, blocks) === null);
  const pool = legal.length > 0 ? legal : candidates;
  if (pool.length === 0) return { start, end: start + length };

  const next = nearest(pool, target, deltaMinutes >= 0);
  return { start: next, end: next + length };
}

/**
 * How far a dragged edge may travel before a neighbour stops it.
 *
 * Edges never jump. Where a body drag hops over a block to the free space beyond,
 * an edge stops against it, because carrying the far side of the window along is
 * a move rather than a resize.
 */
function edgeBounds(
  edge: "start" | "end",
  start: number,
  end: number,
  dayDurationMinutes: number,
  blocks: BlockRange[],
): { low: number; high: number } {
  // Selected by reaching past the anchored edge, not by sitting clear of the
  // dragged one. A block the window already straddles, which only typed input can
  // arrange, matches neither "entirely left" nor "entirely right" and would leave
  // the barrier at the day's edge, letting the drag pass through the block.
  // Caught here instead, where it produces no movement rather than a worse overlap.
  if (edge === "start") {
    const barrier = blocks
      .filter((b) => b.start_offset_minutes < end)
      .reduce((max, b) => Math.max(max, b.end_offset_minutes), 0);
    return { low: barrier, high: end - MIN_WINDOW_MINUTES };
  }
  const barrier = blocks
    .filter((b) => b.end_offset_minutes > start)
    .reduce((min, b) => Math.min(min, b.start_offset_minutes), dayDurationMinutes);
  return { low: start + MIN_WINDOW_MINUTES, high: barrier };
}

/**
 * Move one edge, holding the other still.
 *
 * The 30 minute floor outranks the anchors: on a day starting at 09:15 the day's
 * own start is a legal position but `[0, 15]` is not a legal window, so the floor
 * is applied to the bounds before any candidate is considered.
 */
export function resizeWindow(
  edge: "start" | "end",
  start: number,
  end: number,
  deltaMinutes: number,
  dayStart: string,
  dayDurationMinutes: number,
  blocks: BlockRange[],
): { start: number; end: number } {
  const { low, high } = edgeBounds(edge, start, end, dayDurationMinutes, blocks);
  if (high < low) return { start, end };

  const current = edge === "start" ? start : end;
  const target = clamp(current + deltaMinutes, low, high);
  const pool = candidatePositions(dayStart, dayDurationMinutes, blocks).filter(
    (c) => c >= low && c <= high,
  );
  if (pool.length === 0) return { start, end };

  const next = nearest(pool, target, deltaMinutes >= 0);
  return edge === "start" ? { start: next, end } : { start, end: next };
}

/**
 * One keyboard step, in the direction pressed.
 *
 * Deliberately not `slideWindow` with a 30 minute delta. A window parked flush
 * against a block is already the position nearest a small nudge, so a nudge would
 * leave it exactly where it is and the arrow key would read as broken. Stepping to
 * the next candidate past the current one always moves, which is what a key press
 * must do, and it still obeys every placement rule: the step out of a parked
 * position is the pop to the far side.
 */
export function stepWindow(
  start: number,
  length: number,
  forward: boolean,
  dayStart: string,
  dayDurationMinutes: number,
  blocks: BlockRange[],
): { start: number; end: number } {
  if (length <= 0 || length > dayDurationMinutes) return { start, end: start + length };

  const candidates = startCandidates(length, dayStart, dayDurationMinutes, blocks);
  const legal = candidates.filter((s) => findOverlap(s, s + length, blocks) === null);
  const pool = legal.length > 0 ? legal : candidates;

  const onward = forward ? pool.filter((s) => s > start) : pool.filter((s) => s < start);
  if (onward.length === 0) return { start, end: start + length };

  const next = forward ? onward[0] : onward[onward.length - 1];
  return { start: next, end: next + length };
}

/** One keyboard step for a single edge, in the direction pressed. */
export function stepEdge(
  edge: "start" | "end",
  start: number,
  end: number,
  forward: boolean,
  dayStart: string,
  dayDurationMinutes: number,
  blocks: BlockRange[],
): { start: number; end: number } {
  const { low, high } = edgeBounds(edge, start, end, dayDurationMinutes, blocks);
  if (high < low) return { start, end };

  const current = edge === "start" ? start : end;
  const pool = candidatePositions(dayStart, dayDurationMinutes, blocks).filter(
    (c) => c >= low && c <= high,
  );
  const onward = forward ? pool.filter((c) => c > current) : pool.filter((c) => c < current);
  if (onward.length === 0) return { start, end };

  const next = forward ? onward[0] : onward[onward.length - 1];
  return edge === "start" ? { start: next, end } : { start, end: next };
}

/**
 * An anchor date as a person would say it.
 *
 * `2026-10-23` is a database value, not a day. It was the heading of the main
 * screen, set in the recessed label style, which is how the one thing that
 * identifies the page came to read as a throwaway.
 *
 * Split and reassembled rather than passed to `new Date("2026-10-23")`, which
 * parses a bare date as UTC midnight. West of Greenwich that renders as the
 * previous day, which is exactly the class of defect that
 * `fix_plan_heatmap-utc-date-shift.md` already records once.
 */
export function formatAnchorDate(anchor: string, today?: string): string {
  // Matched strictly rather than split and coerced. `Number("")` is 0 rather
  // than NaN, so "--" passed a NaN guard, and `new Date(2026, 12, 45)` rolls
  // over to the following February rather than failing, so a range check after
  // construction never fires either. Together those rendered "2026-13-45" as a
  // confident "Sunday, February 14" above an error message.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchor);
  if (!match) return anchor;
  const [year, month, day] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return anchor;
  const date = new Date(year, month - 1, day);
  // Round-trip: anything that rolled over is not the date it was given.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return anchor;
  }

  const label = date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return today === anchor ? `Today, ${label}` : label;
}

/** The anchor-date string for the caller's current local date. */
export function localAnchorToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
