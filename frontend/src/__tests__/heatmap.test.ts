import { describe, expect, it } from "vitest";
import { colorFor } from "../lib/heatmap";
import type { HeatmapCell } from "../lib/types";

function cell(partial: Partial<HeatmapCell> = {}): HeatmapCell {
  return {
    anchor_date: "2026-03-10",
    completed_total: 0,
    completed_primary: 0,
    scheduled_primary: 0,
    verdict: null,
    is_at_risk: false,
    ...partial,
  };
}

describe("heatmap view 1, task counts (T-HEAT-01, T-HEAT-02)", () => {
  it("renders no colour for a day with nothing finished", () => {
    expect(colorFor(cell({ completed_total: 0 }), "count")).toBe("transparent");
  });

  it("renders no colour for a day that does not exist", () => {
    expect(colorFor(undefined, "count")).toBe("transparent");
  });

  it("gets brighter as more is finished", () => {
    const strength = (total: number) => {
      const value = colorFor(cell({ completed_total: total }), "count");
      return Number(value.match(/(\d+(?:\.\d+)?)%/)![1]);
    };
    expect(strength(1)).toBeLessThan(strength(3));
    expect(strength(3)).toBeLessThan(strength(5));
  });

  it("saturates rather than growing without limit", () => {
    expect(colorFor(cell({ completed_total: 5 }), "count")).toBe(
      colorFor(cell({ completed_total: 50 }), "count"),
    );
  });

  it("counts non-primary completions too", () => {
    // The two views use different denominators on purpose: view 1 counts
    // everything finished, view 2 is primary-only.
    const allExtra = cell({ completed_total: 4, completed_primary: 0 });
    const allPrimary = cell({ completed_total: 4, completed_primary: 4 });
    expect(colorFor(allExtra, "count")).toBe(colorFor(allPrimary, "count"));
  });
});

describe("heatmap view 2, verdicts (T-HEAT-03)", () => {
  it("renders success green", () => {
    expect(colorFor(cell({ verdict: "success" }), "verdict")).toBe("var(--color-success)");
  });

  it("renders failure red", () => {
    expect(colorFor(cell({ verdict: "failure" }), "verdict")).toBe("var(--color-failure)");
  });

  it("leaves a neutral day uncoloured rather than marking it a failure", () => {
    // A one-primary day is not a loss. Colouring it red would punish a light day.
    expect(colorFor(cell({ verdict: "neutral" }), "verdict")).toBe("transparent");
  });

  it("leaves an unscheduled day uncoloured", () => {
    expect(colorFor(cell({ verdict: "unscheduled" }), "verdict")).toBe("transparent");
  });

  it("ignores the completion count", () => {
    const busy = cell({ verdict: "failure", completed_total: 9 });
    expect(colorFor(busy, "verdict")).toBe("var(--color-failure)");
  });
});

describe("at-risk overrides both views (T-HEAT-04)", () => {
  it("reads orange in the count view", () => {
    expect(colorFor(cell({ is_at_risk: true, completed_total: 4 }), "count")).toBe(
      "var(--color-risk-mark)",
    );
  });

  it("reads orange in the verdict view, even on a successful day", () => {
    expect(colorFor(cell({ is_at_risk: true, verdict: "success" }), "verdict")).toBe(
      "var(--color-risk-mark)",
    );
  });
});

// The grid dates moved to the server, which owns anchor-date resolution in the
// user's timezone. Their coverage lives in backend/tests/test_daytime.py.
// See docs/fixes/fix_plan_heatmap-utc-date-shift.md.
