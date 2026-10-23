import { describe, expect, it } from "vitest";
import { formatAnchorDate, localAnchorToday } from "../lib/daytime";

/**
 * In its own file rather than appended to daytime.test.ts, so that file stays
 * byte-identical and the untouched-case floor in AC-IO-01 keeps meaning what
 * it says.
 */
describe("an anchor date reads as a day, not a database value", () => {
  it("names the weekday and the month", () => {
    const text = formatAnchorDate("2026-10-23");
    expect(text).toMatch(/Friday/);
    expect(text).toMatch(/October/);
    expect(text).toMatch(/23/);
  });

  it("says so when the anchor is the current local date", () => {
    expect(formatAnchorDate("2026-10-23", "2026-10-23")).toMatch(/^Today, /);
  });

  it("does not say so for any other date", () => {
    expect(formatAnchorDate("2026-10-22", "2026-10-23")).not.toMatch(/^Today, /);
  });

  // The repository has shipped this defect once already, in the heatmap:
  // `new Date("2026-10-23")` is UTC midnight, which west of Greenwich renders
  // as the 22nd. See fix_plan_heatmap-utc-date-shift.md.
  it("keeps the calendar day it was given, whatever the offset", () => {
    for (const anchor of ["2026-01-01", "2026-06-15", "2026-10-23", "2026-12-31"]) {
      const day = Number(anchor.split("-")[2]);
      expect(formatAnchorDate(anchor)).toContain(String(day));
    }
  });

  it("returns the input unchanged rather than inventing a date", () => {
    for (const bad of ["", "banana", "2026-10", "not-a-date"]) {
      expect(formatAnchorDate(bad)).toBe(bad);
    }
  });

  // Found by doc-crawler. `Number("")` is 0 rather than NaN, and
  // `new Date(2026, 12, 45)` rolls over to the following February rather than
  // failing, so "/history/2026-13-45" rendered a confident "Sunday, February
  // 14" above an error message.
  it.each([
    "--",
    "  -  - ",
    "2026-13-45",
    "2026-02-30",
    "23-10-2026",
    "2026-10-00",
    "0099-01-01x",
    "2026-1-1",
  ])("refuses to invent a date from %o", (bad) => {
    expect(formatAnchorDate(bad)).toBe(bad);
  });

  it("still accepts every real date, including leap days", () => {
    expect(formatAnchorDate("2024-02-29")).toMatch(/February/);
    expect(formatAnchorDate("2026-12-31")).toMatch(/December/);
    expect(formatAnchorDate("2026-01-01")).toMatch(/January/);
  });

  it("builds today's anchor from local parts, not from an ISO string", () => {
    // 23:30 local on the 23rd is already the 24th in UTC. toISOString() here
    // would report tomorrow and silently stop matching the open day.
    expect(localAnchorToday(new Date(2026, 9, 23, 23, 30))).toBe("2026-10-23");
    expect(localAnchorToday(new Date(2026, 0, 5, 0, 15))).toBe("2026-01-05");
  });
});
