// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DayHeader } from "../components/DayHeader";
import { TaskEntry } from "../components/TaskEntry";
import { TaskRow } from "../components/TaskList";
import { Today } from "../pages/Today";
import type { LogicalDay, Task } from "../lib/types";

/** The Today screen: the commitment contract, the task rows, and the two ways
    into the day. P2 of the interface overhaul. */

function day(partial: Partial<LogicalDay> = {}): LogicalDay {
  return {
    id: "d1",
    anchor_date: "2026-10-23",
    start_at: "2026-10-23T08:00:00",
    end_at: "2026-10-23T22:00:00",
    timezone: "Europe/London",
    duration_minutes: 840,
    capacity_base_minutes: 300,
    busy_minutes_subtracted: 0,
    threshold_minutes: 330,
    committed_minutes: 195,
    calendar_state: "absent",
    is_indeterminate: false,
    indeterminate_reason: null,
    is_at_risk: false,
    closed_at: null,
    verdict: null,
    calendar_synced_at: null,
    calendar_is_stale: false,
    ...partial,
  };
}

function task(partial: Partial<Task> = {}): Task {
  return {
    id: "t1",
    logical_day_id: "d1",
    anchor_date: "2026-10-23",
    title: "Ship the timeline drag",
    notes: null,
    is_primary: true,
    preference_kind: "deep_work",
    sort_index: 0,
    estimate_minutes: 90,
    estimate_source: "model",
    estimation_status: "estimated",
    started_at: null,
    completed_at: null,
    actual_minutes: null,
    carry_forward_count: 0,
    carry_forward_demoted: false,
    is_complete: false,
    ...partial,
  };
}

let requests: Array<{ url: string; method: string }> = [];

