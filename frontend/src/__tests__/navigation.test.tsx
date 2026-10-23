// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, AppRoutes } from "../App";
import type { User } from "../lib/types";

/**
 * Routing, the navigation bar, and the four unauthenticated gates.
 *
 * This is the first test in the suite to need a DOM. Everything before it
 * either tested a pure function or asserted substrings of
 * `renderToStaticMarkup` output, because the suite ran in Vitest's node
 * environment. ADR 0003 added the harness; the docblock above opts this one
 * file into it, so the 158 pre-existing cases keep running exactly where they
 * ran before.
 */

const USER: User = {
  id: "u1",
  email: "tester@example.com",
  name: "Tester",
  timezone: "Europe/London",
  day_start_time: "09:00:00",
  day_duration_minutes: 840,
  capacity_ratio: 0.75,
};

const DAY = {
  id: "d1",
  anchor_date: "2026-10-23",
  start_at: "2026-10-23T08:00:00Z",
  end_at: "2026-10-23T22:00:00Z",
  timezone: "Europe/London",
  duration_minutes: 840,
  capacity_base_minutes: 300,
  busy_minutes_subtracted: 0,
  threshold_minutes: 225,
  committed_minutes: 60,
  calendar_state: "absent",
  is_indeterminate: false,
  indeterminate_reason: null,
  is_at_risk: false,
  closed_at: null,
  verdict: null,
  calendar_synced_at: null,
  calendar_is_stale: false,
};

/** jsdom has no matchMedia. The navigation picks its form from one, so every
    test states which viewport it is describing rather than inheriting one. */
function atViewport(compact: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: compact,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

type Routes = Record<string, { status?: number; body?: unknown }>;

/** A fetch that answers by path. Anything unlisted answers 200 with an empty
    array, which is what the collection endpoints return on a quiet day. */
function stubFetch(routes: Routes = {}) {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    const match = Object.keys(routes).find((path) => url.includes(path));
    const route = match ? routes[match] : undefined;
    const status = route?.status ?? 200;
    const body = route?.body ?? [];

    if (status === 0) return Promise.reject(new TypeError("network down"));
    return Promise.resolve(
      new Response(JSON.stringify(status >= 400 ? { detail: body } : body), {
        status: status === 204 ? 204 : status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={client()}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes user={USER} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderApp() {
  return render(
    <QueryClientProvider client={client()}>
      <App />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  atViewport(false);
  stubFetch({ "/days/current": { body: DAY } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});

describe("the three routes (T-IO-07, T-IO-08, T-IO-09)", () => {
  it("sends / to Today", async () => {
    renderAt("/");
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Today" }).getAttribute("aria-current"),
      ).toBe("page"),
    );
  });

  it("renders Today at /today", async () => {
    renderAt("/today");
    // Identified by the four commitment slots, which only Today has. Matching
    // the date text would tie this to the formatter and to the day the suite
    // happens to run on, since the heading says "Today" on the anchor date.
    await waitFor(() =>
      expect(document.querySelectorAll("[data-slot]")).toHaveLength(4),
    );
  });

  it("renders History at /history", () => {
    renderAt("/history");
    expect(screen.getByRole("heading", { name: "History", level: 1 })).toBeTruthy();
  });

  it("renders Settings at /settings", () => {
    renderAt("/settings");
    expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeTruthy();
  });

  // The old router sent an unknown path to the dashboard while leaving the
  // address alone. Today is now a real path, so the address follows.
  it("sends an unknown path to Today", async () => {
    renderAt("/nonsense");
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Today" }).getAttribute("aria-current"),
      ).toBe("page"),
    );
  });
});

describe("the active section is marked (T-IO-11)", () => {
  it.each([
    ["/today", "Today"],
    ["/history", "History"],
    ["/settings", "Settings"],
  ])("marks %s", (path, label) => {
    renderAt(path);
    const nav = screen.getByRole("navigation", { name: "Sections" });
    const active = nav.querySelectorAll("[aria-current='page']");
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toBe(label);
  });
});

describe("exactly one navigation is rendered (T-IO-12)", () => {
  // Not two with one hidden by CSS. A CSS-hidden navigation is still in the
  // document, still reachable, and indistinguishable here from a visible one.
  it("puts the sections in the top bar at desktop widths", () => {
    atViewport(false);
    renderAt("/today");
    expect(screen.getAllByRole("navigation", { name: "Sections" })).toHaveLength(1);
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(nav.closest("header")).not.toBeNull();
  });

  it("moves them to a bottom bar below the breakpoint", () => {
    atViewport(true);
    renderAt("/today");
    expect(screen.getAllByRole("navigation", { name: "Sections" })).toHaveLength(1);
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(nav.closest("header")).toBeNull();
    expect(nav.className).toContain("bottom-0");
  });

  it("offers all three sections either way", () => {
    for (const compact of [false, true]) {
      cleanup();
      atViewport(compact);
      renderAt("/today");
      for (const label of ["Today", "History", "Settings"]) {
        expect(screen.getByRole("link", { name: label })).toBeTruthy();
      }
    }
  });
});

describe("no navigation before there is somewhere to navigate (T-IO-10)", () => {
  // The gate order in App.tsx is load-bearing and was documented but never
  // tested: isPaused, then isPending, then 401, then outage. `isLoading` in
  // place of `isPending` sends a pending-but-idle query into the outage branch,
  // which blames the server for the browser's connection.
  it("shows the offline state, not the outage state, when the browser is offline", async () => {
    onlineManager.setOnline(false);
    stubFetch({ "/auth/me": { status: 0 } });
    renderApp();
    await waitFor(() => expect(screen.getByText(/Offline/)).toBeTruthy());
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
  });

  it("shows sign-in on a 401, with no navigation", async () => {
    stubFetch({ "/auth/me": { status: 401, body: "unauthenticated" } });
    renderApp();
    await waitFor(() => expect(screen.getByText("Continue with Google")).toBeTruthy());
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
  });

  it("shows the outage message on a transport failure, with no navigation", async () => {
    stubFetch({ "/auth/me": { status: 0 } });
    renderApp();
    await waitFor(() => expect(screen.getByText(/Could not reach the API/)).toBeTruthy());
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
  });
});

describe("a 409 confines itself to Today (T-IO-13)", () => {
  // Previously a 409 from /days/current suppressed the whole dashboard, which
  // included the settings link that was the remedy for being outside your day.
  beforeEach(() => {
    stubFetch({ "/days/current": { status: 409, body: "outside your defined day" } });
  });

  it("explains the between-days state on Today", async () => {
    renderAt("/today");
    await waitFor(() => expect(screen.getByText(/between days/)).toBeTruthy());
  });

  it("leaves History usable", async () => {
    renderAt("/history");
    expect(screen.getByRole("heading", { name: "History", level: 1 })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Sections" })).toBeTruthy(),
    );
  });

  it("leaves Settings usable", () => {
    renderAt("/settings");
    expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeTruthy();
  });
});
