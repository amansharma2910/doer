import { describe, expect, it } from "vitest";
import { formatRate, summarize } from "../lib/stats";
import type { HeatmapCell, HeatmapGrid, Verdict } from "../lib/types";

/** Pure, so the three definitions are pinned without a DOM or a server. */

function cell(anchor: string, verdict: Verdict | null, extra: Partial<HeatmapCell> = {}): HeatmapCell {
  return {
    anchor_date: anchor,
    completed_total: 0,
    completed_primary: 0,
    scheduled_primary: 0,
    verdict,
    is_at_risk: false,
    ...extra,
  };
}

/** Ascending days, as the server sends them, with verdicts applied in order. */
function grid(verdicts: Array<Verdict | null>): HeatmapGrid {
  const days = verdicts.map((_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
  return {
    days,
    cells: verdicts.flatMap((v, i) => (v === null ? [] : [cell(days[i], v)])),
  };
}

describe("streak: only a failure breaks it (T-IO-33, T-IO-34, T-IO-35)", () => {
  it("counts consecutive kept days back from the most recent", () => {
    expect(summarize(grid(["success", "success", "success"])).streak).toBe(3);
  });

  it("resets to zero on a day that was not kept", () => {
    expect(summarize(grid(["success", "success", "failure"])).streak).toBe(0);
  });

  it("stops counting at the most recent failure, not before it", () => {
    expect(summarize(grid(["success", "failure", "success", "success"])).streak).toBe(2);
  });

  // The user's choice on 2026-10-23, over two stricter readings: a deliberate
  // rest day should not cost a streak.
  it.each<Verdict | null>(["neutral", "unscheduled", null])(
    "skips a %s day rather than breaking on it",
    (middle) => {
      expect(summarize(grid(["success", middle, "success"])).streak).toBe(2);
    },
  );

  it("is zero when nothing has ever scored", () => {
    expect(summarize(grid(["neutral", "unscheduled", null])).streak).toBe(0);
    expect(summarize(grid([])).streak).toBe(0);
    expect(summarize(undefined).streak).toBe(0);
  });

  // The route the choice above leaves open, asserted so it is a known property
  // rather than a surprise. Plan §12.2 records it as accepted.
  it("is kept alive by a run of unscoreable days, which is the accepted risk", () => {
    expect(summarize(grid(["success", "neutral", "neutral", "neutral"])).streak).toBe(1);
  });
});

describe("rolling rate counts only scored days (T-IO-36)", () => {
  it("divides kept by scored, not by elapsed", () => {
    const summary = summarize(grid(["success", "failure", "neutral", "success"]));
    expect(summary.rollingScored).toBe(3);
    expect(summary.rollingRate).toBeCloseTo(2 / 3);
  });

  it("is null rather than zero when nothing in the window scored", () => {
    const summary = summarize(grid(["neutral", "unscheduled", null]));
    expect(summary.rollingRate).toBeNull();
    expect(formatRate(summary.rollingRate)).toBe("-");
  });

  it("looks at the last seven days only", () => {
    // Ten days: nine failures then one success. A window of seven sees six
    // failures and the success.
    const verdicts: Verdict[] = [
      ...Array<Verdict>(9).fill("failure"),
      "success",
    ];
    const summary = summarize(grid(verdicts));
    expect(summary.rollingScored).toBe(7);
    expect(summary.rollingRate).toBeCloseTo(1 / 7);
  });

  it("reports the whole window separately from the rolling one", () => {
    const summary = summarize(grid(["success", "success", "failure", "neutral"]));
    expect(summary.kept).toBe(2);
    expect(summary.scored).toBe(3);
  });
});

describe("the window holds elapsed days, not padded ones (D1)", () => {
  /**
   * The server pads the grid forward to the Saturday on or after today, so the
   * last rows of `days` are dates that have not happened. Slicing the raw grid
   * meant the rolling window held one real day on a Sunday and seven only on a
   * Saturday, and the figure read "-" after a full week of recorded history.
   * Found by doc-crawler; no test modelled padding before this one.
   */
  function paddedGrid(): HeatmapGrid {
    const days: string[] = [];
    for (let d = 15; d <= 24; d++) days.push(`2026-10-${d}`);
    return {
      days,
      // Seven real, scored, kept days: the 15th to the 21st.
      cells: days
        .slice(0, 7)
        .map((anchor) => cell(anchor, "success", { completed_total: 3 })),
    };
  }

  it("ignores dates after today when taking the window", () => {
    // Today is the 21st; the 22nd to the 24th are padding.
    const summary = summarize(paddedGrid(), "2026-10-21");
    expect(summary.rollingScored).toBe(7);
    expect(summary.rollingRate).toBe(1);
  });

  it("without the clamp the same grid would report a single scored day", () => {
    // Pretending today is the 15th leaves one elapsed day, which is what the
    // unclamped version produced on a Sunday.
    expect(summarize(paddedGrid(), "2026-10-15").rollingScored).toBe(1);
  });

  it("keeps the whole-window totals free of padding too", () => {
    const summary = summarize(paddedGrid(), "2026-10-21");
    expect(summary.kept).toBe(7);
    expect(summary.scored).toBe(7);
  });

  it("is stable across every day of the week", () => {
    for (let d = 15; d <= 21; d++) {
      const summary = summarize(paddedGrid(), `2026-10-${d}`);
      expect(summary.rollingRate).toBe(1);
    }
  });
});

describe("formatting a rate", () => {
  it("rounds to whole percent", () => {
    expect(formatRate(2 / 3)).toBe("67%");
    expect(formatRate(1)).toBe("100%");
    expect(formatRate(0)).toBe("0%");
  });
});
