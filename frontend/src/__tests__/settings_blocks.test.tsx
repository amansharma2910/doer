// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "../pages/Settings";
import type { PreferenceBlock, User } from "../lib/types";

/**
 * Preference block edits, and what the interface does afterwards.
 *
 * Regression cover for `docs/fixes/fix_plan_block-edits-leave-stale-ui.md`. The
 * reported symptom was a delete that committed on the server while the row
 * stayed on screen, with nothing saying why.
 */

const USER: User = {
  id: "u1",
  email: "tester@example.com",
  name: "Tester",
  timezone: "Europe/London",
  // 13:00 for fifteen hours, the shape the defect was reported on.
  day_start_time: "13:00:00",
  day_duration_minutes: 900,
  capacity_ratio: 0.5,
};

/** Offsets chosen so 0 to 120 (13:00 to 15:00) is the first free stretch once
    the first block is removed, which is what made a good delete look bad. */
const BLOCKS: PreferenceBlock[] = [
  { id: "b0", kind: "personal_project", start_offset_minutes: 0, end_offset_minutes: 120, is_focus: true },
  { id: "b1", kind: "deep_work", start_offset_minutes: 240, end_offset_minutes: 360, is_focus: true },
  { id: "b2", kind: "deep_work", start_offset_minutes: 420, end_offset_minutes: 540, is_focus: true },
];

let requests: Array<{ url: string; method: string }> = [];
let deleteStatus = 204;
let stored: PreferenceBlock[] = [];

/** Stateful, because the point of these tests is what the *refetched* list
    does. A stub that returns the same array after a mutation cannot tell a
    working invalidation from a broken one. */
function stubFetch() {
  stored = BLOCKS.map((b) => ({ ...b }));
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ url, method });

    if (method === "DELETE") {
      if (deleteStatus >= 400) {
        return Promise.resolve(
          new Response(JSON.stringify({ detail: "could not remove that block" }), {
            status: deleteStatus,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      const id = url.split("/").pop();
      stored = stored.filter((b) => b.id !== id);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const created: PreferenceBlock = {
        id: `new-${stored.length}`,
        kind: body.kind,
        start_offset_minutes: body.start_offset_minutes,
        end_offset_minutes: body.end_offset_minutes,
        is_focus: true,
      };
      stored = [...stored, created].sort(
        (a, b) => a.start_offset_minutes - b.start_offset_minutes,
      );
      return Promise.resolve(
        new Response(JSON.stringify(created), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(url.includes("/settings/blocks") ? stored : []), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

function mount() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidated: unknown[][] = [];
  const original = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = ((filters?: { queryKey?: unknown[] }) => {
    if (filters?.queryKey) invalidated.push(filters.queryKey);
    return original(filters as never);
  }) as typeof queryClient.invalidateQueries;

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Settings user={USER} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return invalidated;
}

/** The two clock fields the suggestion effect writes into, and only those.
    A bare spinbutton query also catches the day-shape "Starts" field. */
function window_() {
  const read = (label: string) =>
    document.querySelector(`[aria-label="${label}, 24 hour clock"]`)?.textContent ?? "";
  return `${read("Block start")} to ${read("Block end")}`;
}

beforeEach(() => {
  requests = [];
  deleteStatus = 204;
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("removing a block", () => {
  async function removeFirst(user: ReturnType<typeof userEvent.setup>) {
    const invalidated = mount();
    await waitFor(() => expect(screen.getByText("Personal project")).toBeTruthy());
    const removes = screen.getAllByRole("button", { name: "Remove" });
    await user.click(removes[0]);
    return invalidated;
  }

  it("issues the delete (T-FIX-01)", async () => {
    const user = userEvent.setup();
    await removeFirst(user);
    await waitFor(() =>
      expect(
        requests.some((r) => r.method === "DELETE" && r.url.includes("/settings/blocks/b0")),
      ).toBe(true),
    );
  });

  it("refreshes blocks, the day and the heatmap on success (T-FIX-02)", async () => {
    const user = userEvent.setup();
    const invalidated = await removeFirst(user);
    await waitFor(() => expect(invalidated.length).toBeGreaterThanOrEqual(3));
    expect(invalidated).toContainEqual(["blocks"]);
    expect(invalidated).toContainEqual(["day"]);
    expect(invalidated).toContainEqual(["heatmap"]);
  });

  /**
   * The reported incident. The delete committed server-side while the browser
   * saw a transport failure, so an `onSuccess` invalidation never ran and the
   * row stayed on screen. `onSettled` reconciles either way.
   */
  it("refreshes even when the request fails (T-FIX-03)", async () => {
    deleteStatus = 503;
    const user = userEvent.setup();
    const invalidated = await removeFirst(user);
    await waitFor(() => expect(invalidated).toContainEqual(["blocks"]));
    expect(invalidated).toContainEqual(["day"]);
  });

  it("says so when it fails, rather than appearing to do nothing (T-FIX-04)", async () => {
    deleteStatus = 503;
    const user = userEvent.setup();
    await removeFirst(user);
    await waitFor(() =>
      expect(screen.getByText(/could not be removed/)).toBeTruthy(),
    );
  });

  /**
   * `firstFreeGap` returns the slot the delete just freed, so the dashed window
   * used to reappear exactly where the block had been, still labelled with its
   * kind. A good delete was pixel-identical to a failed one.
   */
  it("leaves the window where it was, not in the freed slot (T-FIX-05)", async () => {
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(screen.getByText("Personal project")).toBeTruthy());
    // Let the suggestion effect settle on the first free stretch before the
    // delete, so the assertion is about movement rather than about seeding.
    await waitFor(() => expect(window_()).not.toBe(" to "));
    const before = window_();

    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    await waitFor(() =>
      expect(screen.queryByText("Personal project")).toBeNull(),
    );
    // 0 to 120 is now free and is the first free stretch, so the unfixed
    // version moved the window to exactly where the deleted block had been.
    expect(window_()).toBe(before);
  });
});

describe("adding a block", () => {
  it("still moves the window on to the next free stretch (T-FIX-06)", async () => {
    // The behaviour the suggestion effect exists for, and which the delete fix
    // must not take away.
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(screen.getByText("Personal project")).toBeTruthy());
    await waitFor(() => expect(window_()).not.toBe(" to "));
    const before = window_();
    await user.click(screen.getByRole("button", { name: "Add block" }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    await waitFor(() => expect(window_()).not.toBe(before));
  });

  it("refreshes blocks, the day and the heatmap (T-FIX-07)", async () => {
    const user = userEvent.setup();
    const invalidated = mount();
    await waitFor(() => expect(screen.getByText("Personal project")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Add block" }));
    await waitFor(() => expect(invalidated).toContainEqual(["day"]));
    expect(invalidated).toContainEqual(["blocks"]);
    expect(invalidated).toContainEqual(["heatmap"]);
  });
});
