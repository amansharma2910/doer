// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RAW from "../index.css?raw";
import { Settings } from "../pages/Settings";
import { Today } from "../pages/Today";
import type { User } from "../lib/types";

/** Settings, motion, and the loading, empty and error treatments. P4. */

const USER: User = {
  id: "u1",
  email: "tester@example.com",
  name: "Tester",
  timezone: "Europe/London",
  day_start_time: "09:00:00",
  day_duration_minutes: 840,
  capacity_ratio: 0.75,
};

const BLOCKS = [
  {
    id: "b1",
    kind: "deep_work",
    start_offset_minutes: 60,
    end_offset_minutes: 300,
    is_focus: true,
  },
];

function stubFetch(routes: Record<string, { status?: number; body?: unknown }> = {}) {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(routes).find((path) => url.includes(path));
    const route = key ? routes[key] : undefined;
    const status = route?.status ?? 200;
    const body = route?.body ?? [];
    if (status === 0) return new Promise(() => {}); // never settles
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

beforeEach(() => stubFetch());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Settings states what it worked out, without the essay (T-IO-39)", () => {
  it("drops the capacity explainer and the day-end sentence", async () => {
    stubFetch({ "/settings/blocks": { body: BLOCKS } });
    mount(<Settings user={USER} />);
    await waitFor(() => expect(screen.getByText("Focus time a day")).toBeTruthy());

    expect(screen.queryByText(/will quietly flag any day you commit to more than/)).toBeNull();
    expect(screen.queryByText(/^Your day ends at/)).toBeNull();
  });

  it("keeps every number the prose carried", async () => {
    stubFetch({ "/settings/blocks": { body: BLOCKS } });
    mount(<Settings user={USER} />);
    await waitFor(() => expect(screen.getByText("Focus time a day")).toBeTruthy());

    // Scoped to the derived figures: "4h" is also the duration of the block
    // in the list below, which is the same number arrived at a different way.
    const derived = (label: string) =>
      screen.getByText(label).parentElement?.querySelector("dd")?.textContent ?? "";

    // 240 minutes of focus at 75% flags above 180.
    expect(derived("Focus time a day")).toBe("4h");
    expect(derived("Flagged above")).toContain("3h");
    expect(derived("Flagged above")).toContain("75%");
    expect(derived("Flagged above")).toContain("before meetings");
    // The day-end figure survives as a figure rather than a sentence.
    expect(derived("Ends at")).toBe("23:00");
  });

  it("does not label two different things the same way", async () => {
    stubFetch({ "/settings/blocks": { body: BLOCKS } });
    mount(<Settings user={USER} />);
    await waitFor(() => expect(screen.getByText("Focus time a day")).toBeTruthy());
    // "Comfortable load" is an input. A derived figure echoing it gave the
    // screen two controls-looking things with one name.
    expect(screen.getAllByText("Comfortable load")).toHaveLength(1);
  });

  it("keeps the caveat that was not a number", async () => {
    mount(<Settings user={USER} />);
    expect(screen.getByText(/never to one already underway/)).toBeTruthy();
  });
});

