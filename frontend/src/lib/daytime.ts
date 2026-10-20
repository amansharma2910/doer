/**
 * Clock times in, offsets out.
 *
 * Blocks are stored as minutes from the start of the logical day, which is what
 * makes a block crossing midnight ordinary rather than a special case. That model
 * is right for storage and wrong for people: nobody thinks "deep work from hour 1
 * to hour 4". These functions keep the offset model at the boundary.
 */

export const MINUTES_IN_DAY = 24 * 60;

export function parseClock(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
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

/** Does [start, end) collide with any existing block? */
export function findOverlap(
  start: number,
  end: number,
  blocks: { start_offset_minutes: number; end_offset_minutes: number; kind: string }[],
): { start_offset_minutes: number; end_offset_minutes: number; kind: string } | null {
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
 * Applied when the field loses focus rather than on every keystroke. A time input
 * reports a change per segment, so clamping live would rewrite "12" into the day's
 * end before the person reached the AM that would have made it valid.
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
