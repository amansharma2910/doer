import { describe, expect, it } from "vitest";
import {
  candidatePositions,
  clampEndToDay,
  isClock,
  clockToOffset,
  dayEndClock,
  endForStart,
  findOverlap,
  firstFreeGap,
  formatDuration,
  offsetToClock,
  resizeWindow,
  slideWindow,
  snapMinute,
  stepClock,
  stepToMultiple,
  stepEdge,
  stepWindow,
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

// A day starting at 14:15 puts the wall-clock half hours at offsets 15, 45, 75,
// which is the case most likely to be got wrong.
const SHIFTED_START = "14:15";

// One block, deliberately not on a half hour, because nothing obliges a stored
// block to be. 100 to 160 is 15:40 to 16:40 on the canonical day.
const OBSTACLE = [{ start_offset_minutes: 100, end_offset_minutes: 160 }];

describe("positions a dragged edge may rest on", () => {
  it("is every half hour when the day starts on one", () => {
    const positions = candidatePositions(DAY_START, DURATION, []);
    expect(positions).toHaveLength(31);
    expect(positions[0]).toBe(0);
    expect(positions.at(-1)).toBe(900);
  });

  it("phase-shifts the grid when the day does not start on a half hour", () => {
    const positions = candidatePositions(SHIFTED_START, DURATION, []);
    // 14:30 and 15:00 are reachable; 14:45 is not, and neither is offset 30.
    expect(positions).toContain(15);
    expect(positions).toContain(45);
    expect(positions).not.toContain(30);
  });

  it("keeps the day's own ends reachable even when they are off the grid", () => {
    const positions = candidatePositions(SHIFTED_START, DURATION, []);
    expect(positions).toContain(0);
    expect(positions).toContain(900);
  });

  it("adds a block's boundaries, which is what makes flush reachable", () => {
    const positions = candidatePositions(DAY_START, DURATION, OBSTACLE);
    expect(positions).toContain(100);
    expect(positions).toContain(160);
  });

  it("does not double-count a boundary that already sits on the grid", () => {
    const onGrid = [{ start_offset_minutes: 120, end_offset_minutes: 180 }];
    expect(candidatePositions(DAY_START, DURATION, onGrid)).toHaveLength(31);
  });

  it("handles unordered input", () => {
    const reversed = [
      { start_offset_minutes: 300, end_offset_minutes: 360 },
      { start_offset_minutes: 100, end_offset_minutes: 160 },
    ];
    expect(candidatePositions(DAY_START, DURATION, reversed)).toEqual(
      candidatePositions(DAY_START, DURATION, [...reversed].reverse()),
    );
  });
});

describe("sliding the window", () => {
  it("lands on a half hour in open time", () => {
    expect(slideWindow(0, 60, 45, DAY_START, DURATION, [])).toEqual({ start: 60, end: 120 });
  });

  it("keeps its length, including a length that is not a multiple of 30", () => {
    const moved = slideWindow(22, 38, 200, DAY_START, DURATION, []);
    expect(moved.end - moved.start).toBe(38);
  });

  it("parks flush against a block that is not on a half hour", () => {
    // Ends at exactly 100, where the block begins. No sliver left over.
    expect(slideWindow(0, 60, 99, DAY_START, DURATION, OBSTACLE)).toEqual({
      start: 40,
      end: 100,
    });
  });

  it("pops to the far side once past the midpoint of the two parked positions", () => {
    // Parked positions are 40 and 160, so the crossover is at 100.
    expect(slideWindow(0, 60, 101, DAY_START, DURATION, OBSTACLE).start).toBe(160);
  });

  it.each([
    ["forward", 100, 160],
    ["backward", -200, 40],
  ])("breaks the midpoint tie in the direction of travel (%s)", (_label, delta, expected) => {
    const from = delta > 0 ? 0 : 300;
    expect(slideWindow(from, 60, delta, DAY_START, DURATION, OBSTACLE).start).toBe(expected);
  });

  it("never rests on a block's own start, though that is a candidate", () => {
    // [100, 160] is a candidate start and overlaps the block for any length.
    expect(slideWindow(0, 60, 100, DAY_START, DURATION, OBSTACLE).start).not.toBe(100);
  });

  it("composes an odd length with flush parking", () => {
    // A 38 minute window parks at 62 so it ends exactly at 100. Crossover is 111.
    expect(slideWindow(22, 38, 88, DAY_START, DURATION, OBSTACLE).start).toBe(62);
    expect(slideWindow(22, 38, 90, DAY_START, DURATION, OBSTACLE).start).toBe(160);
  });

  it("skips a gap too short to hold it and stays parked", () => {
    // The only free stretches are [0,100] and a 40 minute one at [160,200].
    const crowded = [
      { start_offset_minutes: 100, end_offset_minutes: 160 },
      { start_offset_minutes: 200, end_offset_minutes: 900 },
    ];
    expect(slideWindow(0, 60, 900, DAY_START, DURATION, crowded).start).toBe(40);
  });

  it("still moves when the window fits nowhere, so the control is not dead", () => {
    // Only reachable from typed input: a magnetic drag cannot create this.
    const full = [{ start_offset_minutes: 0, end_offset_minutes: 900 }];
    expect(slideWindow(0, 60, 300, DAY_START, DURATION, full).start).toBe(300);
  });

  it("stops at the end of the day", () => {
    expect(slideWindow(840, 60, 500, DAY_START, DURATION, [])).toEqual({
      start: 840,
      end: 900,
    });
  });

  it("stops at the start of the day", () => {
    expect(slideWindow(0, 60, -500, DAY_START, DURATION, [])).toEqual({ start: 0, end: 60 });
  });
});

describe("resizing the window", () => {
  it("moves only the edge being dragged", () => {
    expect(resizeWindow("end", 0, 60, 45, DAY_START, DURATION, [])).toEqual({
      start: 0,
      end: 120,
    });
    expect(resizeWindow("start", 300, 420, -45, DAY_START, DURATION, [])).toEqual({
      start: 240,
      end: 420,
    });
  });

  it("stops flush at a block boundary that is not on a half hour", () => {
    const odd = [{ start_offset_minutes: 100, end_offset_minutes: 155 }];
    expect(resizeWindow("start", 155, 215, -100, DAY_START, DURATION, odd).start).toBe(155);
  });

  it("does not jump a block even when free space lies beyond it", () => {
    // Bodies jump; edges do not. 160 onwards is free and must stay unreachable.
    expect(resizeWindow("end", 0, 60, 500, DAY_START, DURATION, OBSTACLE).end).toBe(100);
  });

  it("stops at 30 minutes rather than collapsing or swapping", () => {
    expect(resizeWindow("end", 0, 60, -100, DAY_START, DURATION, [])).toEqual({
      start: 0,
      end: 30,
    });
    expect(resizeWindow("end", 0, 30, -100, DAY_START, DURATION, [])).toEqual({
      start: 0,
      end: 30,
    });
    expect(resizeWindow("start", 0, 30, 100, DAY_START, DURATION, [])).toEqual({
      start: 0,
      end: 30,
    });
  });

  it("reaches the very end of the day", () => {
    expect(resizeWindow("end", 840, 870, 1000, DAY_START, DURATION, []).end).toBe(900);
  });

  it("puts the 30 minute floor above the day's own edge", () => {
    // On a 14:15 day the first half hour is offset 15, so [0, 15] would be a
    // 15 minute window. It must be unreachable; [0, 45] must not be.
    expect(resizeWindow("end", 0, 45, -100, SHIFTED_START, DURATION, [])).toEqual({
      start: 0,
      end: 45,
    });
    expect(resizeWindow("end", 0, 75, -100, SHIFTED_START, DURATION, []).end).toBe(45);
  });
});

describe("stepping with the arrow keys", () => {
  it("always moves, even from a parked position", () => {
    // The reason this is not slideWindow with a 30 minute delta: parked at 40,
    // the nearest position to a small nudge is 40 itself, so the key would look
    // broken. The step out of a parked position is the pop to the far side.
    expect(stepWindow(40, 60, true, DAY_START, DURATION, OBSTACLE).start).toBe(160);
    expect(stepWindow(160, 60, false, DAY_START, DURATION, OBSTACLE).start).toBe(40);
  });

  it("moves one candidate at a time, which is a half hour in open time", () => {
    expect(stepWindow(0, 60, true, DAY_START, DURATION, []).start).toBe(30);
  });

  it("takes a block's edge when that comes before the next half hour", () => {
    // From 30, the parked position at 40 is nearer than the half hour at 60.
    expect(stepWindow(30, 60, true, DAY_START, DURATION, OBSTACLE).start).toBe(40);
  });

  it("does not move past the end of the day", () => {
    expect(stepWindow(840, 60, true, DAY_START, DURATION, [])).toEqual({
      start: 840,
      end: 900,
    });
  });

  it("steps one edge at a time and stops at a block", () => {
    expect(stepEdge("end", 0, 60, true, DAY_START, DURATION, OBSTACLE).end).toBe(90);
    expect(stepEdge("end", 0, 90, true, DAY_START, DURATION, OBSTACLE).end).toBe(100);
    expect(stepEdge("end", 0, 100, true, DAY_START, DURATION, OBSTACLE).end).toBe(100);
  });

  it("honours the 30 minute floor when stepping inward", () => {
    expect(stepEdge("end", 0, 60, false, DAY_START, DURATION, [])).toEqual({
      start: 0,
      end: 30,
    });
    expect(stepEdge("end", 0, 30, false, DAY_START, DURATION, [])).toEqual({
      start: 0,
      end: 30,
    });
  });
});

describe("resizing a window that already overlaps", () => {
  // Only reachable by typing a range into the time inputs: no gesture can create
  // it. The window straddles the block, so the block is neither entirely left of
  // it nor entirely right of it.
  const STRADDLED = { start: 120, end: 140 };

  it("refuses to drag an edge through the block it is sitting on", () => {
    expect(
      resizeWindow("end", STRADDLED.start, STRADDLED.end, 500, DAY_START, DURATION, OBSTACLE),
    ).toEqual(STRADDLED);
    expect(
      resizeWindow("start", STRADDLED.start, STRADDLED.end, -500, DAY_START, DURATION, OBSTACLE),
    ).toEqual(STRADDLED);
  });

  it("will not step an edge through it either", () => {
    expect(
      stepEdge("end", STRADDLED.start, STRADDLED.end, true, DAY_START, DURATION, OBSTACLE),
    ).toEqual(STRADDLED);
  });

  it("resolves the overlap on a body drag, which is the way out", () => {
    expect(slideWindow(120, 20, 5, DAY_START, DURATION, OBSTACLE)).toEqual({
      start: 160,
      end: 180,
    });
  });
});

describe("reading a clock time", () => {
  it.each(["00:00", "09:15", "14:30", "23:59"])("accepts %s", (value) => {
    expect(isClock(value)).toBe(true);
  });

  it.each([
    ["", "an empty field"],
    ["1", "a single digit mid-entry"],
    ["9:15", "a missing leading zero"],
    ["24:00", "an hour past the day"],
    ["12:60", "a minute past the hour"],
    ["14:30:00", "a seconds-bearing time"],
    ["half two", "prose"],
  ])("rejects %s (%s)", (value) => {
    expect(isClock(value)).toBe(false);
  });

  it("stops an unreadable range from passing as valid", () => {
    // Before the guard: parseClock("") was NaN, every comparison against NaN was
    // false, and toOffsets returned { start: NaN, end: 240 } as a good range. Add
    // block stayed enabled and the POST carried a null offset.
    const range = toOffsets("", "18:00", DAY_START, DURATION);
    expect(range).toEqual({ error: { kind: "unreadable" } });
  });
});

describe("stepping a clock time", () => {
  it("advances an hour", () => {
    expect(stepClock("14:00", 60)).toBe("15:00");
  });

  it("wraps forward past midnight, which is the reported case", () => {
    expect(stepClock("23:00", 60)).toBe("00:00");
  });

  it("wraps backward past midnight", () => {
    expect(stepClock("00:00", -60)).toBe("23:00");
  });

  it("carries from the minute segment into the hour", () => {
    expect(stepClock("15:30", 30)).toBe("16:00");
    expect(stepClock("16:00", -30)).toBe("15:30");
  });

  it("carries across midnight from the minute segment too", () => {
    expect(stepClock("23:45", 30)).toBe("00:15");
  });
});

describe("snapping a minute to a step", () => {
  it.each([
    [0, 0],
    [14, 0],
    [15, 30],
    [22, 30],
    [44, 30],
    [45, 30],
    [59, 30],
  ])("snaps %i to %i on a half-hour field", (input, expected) => {
    expect(snapMinute(input, 30)).toBe(expected);
  });

  it("never carries into the next hour", () => {
    // Rounding 59 to 60 would advance the hour under someone who typed a minute.
    expect(snapMinute(59, 30)).toBeLessThan(60);
  });

  it("leaves a free-entry field alone", () => {
    expect(snapMinute(22, 1)).toBe(22);
  });
});

describe("stepping to the next accepted minute", () => {
  it("reaches the grid on the first press from an off-grid value", () => {
    // The bug this exists to prevent: stepping by 30 from 15:45 gives 16:15,
    // 16:45, 17:15, so a field accepting only :00 and :30 never lands on a value
    // it accepts. firstFreeGap seeds exactly such a value from a block's end.
    expect(stepToMultiple("15:45", 30, true)).toBe("16:00");
    expect(stepToMultiple("15:45", 30, false)).toBe("15:30");
  });

  it("moves a whole step when already on the grid", () => {
    expect(stepToMultiple("15:00", 30, true)).toBe("15:30");
    expect(stepToMultiple("15:30", 30, true)).toBe("16:00");
    expect(stepToMultiple("15:30", 30, false)).toBe("15:00");
    expect(stepToMultiple("15:00", 30, false)).toBe("14:30");
  });

  it("wraps through midnight like every other step", () => {
    expect(stepToMultiple("23:30", 30, true)).toBe("00:00");
    expect(stepToMultiple("00:00", 30, false)).toBe("23:30");
  });

  it("falls back to single minutes on a free-entry field", () => {
    expect(stepToMultiple("15:45", 1, true)).toBe("15:46");
    expect(stepToMultiple("15:45", 1, false)).toBe("15:44");
  });
});