function stubFetch(routes: Record<string, { status?: number; body?: unknown }> = {}) {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET" });
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

function mount(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  requests = [];
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function slots() {
  return Array.from(document.querySelectorAll("[data-slot]")).map((el) =>
    el.getAttribute("data-slot"),
  );
}

describe("the four slots lead the day (T-IO-14, T-IO-15)", () => {
  it.each([0, 1, 2, 3, 4])("fills one slot per primary, with %i used", (used) => {
    cleanup();
    mount(<DayHeader day={day()} primariesUsed={used} />);
    expect(slots().filter((s) => s === "filled")).toHaveLength(used);
    expect(slots()).toHaveLength(4);
  });

  // The scoring floor: fewer than two primaries leaves the day neutral and
  // unscoreable, which looks identical to a light day unless it is shown.
  it.each([0, 1])("marks the floor when only %i primary is taken", (used) => {
    cleanup();
    mount(<DayHeader day={day()} primariesUsed={used} />);
    expect(slots().filter((s) => s === "needed")).toHaveLength(2 - used);
    expect(screen.getByText(/needs 2 to score/)).toBeTruthy();
  });

  it.each([2, 3, 4])("drops the floor marker at %i primaries", (used) => {
    cleanup();
    mount(<DayHeader day={day()} primariesUsed={used} />);
    expect(slots().filter((s) => s === "needed")).toHaveLength(0);
    expect(screen.queryByText(/needs 2 to score/)).toBeNull();
  });

  it("keeps the time figures as the supporting statement", () => {
    mount(<DayHeader day={day()} primariesUsed={3} />);
    expect(screen.getByText(/3h 15m/)).toBeTruthy();
    expect(screen.getByText(/5h 30m/)).toBeTruthy();
  });
});

describe("the risk dot is the whole signal (T-IO-16, T-IO-17)", () => {
  it("appears only when the day is at risk", () => {
    mount(<DayHeader day={day({ is_at_risk: true })} primariesUsed={4} />);
    expect(screen.getByTestId("risk-dot")).toBeTruthy();
  });

  it("is absent otherwise", () => {
    mount(<DayHeader day={day({ is_at_risk: false })} primariesUsed={4} />);
    expect(screen.queryByTestId("risk-dot")).toBeNull();
  });

  it("is the only thing that happens: no modal, alert or notification anywhere", () => {
    const sources = Object.entries(
      import.meta.glob("../**/*.{ts,tsx}", {
        query: "?raw",
        import: "default",
        eager: true,
      }),
    ).filter(([path]) => !path.includes("__tests__")) as Array<[string, string]>;

    const banned = /\b(window\.alert|window\.confirm|new Notification|role="alertdialog")\b/;
    expect(sources.filter(([, body]) => banned.test(body)).map(([p]) => p)).toEqual([]);
    expect(sources.length).toBeGreaterThan(8);
  });
});

describe("row controls are reachable without a pointer (T-IO-18)", () => {
  // They used to be `opacity-0` until `group-hover`, so on touch they were not
  // merely hard to find, they were unreachable.
  it("exposes start, edit, promote and delete with no hover", () => {
    mount(<TaskRow task={task({ is_primary: false })} />);
    for (const name of [/^Start /, /^Edit /, /^Promote /, /^Delete /]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("labels the primary toggle by what it will do", () => {
    mount(<TaskRow task={task({ is_primary: true })} />);
    expect(screen.getByRole("button", { name: /^Demote / })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Promote / })).toBeNull();
  });

  it("reaches every control by keyboard", async () => {
    const user = userEvent.setup();
    mount(<TaskRow task={task()} />);
    const reachable: string[] = [];
    for (let i = 0; i < 6; i++) {
      await user.tab();
      const label = document.activeElement?.getAttribute("aria-label");
      if (label) reachable.push(label);
    }
    expect(reachable.some((l) => l.startsWith("Complete"))).toBe(true);
    expect(reachable.some((l) => l.startsWith("Start"))).toBe(true);
    expect(reachable.some((l) => l.startsWith("Delete"))).toBe(true);
  });
});

describe("starting a task (T-IO-19, T-IO-20, T-IO-21)", () => {
  it("calls the start endpoint", async () => {
    const user = userEvent.setup();
    mount(<TaskRow task={task()} />);
    await user.click(screen.getByRole("button", { name: /^Start / }));
    await waitFor(() =>
      expect(
        requests.some((r) => r.url.includes("/tasks/t1/start") && r.method === "POST"),
      ).toBe(true),
    );
  });

  it("shows elapsed time instead of the estimate once running", () => {
    const startedAt = new Date(Date.now() - 25 * 60_000).toISOString();
    mount(<TaskRow task={task({ started_at: startedAt })} />);
    expect(screen.getByText(/25m in/)).toBeTruthy();
    expect(screen.queryByText("1h 30m")).toBeNull();
  });

  it("offers no start control on a task already running", () => {
    mount(<TaskRow task={task({ started_at: new Date().toISOString() })} />);
    expect(screen.queryByRole("button", { name: /^Start / })).toBeNull();
  });

  // There is no un-start endpoint, so restricting this would trap a mis-start.
  it("lets more than one task run at once", () => {
    const startedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    mount(
      <ul>
        <TaskRow task={task({ id: "a", title: "First", started_at: startedAt })} />
        <TaskRow task={task({ id: "b", title: "Second", started_at: startedAt })} />
      </ul>,
    );
    expect(document.querySelectorAll("[data-running]")).toHaveLength(2);
  });
});

describe("the two entry paths are one surface (T-IO-25)", () => {
  it("offers both without hover, and says how they differ", () => {
    mount(<TaskEntry primariesUsed={1} />);
    expect(screen.getByRole("button", { name: /Add a task/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ask Doer/ })).toBeTruthy();
    expect(screen.getByText("Added straight away")).toBeTruthy();
    expect(screen.getByText("Proposes, you confirm")).toBeTruthy();
  });

  it("opens the direct form", async () => {
    const user = userEvent.setup();
    mount(<TaskEntry primariesUsed={1} />);
    await user.click(screen.getByRole("button", { name: /Add a task/ }));
    expect(screen.getByLabelText("Task title")).toBeTruthy();
  });

  it("opens the assistant, which promises to commit nothing", async () => {
    const user = userEvent.setup();
    mount(<TaskEntry primariesUsed={1} />);
    await user.click(screen.getByRole("button", { name: /Ask Doer/ }));
    expect(screen.getByLabelText("Message to Doer")).toBeTruthy();
    expect(screen.getByText(/nothing is added until you confirm/i)).toBeTruthy();
  });
});

describe("the four-primary remedy stays reachable (T-IO-22)", () => {
  /** Open the direct form with every slot taken and insist on a fifth primary,
      which is the only way to reach the refusal: the form defaults to
      non-primary when the four are gone, so it does not walk you into a wall. */
  async function insistOnAFifthPrimary(user: ReturnType<typeof userEvent.setup>) {
    mount(<TaskEntry primariesUsed={4} />);
    await user.click(screen.getByRole("button", { name: /Add a task/ }));
    await user.type(screen.getByLabelText("Task title"), "A fifth thing");
    const box = screen.getByRole("checkbox");
    expect(box.hasAttribute("disabled")).toBe(false);
    await user.click(box);
    return box;
  }

  // The calibrating defect: disabling the checkbox while it was checked made
  // the remedy the error message suggests physically unreachable. The checkbox
  // is asserted enabled both before and after it is ticked.
  it("never disables the control that enacts the remedy", async () => {
    const user = userEvent.setup();
    const box = await insistOnAFifthPrimary(user);
    expect(box.hasAttribute("disabled")).toBe(false);

    const escape = screen.getByRole("button", { name: "Add as an extra" });
    expect(escape.hasAttribute("disabled")).toBe(false);

    await user.click(escape);
    await waitFor(() =>
      expect(requests.some((r) => r.url.endsWith("/tasks") && r.method === "POST")).toBe(
        true,
      ),
    );
  });

  it("explains why the fifth was refused, and offers a way on", async () => {
    const user = userEvent.setup();
    await insistOnAFifthPrimary(user);
    expect(screen.getByText(/Today’s four are taken/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(true);
  });

  it("defaults to an extra rather than to a refusal when the four are gone", async () => {
    const user = userEvent.setup();
    mount(<TaskEntry primariesUsed={4} />);
    await user.click(screen.getByRole("button", { name: /Add a task/ }));
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText(/Today’s four are taken/)).toBeNull();
  });
});

describe("Today as a whole (T-IO-23)", () => {
  it("names the demoted tasks when carry-forward pushes them out", async () => {
    stubFetch({
      "/days/current": { body: day() },
      "/tasks": {
        body: [
          task({ id: "a", title: "Carried over", is_primary: true }),
          task({
            id: "b",
            title: "Planned yesterday",
            is_primary: false,
            carry_forward_demoted: true,
          }),
        ],
      },
    });
    mount(<Today />);
    // The title appears twice by design: once in the notice and once in the
    // list. The notice is the assertion; the row is incidental.
    await waitFor(() => expect(screen.getAllByText("Planned yesterday").length).toBe(2));
    const notice = screen.getByText(/moved out/);
    expect(within(notice).getByText("Planned yesterday")).toBeTruthy();
  });

  it("shows the empty state without mentioning a control that no longer exists", async () => {
    stubFetch({ "/days/current": { body: day() }, "/tasks": { body: [] } });
    mount(<Today />);
    await waitFor(() => expect(screen.getByText(/Nothing planned yet/)).toBeTruthy());
    expect(screen.queryByText(/plus button/)).toBeNull();
  });
});