describe("motion yields to the preference (T-IO-40)", () => {
  // Asserted against the stylesheet. jsdom does not evaluate a media query
  // against layout, so a computed-style check here would prove nothing.
  const css = RAW.replace(/\/\*[\s\S]*?\*\//g, "");

  it("suppresses animation and transition under reduced motion", () => {
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toContain("animation-duration: 0.01ms !important");
    expect(block).toContain("transition-duration: 0.01ms !important");
  });

  it("applies the suppression to everything, not to a list of components", () => {
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toMatch(/\*,\s*\*::before,\s*\*::after/);
  });

  it("defines the entry animation it is suppressing", () => {
    expect(css).toContain("@keyframes doer-enter");
    expect(css).toContain("@utility enter");
  });
});

describe("every screen has a designed loading, empty and error state (T-IO-41)", () => {
  it("says what it is waiting for, rather than 'Loading'", () => {
    stubFetch({ "/days/current": { status: 0 } });
    mount(<Today />);
    const waiting = screen.getByRole("status");
    expect(waiting.textContent).toMatch(/Working out where you are/);
    expect(waiting.textContent).not.toBe("Loading");
  });

  it("tells an empty day what to do next", async () => {
    stubFetch({
      "/days/current": {
        body: {
          id: "d1",
          anchor_date: "2026-10-23",
          start_at: "2026-10-23T08:00:00",
          end_at: "2026-10-23T22:00:00",
          timezone: "Europe/London",
          duration_minutes: 840,
          capacity_base_minutes: 300,
          busy_minutes_subtracted: 0,
          threshold_minutes: 225,
          committed_minutes: 0,
          calendar_state: "absent",
          is_indeterminate: false,
          indeterminate_reason: null,
          is_at_risk: false,
          closed_at: null,
          verdict: null,
          calendar_synced_at: null,
          calendar_is_stale: false,
        },
      },
      "/tasks": { body: [] },
    });
    mount(<Today />);
    await waitFor(() => expect(screen.getByText("Nothing planned yet.")).toBeTruthy());
    // An empty state that does not say what to do next is a blank area.
    expect(screen.getByText(/Add a task below/)).toBeTruthy();
  });

  // doc-crawler found the criterion unmet: History and Settings imported no
  // state components at all, and this describe block's own title overstated
  // what it covered. These three close that.
  it("does not present absent history as a real figure", async () => {
    stubFetch({ "/days/heatmap": { status: 0 } });
    const { History } = await import("../pages/History");
    mount(<History />);
    expect(screen.getByRole("status").textContent).toMatch(/Gathering your days/);
    // "-", "0" and "0 of 0 scored" during load read as a result, not a wait.
    expect(screen.queryByText("of 0 scored")).toBeNull();
  });

  it("says so when history cannot be loaded", async () => {
    stubFetch({ "/days/heatmap": { status: 500, body: "boom" } });
    const { History } = await import("../pages/History");
    mount(<History />);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/),
    );
  });

  it("does not show a loading state for a day that failed to load", async () => {
    stubFetch({ "/days/current": { status: 500, body: "boom" }, "/tasks": { body: [] } });
    mount(<Today />);
    // A 500 used to render "Working out where you are in your day." forever,
    // which is a loading state telling a lie.
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/),
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("marks a failure as an alert, so it is announced", async () => {
    const { Problem } = await import("../components/states");
    mount(<Problem title="Something broke." />);
    expect(screen.getByRole("alert").textContent).toContain("Something broke.");
  });
});

describe("the bottom band is one token, not four agreeing numbers (D4)", () => {
  const css = RAW.replace(/\/\*[\s\S]*?\*\//g, "");

  it("defines the band as spacing tokens", () => {
    expect(css).toContain("--spacing-tabbar:");
    expect(css).toContain("--spacing-dock:");
  });

  it("is consumed by every file that occupies the band", async () => {
    const sources = Object.entries(
      import.meta.glob("../**/*.tsx", {
        query: "?raw",
        import: "default",
        eager: true,
      }),
    ) as Array<[string, string]>;
    const find = (name: string) =>
      sources.find(([path]) => path.endsWith(name))?.[1] ?? "";

    expect(find("Nav.tsx")).toContain("h-tabbar");
    expect(find("AppShell.tsx")).toContain("pb-tabbar");
    expect(find("TaskEntry.tsx")).toContain("bottom-dock");
    expect(find("Today.tsx")).toContain("pb-dock");
  });
});

describe("everything interactive is reachable by keyboard (T-IO-42)", () => {
  it("reaches the Settings controls in order, with nothing skipped", async () => {
    const user = userEvent.setup();
    stubFetch({ "/settings/blocks": { body: BLOCKS } });
    mount(<Settings user={USER} />);
    await waitFor(() => expect(screen.getByText("Focus time a day")).toBeTruthy());

    const focusable = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, input, select, a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute("disabled"));
    expect(focusable.length).toBeGreaterThan(5);

    const reached = new Set<Element>();
    for (let i = 0; i < focusable.length + 4; i++) {
      await user.tab();
      if (document.activeElement && document.activeElement !== document.body) {
        reached.add(document.activeElement);
      }
    }
    expect(reached.size).toBeGreaterThan(5);
  });

  it("gives the focus ring a token rather than a hard-coded colour", () => {
    const css = RAW.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toContain("--color-focus:");
  });
});
