import { describe, expect, it } from "vitest";
import { isAwaitingEstimate } from "../lib/hooks";
import type { Task } from "../lib/types";

function task(partial: Partial<Task> = {}): Task {
  return {
    id: "t1",
    logical_day_id: "d1",
    anchor_date: "2026-03-10",
    title: "Test",
    notes: null,
    is_primary: true,
    preference_kind: "deep_work",
    sort_index: 0,
    estimate_minutes: null,
    estimate_source: null,
    estimation_status: "pending",
    started_at: null,
    completed_at: null,
    actual_minutes: null,
    carry_forward_count: 0,
    carry_forward_demoted: false,
    is_complete: false,
    ...partial,
  };
}

describe("deciding when to keep polling for an estimate", () => {
  it("waits on a freshly created task", () => {
    expect(isAwaitingEstimate(task())).toBe(true);
  });

  it("stops once the estimate lands", () => {
    expect(
      isAwaitingEstimate(task({ estimate_minutes: 45, estimation_status: "estimated" })),
    ).toBe(false);
  });

  it("stops once estimation has given up", () => {
    // Otherwise a permanently failed estimate would poll forever.
    expect(isAwaitingEstimate(task({ estimation_status: "failed" }))).toBe(false);
  });

  it("stops for a manually entered estimate", () => {
    expect(
      isAwaitingEstimate(task({ estimate_minutes: 30, estimate_source: "user" })),
    ).toBe(false);
  });

  it("is true for any one task in a list, false for none", () => {
    const settled = [task({ estimate_minutes: 45, estimation_status: "estimated" })];
    const mixed = [...settled, task()];
    expect(settled.some(isAwaitingEstimate)).toBe(false);
    expect(mixed.some(isAwaitingEstimate)).toBe(true);
  });
});
