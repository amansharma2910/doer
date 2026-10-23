# Interface Overhaul

Last updated 2026-10-23, on completion of all four delivery phases.

## Drift Notes

1. **`vite.config.ts` is not type-checked.** `tsconfig.json` includes only
   `src`, so the `test` block added for the DOM harness is outside the reach of
   `pnpm lint`. ADR 0002 noted the same gap for the rest of that file and ADR
   0003 accepted it. A typo in the `test` block fails at run time, not at lint
   time.
2. **`WEEKS = 26` is declared twice**, in `pages/History.tsx` and in
   `components/Heatmap.tsx`. Both call `useHeatmap(WEEKS)`, so they share one
   query key and one request, which is what AC-IO-22 requires. If the two ever
   disagree, the screen silently makes two requests and shows figures computed
   over a different span than the grid beneath them.
3. **The heatmap has no month or weekday labels.** Twenty-six columns of
   squares with no axis is hard to read as a record. Pre-existing, outside this
   plan's scope, and worth a decision.
4. **`lib/elapsed.ts` has no direct test.** It is exercised through `TaskList`
   in `today.test.tsx`, but its timestamp normalisation (the branch that
   appends `Z` to a naive UTC string) is covered only incidentally.

## 1. What the feature does

It restructures the web interface from two pages into three screens behind a
persistent navigation bar, rebuilds the visual layer on an explicit design
token system, and reaches three capabilities the backend already supported and
the interface never called.

| Screen | Route | Holds |
|---|---|---|
| Today | `/today` | Four-slot commitment header, grouped task list, completed work, both entry paths |
| History | `/history` | Summary statistics, the heatmap, every cell a link |
| Day detail | `/history/:anchor` | One past day: its outcome and its tasks |
| Settings | `/settings` | Day shape, block editor, derived figures |

The driving requirements and their acceptance criteria are in
`docs/plans/implementation_plan_interface-overhaul_1.md` (§4 and §12). The
approach, and why no runtime dependency was added, is in
`docs/adr/0003-platform-primitives-and-phased-delivery.md`.

## 2. Implementation detail

### The token layer

`frontend/src/index.css` is the single source for every colour, size, radius,
shadow and spacing step. Components consume generated utilities (`text-muted`,
`bg-raised`, `pb-dock`); none holds a literal. `tokens.test.ts` enforces that by
grepping the source tree for the arbitrary-value forms that were there before:
`[var(--color-*)]` appeared 57 times, `black/[0.0*]` and `white/[0.0*]` at eight
sites across four opacities.

It is a plain `@theme` block, **not `@theme inline`**. The distinction is
load-bearing and was verified against Tailwind 4.3.3 rather than assumed: plain
`@theme` emits `.text-ink{color:var(--color-ink)}`, so the `:root` override
inside the dark media query reaches every utility at run time. `@theme inline`
resolves the value into the utility at build time and would break that. A test
guards it.

Two defects were closed here, both invisible to the previous suite because no
test asserted a colour:

- **Dark mode defined four of seven colours.** `success`, `failure` and `risk`
  kept values chosen against `#fbfaf8` paper while rendering against `#15161a`.
- **The palette failed WCAG AA in both schemes.** `muted` was 3.11:1 on light
  paper and is the most-used class in the application; `risk` was 2.79:1, below
  even the 3:1 graphic threshold. Replacements were solved for by holding hue
  and saturation and moving lightness, against the harder of page and raised
  surface in each scheme, with margin so hex rounding cannot drop below.

`risk` split into two roles. `--color-risk` is warning text and clears 4.5:1,
which on light paper makes it a dark amber. `--color-risk-mark` is the at-risk
dot and the heatmap's at-risk cell, clears the 3:1 graphic threshold, and stays
orange. They are one signal in two roles, so they move together.

### The shell

`App.tsx` keeps its four unauthenticated gates in their load-bearing order:
`isPaused`, then `isPending`, then 401, then outage. None of them renders the
shell, because a navigation bar above "Could not reach the API" offers three
rooms that cannot be entered. The route tree moved into an exported `AppRoutes`
so a test can mount it inside a `MemoryRouter`; `App` still wraps it in
`BrowserRouter`.

`AppShell` chooses between a top bar and a bottom tab bar through
`useMediaQuery(COMPACT_QUERY)`. This is JavaScript rather than `hidden sm:flex`
on purpose: AC-IO-04 requires exactly one navigation to be *rendered*, and a
CSS-hidden element is rendered. `useMediaQuery` guards both the initial read and
the subscription, so an environment without `matchMedia` (jsdom has none) gets
the desktop layout rather than a crash.

### Today

`DayHeader` leads with four slots. Filled count equals primary count; when fewer
than two exist the first two empty slots are dashed and the header says "needs 2
to score", because the verdict rule leaves such a day neutral and unscoreable
and nothing previously said so. The marker disappears at two.

`TaskRow` controls are always present. They were `opacity-0` until
`group-hover`, which on touch meant they did not exist. A running task carries a
left edge and a tint, and shows elapsed time where the estimate was: one number
per glance, and the live one is the one being decided on.

`TaskEntry` is one docked surface carrying both ways in. `AddTaskForm` commits
what you type; `ChatPanel` proposes for confirmation. The labels state the
difference. The never-disable-the-remedy rule is preserved and tested: with four
primaries taken, the checkbox is enabled before and after ticking, and the
"Add as an extra" escape is always clickable.

