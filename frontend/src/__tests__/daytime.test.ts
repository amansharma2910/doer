import { describe, expect, it } from "vitest";
import {
  clockToOffset,
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
    expect("error" in result).toBe(true);
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
