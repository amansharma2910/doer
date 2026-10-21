import { QueryClient, QueryObserver, notifyManager } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { isAwaitingEstimate, keys, signOutTeardown } from "../lib/hooks";
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

describe("sign-out teardown", () => {
  /** Subscribed the way useBaseQuery subscribes: optimistic results, batched
      notifications. Without that the observer behaves differently from the one
      React actually mounts, and the bug this covers hides. */
  function mountedObserver(client: QueryClient, queryFn: () => Promise<unknown>) {
    const observer = new QueryObserver(client, {
      queryKey: keys.me,
      queryFn,
      retry: false,
      _optimisticResults: "optimistic",
    });
    const unsubscribe = observer.subscribe(notifyManager.batchCalls(() => {}));
    return { observer, unsubscribe };
  }

  it("leaves a signed-out observer off its stale success", async () => {
    const client = new QueryClient();
    let signedIn = true;
    const queryFn = async () => {
      if (!signedIn) throw new Error("401");
      return { email: "someone@example.com" };
    };

    const { observer, unsubscribe } = mountedObserver(client, queryFn);
    await observer.refetch();
    expect(observer.getCurrentResult().data).toEqual({ email: "someone@example.com" });

    // The server has destroyed the session; the next read must not succeed.
    signedIn = false;
    await signOutTeardown(client);

    const result = observer.getCurrentResult();
    expect(
      result.status === "success" && result.data !== undefined,
      "the observer is still reporting the signed-out user, so the page stays frozen",
    ).toBe(false);
    unsubscribe();
  });

  it("leaves no other account data behind", async () => {
    const client = new QueryClient();
    client.setQueryData(keys.tasks, [{ title: "the previous account's task" }]);

    await signOutTeardown(client);

    expect(client.getQueryData(keys.tasks)).toBeUndefined();
  });
});
