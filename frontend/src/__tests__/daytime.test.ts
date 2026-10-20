import { describe, expect, it } from "vitest";
import {
  clampEndToDay,
  clockToOffset,
  dayEndClock,
  endForStart,
  findOverlap,
  firstFreeGap,
  formatDuration,
  offsetToClock,
  toOffsets,
} from "../lib/daytime";

// The canonical late-night shape: the day runs 14:00 to 05:00, 15 hours.
const DAY_START = "14:00";
const DURATION = 15 * 60;

describe("clock times to offsets", () => {
  it("maps the start of the day to zero", () => {
    expect(clockToOffset("14:00", DAY_START)).toBe(0);
  });

  it("maps a time later the same afternoon", () => {
    expect(clockToOffset("15:00", DAY_START)).toBe(60);
  });

  it("maps a time past midnight to the far end of the day", () => {
    // 00:30 is not 13.5 hours before the day started, it is 10.5 hours after.
    expect(clockToOffset("00:30", DAY_START)).toBe(10 * 60 + 30);
  });

  it("maps the final hour of a late-night day", () => {
    expect(clockToOffset("04:00", DAY_START)).toBe(14 * 60);
  });

  it("round-trips back to the same clock time", () => {
    for (const clock of ["14:00", "18:45", "23:00", "00:30", "04:15"]) {
      expect(offsetToClock(clockToOffset(clock, DAY_START), DAY_START)).toBe(clock);
    }
  });

  it("works for an ordinary daytime shape too", () => {
    expect(clockToOffset("13:00", "09:00")).toBe(4 * 60);
    expect(offsetToClock(4 * 60, "09:00")).toBe("13:00");
  });
});

describe("block ranges", () => {
  it("accepts an ordinary afternoon block", () => {
    expect(toOffsets("15:00", "19:00", DAY_START, DURATION)).toEqual({
      start: 60,
      end: 5 * 60,
    });
  });

  it("accepts a block that crosses midnight", () => {
    // 23:00 to 00:30 is the case the offset model exists for.
    expect(toOffsets("23:00", "00:30", DAY_START, DURATION)).toEqual({
      start: 9 * 60,
      end: 10 * 60 + 30,
    });
  });

  it("accepts a block ending exactly at the end of the day", () => {
    expect(toOffsets("03:00", "05:00", DAY_START, DURATION)).toEqual({
      start: 13 * 60,
      end: 15 * 60,
    });
  });

  it("rejects a block that runs past the end of the day", () => {
    const result = toOffsets("03:00", "06:00", DAY_START, DURATION);
    expect("error" in result && result.error.kind).toBe("past_day_end");
    if ("error" in result && result.error.kind === "past_day_end") {
      expect(result.error.endsAt).toBe("06:00");
      expect(result.error.dayEndsAt).toBe("05:00");
    }
  });

  it("reads an equal start and end as a full day rather than nothing", () => {
    // Deliberate: for a day that wraps, 15:00 to 15:00 can only mean a full
    // revolution, and the day-length check catches it when it does not fit.
    const result = toOffsets("15:00", "15:00", DAY_START, DURATION);
    expect("error" in result && result.error.kind).toBe("past_day_end");
  });

  it("rejects a block starting before the day begins", () => {
    // 13:00 on a 14:00 day is 23 hours in, which no 15 hour day contains.
    const result = toOffsets("13:00", "13:30", DAY_START, DURATION);
    expect("error" in result && result.error.kind).toBe("start_outside_day");
  });
});

describe("durations read as people say them", () => {
  it.each([
    [45, "45m"],
    [60, "1h"],
    [90, "1h 30m"],
    [300, "5h"],
  ])("renders %i minutes as %s", (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });
});

describe("overlap detection", () => {
  const existing = [
    { start_offset_minutes: 60, end_offset_minutes: 300, kind: "deep_work" },
    { start_offset_minutes: 420, end_offset_minutes: 540, kind: "personal_project" },
  ];

  it("catches a block sitting inside another", () => {
    expect(findOverlap(120, 180, existing)?.kind).toBe("deep_work");
  });

  it("catches a block that only clips the edge", () => {
    expect(findOverlap(280, 360, existing)?.kind).toBe("deep_work");
  });

  it("allows a block that starts exactly where another ends", () => {
    // Ranges are half-open, so touching is not overlapping.
    expect(findOverlap(300, 420, existing)).toBeNull();
  });

  it("allows a block in a genuine gap", () => {
    expect(findOverlap(320, 400, existing)).toBeNull();
  });

  it("finds nothing when there are no blocks", () => {
    expect(findOverlap(0, 100, [])).toBeNull();
  });
});

describe("suggesting a free slot", () => {
  it("suggests the start of the day when nothing is claimed", () => {
    expect(firstFreeGap([], 15 * 60)).toEqual({ start: 0, end: 120 });
  });

  it("suggests the gap before the first block when there is room", () => {
    const blocks = [{ start_offset_minutes: 180, end_offset_minutes: 300 }];
    expect(firstFreeGap(blocks, 15 * 60)).toEqual({ start: 0, end: 120 });
  });

  it("skips a gap too small to be useful", () => {
    const blocks = [
      { start_offset_minutes: 20, end_offset_minutes: 300 },
      { start_offset_minutes: 310, end_offset_minutes: 420 },
    ];
    // The 20 minute opening at the start and the 10 minute one at 300 are both
    // too short to propose, so the suggestion lands after the last block.
    expect(firstFreeGap(blocks, 15 * 60)).toEqual({ start: 420, end: 540 });
  });

  it("clips the suggestion to the end of the day", () => {
    const blocks = [{ start_offset_minutes: 0, end_offset_minutes: 840 }];
    expect(firstFreeGap(blocks, 15 * 60)).toEqual({ start: 840, end: 900 });
  });

  it("returns nothing when the day is full", () => {
    const blocks = [{ start_offset_minutes: 0, end_offset_minutes: 900 }];
    expect(firstFreeGap(blocks, 15 * 60)).toBeNull();
  });

  it("handles unordered input", () => {
    const blocks = [
      { start_offset_minutes: 420, end_offset_minutes: 540 },
      { start_offset_minutes: 0, end_offset_minutes: 300 },
    ];
    expect(firstFreeGap(blocks, 15 * 60)).toEqual({ start: 300, end: 420 });
  });
});

