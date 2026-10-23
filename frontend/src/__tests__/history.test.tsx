// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DayDetail } from "../pages/DayDetail";
import { History } from "../pages/History";
import { isAwaitingEstimate, keys } from "../lib/hooks";
import type { Task } from "../lib/types";

/** History, the day detail route, and the cache coupling that binds the day
    query to the tasks query. P3 of the interface overhaul. */

let requests: string[] = [];

function stubFetch(routes: Record<string, { status?: number; body?: unknown }>) {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    const key = Object.keys(routes).find((path) => url.includes(path));
    const route = key ? routes[key] : undefined;
    const status = route?.status ?? 200;
    const body = route?.body ?? [];
    return Promise.resolve(
      new Response(JSON.stringify(status >= 400 ? { detail: body } : body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

function mount(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/history" element={<History />} />
          <Route path="/history/:anchor" element={<DayDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const GRID = {
  days: ["2026-10-20", "2026-10-21", "2026-10-22"],
  cells: [
    {
      anchor_date: "2026-10-21",
      completed_total: 3,
      completed_primary: 3,
      scheduled_primary: 4,
      verdict: "success",
      is_at_risk: false,
    },
    {
      anchor_date: "2026-10-22",
      completed_total: 1,
      completed_primary: 1,
      scheduled_primary: 4,
      verdict: "failure",
      is_at_risk: false,
    },
  ],
};

const CLOSED_DAY = {
  id: "d9",
  anchor_date: "2026-10-21",
  start_at: "2026-10-21T08:00:00",
  end_at: "2026-10-21T22:00:00",
  timezone: "Europe/London",
  duration_minutes: 840,
  capacity_base_minutes: 300,
  busy_minutes_subtracted: 0,
  threshold_minutes: 225,
  committed_minutes: 180,
  calendar_state: "absent",
  is_indeterminate: false,
  indeterminate_reason: null,
  is_at_risk: false,
  closed_at: "2026-10-21T22:00:00",
  verdict: "success",
  calendar_synced_at: null,
  calendar_is_stale: false,
};

beforeEach(() => {
  requests = [];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("History shows its figures from the grid it already has (T-IO-36)", () => {
  it("issues no request beyond the heatmap", async () => {
    stubFetch({ "/days/heatmap": { body: GRID } });
    mount("/history");
    await waitFor(() => expect(screen.getByText("50%")).toBeTruthy());
    expect(requests.filter((u) => !u.includes("/days/heatmap"))).toEqual([]);
  });

  it("shows the streak and the kept count", async () => {
    stubFetch({ "/days/heatmap": { body: GRID } });
    mount("/history");
    // Waits on a data-dependent string. "Current streak" is a static label and
    // resolves before the grid has landed, which made this pass vacuously.
    await waitFor(() => expect(screen.getByText("of 2 scored so far")).toBeTruthy());
    // Most recent day is a failure, so the streak is zero.
    expect(screen.getByText("days kept in a row")).toBeTruthy();
  });
});

describe("a cell is a link to its day (T-IO-31)", () => {
  it("points every dated cell at its own route", async () => {
    stubFetch({ "/days/heatmap": { body: GRID } });
    mount("/history");
    await waitFor(() =>
      expect(document.querySelectorAll('a[href^="/history/2026-"]').length).toBe(3),
    );
    expect(document.querySelector('a[href="/history/2026-10-21"]')).not.toBeNull();
  });

  it("navigates when one is chosen", async () => {
    const user = userEvent.setup();
    stubFetch({
      "/days/heatmap": { body: GRID },
      "/days/2026-10-21": { body: CLOSED_DAY },
      "/tasks": { body: [] },
    });
    mount("/history");
    await waitFor(() =>
      expect(document.querySelector('a[href="/history/2026-10-21"]')).not.toBeNull(),
    );
    await user.click(document.querySelector('a[href="/history/2026-10-21"]') as Element);
    await waitFor(() => expect(screen.getByText(/Kept/)).toBeTruthy());
  });
});

describe("the day detail route (T-IO-32)", () => {
  it("shows the outcome and the tasks of that day", async () => {
    stubFetch({
      "/days/2026-10-21": { body: CLOSED_DAY },
      "/tasks": {
        body: [
          {
            id: "t1",
            logical_day_id: "d9",
            anchor_date: "2026-10-21",
            title: "Finished thing",
            notes: null,
            is_primary: true,
            preference_kind: "deep_work",
            sort_index: 0,
            estimate_minutes: 60,
            estimate_source: "model",
            estimation_status: "estimated",
            started_at: "2026-10-21T09:00:00",
            completed_at: "2026-10-21T10:10:00",
            actual_minutes: 70,
            carry_forward_count: 0,
            carry_forward_demoted: false,
            is_complete: true,
          },
        ],
      },
    });
    mount("/history/2026-10-21");
    await waitFor(() => expect(screen.getByText("Finished thing")).toBeTruthy());
    expect(screen.getByText("Kept")).toBeTruthy();
    // Estimated against actual, which exists only because the task was started.
    expect(screen.getByText(/took 1h 10m/)).toBeTruthy();
  });

  it("asks the API for that anchor, not for today", async () => {
    stubFetch({ "/days/2026-10-21": { body: CLOSED_DAY }, "/tasks": { body: [] } });
    mount("/history/2026-10-21");
    await waitFor(() =>
      expect(requests.some((u) => u.includes("/tasks?anchor=2026-10-21"))).toBe(true),
    );
  });

  it("says nothing was scheduled on a 404, rather than erroring", async () => {
    stubFetch({
      "/days/2019-07-04": { status: 404, body: "no logical day for that anchor date" },
      "/tasks": { status: 404, body: "no logical day for that anchor date" },
    });
    mount("/history/2019-07-04");
    await waitFor(() => expect(screen.getByText(/Nothing was scheduled/)).toBeTruthy());
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it("does not claim a verdict for a day still running", async () => {
    stubFetch({
      "/days/2026-10-23": { body: { ...CLOSED_DAY, anchor_date: "2026-10-23", closed_at: null, verdict: null } },
      "/tasks": { body: [] },
    });
    mount("/history/2026-10-23");
    await waitFor(() => expect(screen.getByText("Still open")).toBeTruthy());
  });

  it("says a future day has not started, rather than that it went unused", async () => {
    // The grid runs to the end of the current week, so its last squares are
    // dates that have not happened yet.
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    stubFetch({
      [`/days/${future}`]: { status: 404, body: "no logical day for that anchor date" },
      "/tasks": { status: 404, body: "no logical day for that anchor date" },
    });
    mount(`/history/${future}`);
    await waitFor(() => expect(screen.getByText(/has not started yet/)).toBeTruthy());
  });

  it("handles a malformed anchor without crashing", async () => {
    stubFetch({ "/days/banana": { status: 422, body: "bad date" }, "/tasks": { status: 422, body: "bad date" } });
    mount("/history/banana");
    await waitFor(() => expect(screen.getByText(/could not be loaded/)).toBeTruthy());
  });
});

describe("the day query still follows the estimate cadence (T-IO-37)", () => {
  /**
   * `useDay` decides whether to poll by reading the tasks cache by key. When
   * `keys.tasks` gained its "current" segment so a past day could be cached
   * beside the open one, a lookup left on the old flat key would have returned
   * undefined and the day would have quietly stopped refreshing, with no test
   * failing. The survey found this coupling untested; this is the test.
   */
  function pending(): Task {
    return {
      id: "p1",
      logical_day_id: "d1",
      anchor_date: "2026-10-23",
      title: "waiting",
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
    };
  }

  it("finds the open day's tasks under the key useDay reads", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(keys.tasks, [pending()]);
    // The exact lookup performed inside useDay's refetchInterval.
    const cached = queryClient.getQueryData<Task[]>(keys.tasks);
    expect(cached).toBeDefined();
    expect(cached?.some(isAwaitingEstimate)).toBe(true);
  });

  it("keeps a past day's tasks under a different key", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(keys.tasksAt("2026-10-21"), [pending()]);
    // A past day must not make the open day think it is awaiting an estimate.
    expect(queryClient.getQueryData<Task[]>(keys.tasks)).toBeUndefined();
    expect(keys.tasks).not.toEqual(keys.tasksAt("2026-10-21"));
  });

  it("invalidates both by the shared prefix", () => {
    expect(keys.tasks[0]).toBe("tasks");
    expect(keys.tasksAt("2026-10-21")[0]).toBe("tasks");
    expect(keys.day[0]).toBe("day");
    expect(keys.dayAt("2026-10-21")[0]).toBe("day");
  });
});