### History and the backend change

`summarize` in `lib/stats.ts` computes every figure from the heatmap payload the
screen already fetched, so History still issues one request.

The streak counts consecutive `success` days back from the most recent. A
`failure` resets it. `neutral` and `unscheduled` are **skipped**, so a deliberate
rest day costs nothing. That choice leaves one gaming route open, recorded
rather than hidden: a single primary scheduled indefinitely scores neutral and
keeps a streak alive while committing to nothing. The scoring-floor marker on
Today is the mitigation.

`summarize` takes `today` and ignores every grid day after it. The server pads
the grid forward to the Saturday on or after today, so the last rows are dates
that have not happened. Without the clamp the rolling window held one real day
on a Sunday and seven only on a Saturday.

`GET /tasks` gained an optional `anchor`. The two cases deliberately do not
share a code path. `_resolve_day` closes elapsed days, materializes the current
one through `open_day` (which emits two analytics events), and syncs the
calendar. All three are right for "now" and wrong for the past: reading history
must not invent days or write to an append-only log. The anchor path calls
`day_service.get_day` and 404s. A test asserts the `logical_days` and `events`
row counts are unchanged across the call.

## 3. Key files and entry points

| Concern | File |
|---|---|
| Design tokens, both schemes, motion suppression | `frontend/src/index.css` |
| Auth gates and the route tree | `frontend/src/App.tsx` |
| Frame, breakpoint choice | `frontend/src/components/AppShell.tsx` |
| Both navigations, sign-out | `frontend/src/components/Nav.tsx` |
| Four-slot contract, scoring floor, risk dot | `frontend/src/components/DayHeader.tsx` |
| Task rows, icon controls, in-progress | `frontend/src/components/TaskList.tsx` |
| The entry pair | `frontend/src/components/TaskEntry.tsx` |
| Loading, empty and error treatments | `frontend/src/components/states.tsx` |
| Icon set, hand-drawn | `frontend/src/components/icons.tsx` |
| History figures | `frontend/src/lib/stats.ts` |
| Heatmap cell colour | `frontend/src/lib/heatmap.ts` |
| Elapsed time | `frontend/src/lib/elapsed.ts` |
| Breakpoint subscription | `frontend/src/lib/useMediaQuery.ts` |
| Anchor-date formatting | `frontend/src/lib/daytime.ts` |
| The one backend change | `backend/doer/api/tasks.py` |

## 4. Interfaces and contracts

**`GET /tasks`** accepts an optional `anchor` (ISO date). Omitted, it behaves
exactly as before. Given one, it returns that day's tasks, 404s when no logical
day exists on that anchor, and 422s on a malformed date. It never materializes a
day and never emits an event. The handler was renamed `list_today` to
`list_tasks`, which changes the generated OpenAPI `operationId`.

**Query keys.** `keys.tasks` is `["tasks", "current"]`; `keys.tasksAt(anchor)` is
`["tasks", anchor]`; same shape for `day`. `useTaskMutation` invalidates by the
bare prefixes `["tasks"]`, `["day"]` and `["heatmap"]`, so a mutation on Today
also refreshes an open day-detail view.

This key is coupled to polling and the coupling is easy to miss. `useDay`
decides whether to refetch by reading the tasks cache *by key*. Parameterising
`keys.tasks` without updating that read returns `undefined` and the day silently
stops following the estimate cadence, with nothing failing. `history.test.tsx`
covers it.

**Renamed exports.** `AddTask` is now `AddTaskForm({ primariesUsed, onDone })`;
`Chat` is now `ChatPanel({ onDone })`. Both file names are unchanged. `colorFor`
and `View` moved from `components/Heatmap.tsx` to `lib/heatmap.ts`.

**Dependencies.** Runtime `dependencies` is byte-identical. Three additions, all
`devDependencies`: `jsdom`, `@testing-library/react`,
`@testing-library/user-event`.

## 5. Pointers for developers

- **Start at `index.css`.** Every visual decision is there. Changing a colour
  fails `tokens.test.ts` if it drops below its contrast obligation, which is the
  point.
- **The test environment is node by default.** `vite.config.ts` pins it, and the
  four DOM test files opt in with a `// @vitest-environment jsdom` docblock. The
  158 pre-existing cases keep the footing they were written against; 146 of them
  are byte-identical after this work, the only edited one being
  `heatmap.test.ts`, by three lines.
- **`css: true` in the test config is load-bearing.** Vitest stubs CSS imports
  to an empty string by default, including `?raw` ones, which would make
  `tokens.test.ts` pass by vacuity against an empty file.
- **The bottom band is one token.** `--spacing-tabbar` and `--spacing-dock` are
  consumed by `Nav`, `AppShell`, `TaskEntry` and `Today`. Four files used to
  hard-code their own values while a comment claimed one of them was canonical.
- **Four defects were found by `doc-crawler` after the phase gates passed**, and
  every one has a regression test: the rolling window counting future days;
  `formatAnchorDate` rendering `2026-13-45` as a confident "Sunday, February 14"
  because `Number("")` is 0 and `new Date` rolls out-of-range parts over; Today
  rendering a loading state forever on a non-409 failure; and History and
  Settings having no loading or error states at all despite a test named as
  though they did.