describe("carrying the end time along when the start moves", () => {
  it("advances an end left behind by the new start", () => {
    // The reported case: From moved to 22:00 while Until still read 20:00, which
    // wraps nearly a full day and cannot fit.
    expect(endForStart("22:00", "20:00", DAY_START, DURATION)).toBe("23:00");
  });

  it("leaves a range that already works alone", () => {
    expect(endForStart("15:00", "19:00", DAY_START, DURATION)).toBeNull();
  });

  it("leaves a legitimate midnight crossing alone", () => {
    // 23:00 to 00:30 reads backwards on the clock and is entirely valid, so
    // nothing should be "corrected" here.
    expect(endForStart("23:00", "00:30", DAY_START, DURATION)).toBeNull();
  });

  it("gives an hour by default", () => {
    expect(endForStart("18:00", "16:00", DAY_START, DURATION)).toBe("19:00");
  });

  it("gives whatever is left when there is less than an hour", () => {
    // 04:30 leaves only thirty minutes before the day ends at 05:00.
    expect(endForStart("04:30", "20:00", DAY_START, DURATION)).toBe("05:00");
  });

  it("declines to adjust when the start is outside the day", () => {
    // 09:00 is in the gap between days; no end time rescues it.
    expect(endForStart("09:00", "10:00", DAY_START, DURATION)).toBeNull();
  });

  it("declines to adjust at the exact end of the day", () => {
    expect(endForStart("05:00", "06:00", DAY_START, DURATION)).toBeNull();
  });

  it("respects a custom preferred length", () => {
    expect(endForStart("18:00", "16:00", DAY_START, DURATION, 30)).toBe("18:30");
  });

  it("works on an ordinary daytime shape", () => {
    expect(endForStart("15:00", "11:00", "09:00", 8 * 60)).toBe("16:00");
  });
});

describe("a start outside the day is named as such", () => {
  it("reports start_outside_day rather than a confusing end-time error", () => {
    const result = toOffsets("09:00", "10:00", DAY_START, DURATION);
    expect("error" in result && result.error.kind).toBe("start_outside_day");
    if ("error" in result && result.error.kind === "start_outside_day") {
      expect(result.error.dayStartsAt).toBe("14:00");
      expect(result.error.dayEndsAt).toBe("05:00");
    }
  });

  it("still accepts a start on the final minute boundary", () => {
    expect(toOffsets("04:59", "05:00", DAY_START, DURATION)).toEqual({
      start: 14 * 60 + 59,
      end: 15 * 60,
    });
  });
});

describe("capping the end at the end of the day", () => {
  it("reports the latest permissible end", () => {
    expect(dayEndClock(DAY_START, DURATION)).toBe("05:00");
    expect(dayEndClock("09:00", 8 * 60)).toBe("17:00");
  });

  it("pulls an overrunning end back to the day's end", () => {
    // 12:00 is noon, genuinely outside a 14:00 to 05:00 day.
    expect(clampEndToDay("22:00", "12:00", DAY_START, DURATION)).toBe("05:00");
  });

  it("leaves a block that already fits alone", () => {
    expect(clampEndToDay("15:00", "19:00", DAY_START, DURATION)).toBeNull();
  });

  it("leaves a block crossing midnight alone", () => {
    // The case that must survive: after midnight is inside this day, not past it.
    expect(clampEndToDay("22:00", "00:30", DAY_START, DURATION)).toBeNull();
    expect(clampEndToDay("23:00", "02:00", DAY_START, DURATION)).toBeNull();
  });

  it("leaves a block ending exactly at the day's end alone", () => {
    expect(clampEndToDay("03:00", "05:00", DAY_START, DURATION)).toBeNull();
  });

  it("declines when the start is itself outside the day", () => {
    // Capping the end cannot rescue a start that is in the gap between days.
    expect(clampEndToDay("09:00", "12:00", DAY_START, DURATION)).toBeNull();
  });

  it("caps on an ordinary daytime shape too", () => {
    expect(clampEndToDay("15:00", "22:00", "09:00", 8 * 60)).toBe("17:00");
  });
});

describe("after midnight is inside a late-night day", () => {
  it.each([
    ["23:00", "00:30", 540, 630],
    ["22:00", "01:00", 480, 660],
    ["23:30", "04:00", 570, 840],
    ["00:30", "02:00", 630, 720],
    ["02:00", "05:00", 720, 900],
  ])("accepts %s to %s", (from, to, start, end) => {
    expect(toOffsets(from, to, DAY_START, DURATION)).toEqual({ start, end });
  });

  it("rejects only what genuinely falls past the end", () => {
    const result = toOffsets("03:00", "06:00", DAY_START, DURATION);
    expect("error" in result && result.error.kind).toBe("past_day_end");
  });
});
