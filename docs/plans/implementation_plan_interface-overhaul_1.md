---
type: implementation_plan
feature: interface-overhaul
version: 1
status: approved
unplanned: false
linear_issue: null
created: 2026-10-23
updated: 2026-10-23
---

# Interface Overhaul

A restructure of the Doer web interface from two pages into three screens behind
a persistent navigation bar, rebuilt on an explicit design token layer, with
three capabilities added that the backend already supports and the interface
never reached.

## 1. Problem Statement

Doer's functionality is complete and verified. Its interface is not designed, it
is accumulated. Three symptoms, in the user's words and confirmed by reading the
code:

**Everything is on one page or buried in settings.** `Dashboard.tsx` renders the
day header, the grouped task list, the completed section, the assistant chat and
a 26 week history heatmap in a single 2xl column. `Settings.tsx` holds the day
shape form and the block editor, which together drive the entire capacity model.
There is no hierarchy between a task due in the next hour and a square
representing a day five months ago.

**It does not look designed.** There is no type scale: sizes are chosen per
element from `text-xs`, `text-sm` and `text-xl`. There is no spacing rhythm:
margins run `mt-8`, `mt-10`, `mt-12`, `mt-14` with no system behind the choices.
There is one border color and no surface or elevation vocabulary, so every
container is a hairline rectangle. Dark mode is half implemented: `index.css`
redefines `ink`, `paper`, `muted` and `line` under `prefers-color-scheme: dark`
and leaves `success`, `failure` and `risk` at values chosen for a near white
paper, where they sit against `#15161a`. No test catches this, because no test
asserts color.

**The interface under-serves the product.** Two built and tested endpoints are
never called. `POST /tasks/{id}/start` is the only way `actual_minutes` is ever
populated, which `docs/roadmap.md` carries as a standing Drift Note: the
estimation error indicator in the tracking plan measures a subset that is
currently empty. `GET /days/{anchor}` returns any past day's summary, and the
heatmap that would naturally link to it renders inert squares with a title
attribute.

A fourth symptom is structural rather than visual. Today offers two unrelated
ways to put a task into the day: a floating plus button bottom right, and a text
link reading "Talk to Doer" that expands into an assistant composer. They share
no visual treatment, no placement logic and no language, and a reader has no way
to tell that one commits immediately and the other proposes for confirmation.

### Why now, stated honestly

`docs/roadmap.md` records that no real days have been scored and that the
validation question is behavioral rather than constructional. This plan is
therefore building before measuring, which is normally the wrong order. It is
justified on one premise, supplied by the user and recorded here so a later
reader can test it: the interface is unpleasant enough that it suppresses the
daily use the validation depends on. If that premise is wrong, this work is
premature polish. It is cheap to check after the fact, because the north star
metric is already instrumented.

## 2. Business Objective and End Goal

The objective is unchanged from `daily-task-planner` v1: validate that the 75%
commitment contract changes behavior for a single user. This plan serves that
objective indirectly, by removing interface friction as a competing explanation
for low usage.

The end goal is an interface where the commitment contract is the most legible
thing on the screen, where each of the three things a user does (run today,
review history, shape the day) has a room of its own, and where the measured
data the product depends on is actually produced because starting a task is
finally possible.

Success is behavioral, not aesthetic: days get recorded. Aesthetic quality is
instrumental.

## 3. Users and UX

One user, the author, on a laptop primarily and a phone occasionally. Expert in
the domain, with zero tolerance for ceremony and a stated preference for
restraint. The product's own thesis constrains the design: over-commitment is
shown, not shouted, so no modal, no toast and no notification may be introduced
to signal it.

Three screens, decided in discovery:

| Screen | Holds | Route |
|---|---|---|
| Today | Day header, task list, completed work, both task entry paths | `/today` |
| History | Heatmap, summary statistics, day detail | `/history` |
| Settings | Day shape, block editor, account | `/settings` |

Navigation is a top bar on desktop and a bottom tab bar on mobile. Today is the
default route.

The visual direction is refined restraint: the existing austere character kept,
executed with a real type scale, a consistent spacing rhythm, surface and
elevation tokens, a complete dark palette and motion on state changes. It is not
a departure into warmth, expressiveness or density, all three of which were
considered and declined.

The day header leads with the commitment contract rather than the arithmetic:
four slots, filled or empty, as the primary signal, with committed and threshold
minutes as secondary text beneath, and the existing risk dot retained unchanged.

## 4. Functional Requirements

### Must

- **M1. Three routes behind persistent navigation.** `/today` (default and
  index), `/history`, `/settings`. `/` redirects to `/today`. The existing
  `/settings` path is preserved so no bookmark breaks. Unknown paths resolve to
  Today, as they do today.
- **M2. Navigation bar.** Present on every authenticated screen. Top bar at
  desktop widths, bottom tab bar below the mobile breakpoint. The current
  section is indicated visually and exposed via `aria-current`. User identity
  and sign out are reachable from every screen.
- **M3. Design token layer.** A single source of truth in `index.css` extending
  the existing `@theme` block: complete light and dark palettes, a type scale
  with named steps, a spacing rhythm, surface and elevation tokens, radius
  tokens, and a focus ring token. Components consume tokens; no component
  hard-codes a color, size or shadow.
- **M4. Dark palette completed.** All seven color tokens are defined for both
  schemes. `--color-success`, `--color-failure` and `--color-risk` receive dark
  scheme values that hold their meaning against `--color-paper` at `#15161a`.
  This is a defect fix carried inside this plan rather than a separate fix plan,
  because the token layer it belongs to is being rebuilt here.
- **M5. Today screen.** Day header presenting four commitment slots as the
  primary signal, committed and threshold minutes as secondary text, and the
  risk dot unchanged. Grouped pending task list with drag reordering preserved.
  Completed section, recessed. Both task entry paths. The indeterminate and
  outside-day states are designed rather than bare paragraphs.
- **M5a. Per-task actions redesigned.** Edit, Promote and Delete keep their full
  capability, and their current presentation (three hover-revealed text links on
  every row, which disappear entirely until hover and are unreachable by touch)
  does not survive. This is a Must rather than a Should because the user left it
  unticked on a question asking what was unnecessary, which establishes that the
  capability stays, not that the treatment is acceptable. The replacement
  direction is undecided and is §10 question 8.
- **M6. Task entry coherence.** Manual add and assistant chat remain two
  distinct paths, redesigned as a deliberate pair: shared visual treatment,
  adjacent placement, and language that makes the difference legible (one commits,
  one proposes for confirmation). Neither is a floating element unrelated to the
  other.
- **M7. In-progress task state.** `POST /tasks/{id}/start` is wired. A started
  task is visually distinct from a pending one and shows elapsed time. Starting
  is idempotent at the API (`task_service.py:121` no-ops on an already started or
  completed task), so the interface may call it freely. Completing a started task
  populates `actual_minutes`, closing the standing Drift Note.
- **M8. History screen.** The heatmap moves here and is given room. Both views
  (Tasks done, Days kept) and the legend are retained: the user named the heatmap
  a motivator and an analytics window, and declined to cut either. Summary
  statistics are added above it, computed client side from the heatmap payload
  already fetched: rolling 7 day success rate, current streak, and days kept in
  the period.
- **M9. Day detail.** Selecting a heatmap cell opens that day's detail: the
  summary from `GET /days/{anchor}` and the tasks of that day. A cell with no
  logical day row (the endpoint answers 404) shows an explicit nothing-scheduled
  state rather than an error.
- **M10. Backend: anchor filter on the task list.** `GET /tasks` gains an
  optional `anchor` query parameter defaulting to the current logical day.
  Additive and backward compatible: every existing caller is unchanged. This is
  the one backend change in this plan, and it exists solely because `list_today`
  (`tasks.py:90`) resolves the current day and nothing can read a past day's
  tasks without it. The user chose this over a summary-only day detail.
- **M11. Settings screen.** Day shape form and block editor, restyled. The
  capacity explainer paragraph ("That is 6h 30m of focus time a day. At 75%,
  Doer will quietly flag...") and the "Your day ends at X" sentence are removed
  and replaced by compact derived figures. This is the only element the user
  marked as unnecessary.
- **M12. Responsive at both ends.** All three screens are first-class from
  375px to 1440px and beyond. The block timeline and the heatmap receive
  deliberate mobile treatments rather than being allowed to overflow.
- **M13. Preserved contracts.** The following behave exactly as they do today
  and are verified to: the four primary cap with its structured remedies, the
  carry-forward demotion notice, the risk dot as the sole over-commitment signal,
  confirm-before-commit on assistant proposals, completed-task immutability
  messaging, the 24 hour clock on every time field, estimate buckets as a fixed
  set, and ordering scoped to a block.
- **M14. Test strategy.** Logic tests stay untouched: `daytime.test.ts` (114),
  `api.test.ts` (4), `hooks.test.ts` (7) and `heatmap.test.ts` (12) assert pure
  functions and are unaffected by any restructure. The markup-asserting cases in
  `day_timeline.test.tsx` (10) and `clock_input.test.tsx` (11) are rewritten
  against the new structure, preserving what each one asserts. New coverage is
  added for navigation, routing, the day header, day detail and the in-progress
  state. The user chose expansion over mere preservation.

### Should

- **S1. Keyboard and focus.** Every interactive element reachable by keyboard
  with a visible focus state drawn from the focus ring token. Existing roving
  focus and spinbutton semantics in `ClockInput` and the timeline handles are
  preserved.
- **S2. Motion on state change.** Completion, addition, promotion and demotion
  are animated. All motion is suppressed under `prefers-reduced-motion`.
- **S3. Designed loading and empty states.** Per screen, replacing the current
  bare strings ("Loading", "Nothing planned yet").
- **S4. Consistent error presentation.** API unreachable, offline, the
  outside-day 409 and structured rule refusals share one visual treatment.
- **S5. Destructive action confirmation.** Delete currently fires immediately
  with no confirmation and no undo, which is survivable at four tasks a day and
  worth reconsidering once M5a moves the control somewhere easier to hit.
- **S6. Estimate pending treatment.** The `...` and `no estimate` states get a
  real design, since an unestimated task is what makes a day read indeterminate.

### Could

- **C1. Explicit theme control.** System, light and dark, persisted locally.
  Today the scheme is dictated entirely by `prefers-color-scheme`.
- **C2. Keyboard shortcuts.** Add, complete and navigate between screens.
- **C3. Estimate versus actual indicator.** Becomes meaningful for the first
  time once M7 ships and `actual_minutes` is populated.
- **C4. Carry-forward counter restyled.** The user declined to cut it; it can
  still read better than `↻2`.

### Won't

- **W1.** No mobile-native application.
- **W2.** No change to the four task cap, the 75% verdict, the two primary
  neutral floor, logical day arithmetic, or the capacity model.
- **W3.** No modal, toast or notification for over-commitment. The product
  thesis forbids it.
- **W4.** No new analytics events in this plan. metrics-mode owns instrumentation
  and already has an open item for `timeline-window-drag`.
- **W5.** No removal of the demotion notice or the risk dot. Both are plan
  commitments from `daily-task-planner` v1.
- **W6.** No deployment or hosting change. ADR 0001 defers that to v2.
- **W7.** No change to the assistant model, prompt, or proposal contract.
- **W8.** No backend change beyond M10.

## 5. Non-Functional Requirements

- **Bundle budget.** Baseline measured at plan time: JS 291.55 kB raw, 92.60 kB
  gzipped; CSS 23.45 kB raw, 5.10 kB gzipped. Any dependency added under
  architecture-mode must be justified against a stated ceiling rather than
  absorbed silently.
- **No new runtime dependency without an ADR.** `docs/roadmap.md` cites
  "`package.json` is unchanged" as a success twice. Reversing that posture is an
  architecture decision, not an implementation detail. If a component library is
  adopted, its Tailwind v4 compatibility must be verified against the existing
  `@theme` token block, not assumed: `index.css` uses v4 tokens, not a v3 config
  file.
- **Accessibility.** Contrast meets WCAG AA in both schemes, verified by
  calculation rather than by eye. Keyboard parity with pointer interaction.
  Existing ARIA on the timeline handles and clock segments is preserved or
  improved.
- **Performance.** No new polling. The existing estimate poll (2s, self
  terminating) is unchanged. Route transitions do not refetch data already in
  the query cache.
- **Offline and paused states.** The existing `isPaused` handling in `App.tsx`
  survives the restructure, including its documented reason for using `isPending`
  rather than `isLoading`.

## 6. Inputs and Outputs

**Inputs.** `GET /auth/me`, `GET /days/current`, `GET /days/{anchor}`,
`GET /days/heatmap?weeks=`, `GET /tasks` (gaining optional `anchor`),
`GET /settings/blocks`. All existing, all already typed in `lib/types.ts`.

**Outputs.** `POST /tasks`, `PATCH /tasks/{id}`, `DELETE /tasks/{id}`,
`POST /tasks/{id}/complete`, `DELETE /tasks/{id}/complete`,
`POST /tasks/{id}/primary`, `POST /tasks/{id}/reorder`,
`POST /tasks/{id}/start` (newly reached), `POST /assistant/chat`,
`POST /assistant/confirm`, `PATCH /settings/day-shape`, `POST /settings/blocks`,
`DELETE /settings/blocks/{id}`, `POST /days/current/refresh-calendar`,
`POST /auth/logout`.

The only contract change is M10. Every other request and response shape is
unchanged.

## 7. Success Criteria

Numbered for qa-mode to convert into acceptance criteria.

1. Each of the three screens is reachable from every other in one interaction,
   on both desktop and mobile.
2. The current screen is identifiable without reading the content.
3. The four commitment slots are the most prominent element of the Today header,
   and their filled count matches the number of primary tasks.
4. The risk dot appears when and only when `day.is_at_risk` is true, and remains
   the only over-commitment signal.
5. All seven color tokens resolve to scheme-appropriate values under both
   `prefers-color-scheme` settings, verified by computed style rather than by
   inspection.
6. A task can be started, reads as in progress, and on completion has a non-null
   `actual_minutes`.
7. Selecting a heatmap cell with a logical day shows that day's summary and
   tasks. Selecting one without shows a nothing-scheduled state.
8. `GET /tasks` with no `anchor` returns exactly what it returns today.
9. Every screen is usable with no horizontal overflow at 375px and at 1440px.
10. Every interactive element is reachable by keyboard with a visible focus
    state.
11. These 137 specific logic cases pass with their source unmodified: 114 in
    `daytime.test.ts`, 12 in `heatmap.test.ts`, 7 in `hooks.test.ts`, 4 in
    `api.test.ts`. This is a floor on what must not regress, not a ceiling on
    the suite, which M14 commits to growing.
12. Lint, the full test suite, and the production build are green.
13. Bundle size is within the budget agreed in architecture-mode.
14. All thirteen preserved contracts in M13 behave as they did before.

## 8. Failure Handling and Fallbacks

- **API unreachable.** The existing centered message is restyled, not replaced.
  Navigation is not rendered when there is no session.
- **Offline.** `isPaused` continues to render the waiting state ahead of the 401
  branch, for the reason documented in `App.tsx`.
- **Outside the defined day (409).** Today renders the between-days state with a
  route to Settings. History and Settings stay fully usable, which is an
  improvement: today a 409 suppresses the entire dashboard.
- **`GET /days/{anchor}` 404.** Nothing-scheduled state. Not an error.
- **Calendar revoked or stale.** The existing inline reconnect and refresh
  affordances are preserved and restyled.
- **Structured rule refusals.** The remedy continues to be surfaced with a route
  to act on it. The specific trap recorded in `AddTask.tsx` is preserved: the
  control that enacts a remedy is never disabled while the remedy is being
  offered.
- **Assistant unavailable.** The existing fallback message stands, updated to
  name the manual path by whatever it becomes.
- **Estimation pending or failed.** Unknown is shown as unknown, never as zero.

## 9. Non-Goals

1. Measuring whether the redesign worked. That is metrics-mode, and it has a
   prior open item.
2. Reworking the assistant's behavior, prompt or model.
3. Changing the product rules in any respect.
4. Deployment, hosting or CI.
5. Any backend change beyond the additive `anchor` parameter.
6. Rewriting the logic layer. `daytime.ts` and its 114 tests are a verified
   asset and are not in scope.
7. Removing anything the user did not mark as unnecessary.

## 10. Open Questions

Questions 1, 6, 7 and 8 are closed by ADR 0003 (accepted 2026-10-23); see §11.
Questions 2, 3, 4 and 5 remain open and are qa-mode's.


1. **Component library.** Deferred to architecture-mode by the user's explicit
   choice, with an ADR required. Tailwind v4 compatibility must be verified
   before any commitment. There is no shadcn skill available in this session, so
   adoption would be manual.
2. **Four slot semantics when fewer than four are scheduled.** The indicator
   shows primaries used against the cap of four. Whether an unscheduled slot
   reads as available or as unused is a design decision qa-mode should pin down,
   because the verdict rule treats a day with fewer than two primaries as
   neutral rather than as a failure.
3. **Streak definition.** Whether a streak breaks on a neutral or unscheduled
   day, or only on a failure. This changes the number materially and the
   tracking plan's anti-gaming guardrails are relevant to the choice.
4. **Concurrent started tasks.** `start_task` enforces no exclusivity: any
   number of tasks may be started at once. Whether the interface permits this,
   or allows one running task at a time, is undecided. The permissive reading
   matches the backend; the restrictive reading matches the product's thesis.
5. **Elapsed time display.** Whether elapsed time ticks live (a timer, which is
   motion the product may not want) or renders statically on each query refresh.
6. **Day detail presentation.** Panel, drawer or route. A route is linkable and
   survives refresh; a panel keeps the heatmap in view. Architecture-mode or
   implementation can settle it.
7. **Whether this plan should be split.** It carries a restructure, a visual
   system, three new capabilities, a backend change and a test expansion.
   Delivering it in one pass means a large unreviewable diff. Architecture-mode
   should consider sequencing it as phases with working software at each
   boundary.
8. **How per-task actions are presented (M5a).** Three candidates, none chosen:
   an icon row that is always visible rather than hover-gated; an overflow menu
   per row; or direct manipulation, where promote and demote become a drag
   between the primary group and the extras rather than a button. The third is
   the most in keeping with the existing timeline drag and the most work. Touch
   reachability is a constraint on all three, since M12 makes mobile
   first-class and a hover-gated control has no touch equivalent.

## 11. Chosen Approach

Settled by `docs/adr/0003-platform-primitives-and-phased-delivery.md`, accepted
2026-10-23, after a `repo-surveyor` pass on the same date.

**Platform-first with no new runtime dependencies, delivered in four phases.**
The native `<dialog>` element supplies focus trapping, backdrop, inert
background, top layer and Escape handling, which is the usual reason to adopt a
primitive library. Day detail is a route rather than a drawer, and per-task
actions become an always-visible icon row rather than a menu, so neither a
dialog primitive nor a menu primitive is needed. A component library was
evaluated and declined: full shadcn/ui requires `@theme inline` and its own
variable vocabulary, which collides with this codebase's token names, and a
Radix subset would have cost roughly 20 kB gzipped (22% of the measured
baseline) to buy a tooltip and an icon set.

Three **development** dependencies are added (`jsdom`,
`@testing-library/react`, `@testing-library/user-event`) so that M14 is
deliverable at all. The runtime manifest is unchanged, which is the property the
no-new-dependency posture actually protects.

The token layer uses a plain `@theme` block, not `@theme inline`. Verified
against Tailwind 4.3.3 by building a throwaway project with the installed
plugin: plain `@theme` emits `.text-ink{color:var(--color-ink)}`, so the
existing `:root` dark override cascades to every utility at runtime, and custom
namespaces (`--text-*`, `--spacing-*`) generate correctly.

### Phases, each ending green on lint, tests and build

1. **P1. Foundation and shell.** Tokens, the completed dark palette, routing,
   the navigation bar in both forms, responsive scaffolding. Content is moved,
   not redesigned.
2. **P2. Today.** Four-slot header, task list and rows, M5a, M6, M7.
3. **P3. History.** Heatmap relocated, summary statistics, day detail route,
   backend `anchor` parameter.
4. **P4. Settings and polish.** Day shape and block editor restyled, explainer
   prose removed, then S2, S3 and S4 across all three screens.

### Amendments to earlier sections of this plan

The survey found two statements in §4 and §7 that are false as written. They are
corrected here rather than silently broken.

- **M14 and SC-11 overstate what is insulated.**
  `frontend/src/__tests__/heatmap.test.ts:2` imports `colorFor` from
  `../components/Heatmap`, not from `lib/`, so M8 relocating that component
  breaks 12 cases the plan guarantees untouched. Resolution: `colorFor` moves to
  `lib/heatmap.ts`, where a pure function returning a CSS string belongs. All 12
  assertions are preserved exactly, with one deliberate exception named below;
  the import path changes. Measured after P1, the floor is 146 cases whose
  source is wholly unmodified, plus the 12 in `heatmap.test.ts`.

  Two of those 12 did change value. `colorFor` returned `var(--color-risk)` for
  an at-risk day, and now returns `var(--color-risk-mark)`. The palette work
  split one risk colour into two roles, because the value that clears 4.5:1 as
  warning text is brown on light paper and a brown dot reads as a smudge. The
  heatmap's at-risk cell and the dot on Today are one signal, so they take one
  token. This is a change of intent, not a preserved assertion, and is recorded
  rather than absorbed.
- **M14's new coverage was not expressible in the harness that existed.** The
  suite ran in Vitest's node environment with no DOM, which is why both
  component test files use `renderToStaticMarkup`. The three development
  dependencies above resolve this. ADR 0002's deferral of a DOM harness is
  withdrawn on the condition it set for itself.

### Open questions closed

- **Q1, component library.** No runtime dependency. Development harness only.
- **Q6, day detail presentation.** A route, `/history/:anchor`. Linkable,
  survives refresh, no focus management, works on touch.
- **Q7, one change or phases.** Four phases, green at each boundary.
- **Q8, per-task action presentation.** An always-visible icon row. Hover-gated
  controls have no touch equivalent, and M12 makes mobile first-class.

### Constraints carried into implementation

Found by the survey, each a silent-breakage risk rather than a visible one.

- `useDay` decides whether to poll by reading `keys.tasks` out of the query
  cache directly. Parameterising that key by anchor for M9 and M10 breaks the
  lookup and stops the day following the estimate cadence. Both change together,
  with a test.
- The anchor-addressed task read must use `day_service.get_day` and 404, as
  `GET /days/{anchor}` already does. `_resolve_day` closes elapsed days,
  materializes a row through `open_day` and emits two analytics events, none of
  which may happen for a historical date.
- `Dashboard.tsx`'s `pb-40` clears `AddTask`'s fixed panel, and the mobile tab
  bar occupies the same band. Three files must agree.
- `day_timeline.test.tsx` asserts an exact count of three `tabindex="0"` and the
  total absence of the substring `tabindex` in the read-only case;
  `clock_input.test.tsx` requires digit pairs to be bare text nodes. Rewrites
  preserve the intent and drop the incidental coupling.
- Task group ordering is `Map` insertion order, which is API return order rather
  than a declared sequence. Prominent group headings make that visible.

## 12. QA

Confirmed with the user on 2026-10-23. Criteria are namespaced `AC-IO-NN` and
test cases `T-IO-NN`, following the `AC-TWD` convention in
`implementation_plan_timeline-window-drag_1.md`.

### 12.1 Acceptance Criteria

**The phase gate.** This criterion did not exist in §7, which was written before
ADR 0003 introduced phasing. It is the reason four phases were chosen over one
change, so it is listed first.

- **AC-IO-01.** Each of the four phase boundaries independently satisfies all of:
  `pnpm lint` clean, `pnpm test` fully green, `pnpm build` succeeds, the
  untouched-case floor below is met, and the manual flows covering that phase's
  surface pass before the next phase begins.

  **The floor is 146 cases, not 125.** P1 was expected to leave only the four
  logic files alone (114 + 12 + 7 + 4, less the 12 that moved with `colorFor`).
  In the event `clock_input.test.tsx` (11) and `day_timeline.test.tsx` (10)
  were byte-identical after P1 as well, so 146 of the 158 are untouched and the
  only pre-existing file edited is `heatmap.test.ts`, by three lines. The
  figure is raised rather than left at its original estimate, because a reader
  meeting "125" after the fact would conclude 21 cases had been lost. Those 21
  are expected to change in P4, when the markup they assert changes; until then
  the floor is 146.

**P1, foundation and shell.**

- **AC-IO-02.** `/today`, `/history` and `/settings` resolve. `/` redirects to
  `/today`. An unknown path resolves to Today. The pre-existing `/settings`
  bookmark still works.
- **AC-IO-03.** Navigation renders on every authenticated screen and on none of
  the unauthenticated ones (loading, offline, 401, API outage). The active
  section carries `aria-current`.
- **AC-IO-04.** Navigation is a top bar at desktop widths and a bottom tab bar
  below the mobile breakpoint, with exactly one of the two rendered at any width.
- **AC-IO-05.** All seven color tokens are defined in both the light and the dark
  scheme block. Today four of seven are, which is the defect this closes.
- **AC-IO-06.** Every foreground-on-background token pair in use meets WCAG AA
  contrast, in both schemes, verified by computed ratio rather than inspection.
- **AC-IO-07.** No component hard-codes a color, size, radius or shadow. The
  arbitrary-value forms `[var(--color-*)]`, `black/[0.0*]` and `white/[0.0*]`
  appear nowhere in `frontend/src`, having been replaced by generated utilities.
- **AC-IO-08.** No screen overflows horizontally at 375px or at 1440px.
- **AC-IO-09.** A 409 from `/days/current` leaves History and Settings fully
  usable. Today renders the between-days state. This is an improvement: today a
  409 suppresses the whole dashboard.

**P2, Today.**

- **AC-IO-10.** Four slots render. The filled count equals the number of primary
  tasks. When fewer than two primaries exist, the first two slots are visually
  distinguished as the pair required to score, and the day reads as not yet
  scoreable. At two or more, that distinction is gone.
- **AC-IO-11.** The risk dot appears if and only if `day.is_at_risk` is true, and
  remains the only over-commitment signal. No modal, toast, notification,
  `alert()` or `Notification` API call exists anywhere in `frontend/src`.
- **AC-IO-12.** Edit, Promote and Delete are visible without hover, operable by
  touch, and reachable by keyboard. Today they are `opacity-0` until
  `group-hover`, which has no touch equivalent.
- **AC-IO-13.** Starting a task, then completing it, yields a non-null
  `actual_minutes`. A task completed without being started yields null, as now.
- **AC-IO-14.** More than one task may be in progress at once, matching the
  backend, which has no un-start endpoint. Starting an already-started or
  completed task is a no-op and surfaces no error.
- **AC-IO-15.** When all four primary slots are taken, the control that enacts
  the remedy is never disabled. This preserves the defect recorded in
  `AddTask.tsx`: disabling it made the suggested remedy physically unreachable.
- **AC-IO-16.** The carry-forward demotion notice still names which tasks were
  demoted. It is a commitment of `daily-task-planner` v1.
- **AC-IO-17.** Drag reordering remains scoped to a preference block. A drop
  outside the task's own group is ignored rather than silently reassigning it.

**P3, History.**

- **AC-IO-18.** `GET /tasks` with no query parameter returns exactly what it
  returns today. The two existing HTTP tests pass unmodified.
- **AC-IO-19.** `GET /tasks?anchor=YYYY-MM-DD` returns that day's tasks, and 404s
  for a date with no logical day row. It does not close elapsed days, does not
  materialize a row, and emits no day-open analytics events. Verified by asserting
  the `logical_days` row count and the event count are unchanged across the call.
- **AC-IO-20.** Selecting a heatmap cell navigates to `/history/{anchor}` and
  shows that day's summary and tasks. A cell with no logical day shows a
  nothing-scheduled state, not an error. The route is linkable and survives a
  reload.
- **AC-IO-21.** The streak counts consecutive days whose verdict is `success`.
  A `failure` resets it to zero. `neutral` and `unscheduled` days are skipped:
  they neither extend nor break it.
- **AC-IO-22.** The rolling 7-day success rate and days-kept figures are computed
  from the already-fetched heatmap payload. No additional request is issued to
  display them.
- **AC-IO-23.** After `keys.tasks` is parameterized by anchor, `useDay` still
  polls at the estimate cadence while any task awaits an estimate, and still
  stops when the last one lands or fails.

**P4, Settings and polish.**

- **AC-IO-24.** The capacity explainer paragraph and the "Your day ends at X"
  sentence are gone, replaced by compact derived figures carrying the same
  numbers.
- **AC-IO-25.** All motion is suppressed under `prefers-reduced-motion: reduce`.
- **AC-IO-26.** Every screen has a designed loading state, empty state and error
  state. The bare strings "Loading" and "Nothing planned yet" no longer appear.
- **AC-IO-27.** Every interactive element is reachable by keyboard and shows a
  visible focus state drawn from the focus-ring token. The roving focus in
  `ClockInput` and the three tab stops on the timeline are preserved in behaviour,
  though not necessarily in markup shape.

### 12.2 Evaluation Criteria

Three parts of this work cannot be asserted in code, and pretending otherwise
would produce tests that pass while the interface stays ugly.

1. **"Looks designed" is a judgment pass**, run the way Flow 15 already runs for
   minimalism. The question is not whether a token exists but whether the screen
   reads as considered. A reviewer who says it still looks accumulated is a
   failure, and no automated criterion overrides that.
2. **Intuitiveness is measured by first-use, not by inspection.** A tester who
   has not seen the new interface should reach each of the three screens and
   complete a task without being told where anything is.
3. **Restraint is preserved.** The product thesis is that over-commitment is
   shown, not shouted. A reviewer who feels nagged, alerted or interrupted is a
   failure even where every other criterion passes.

**Accepted risk, recorded rather than resolved.** AC-IO-21 skips neutral days,
which leaves one gaming route open: scheduling a single primary indefinitely
keeps a streak alive while committing to nothing, since a day with fewer than two
primaries scores neutral. The user chose this over the stricter readings on
2026-10-23, judging fairness to a genuine rest day worth more than closing the
route. AC-IO-10's scoring-floor marker is the mitigation: a one-primary day is
visibly not scoreable, so the route is at least not invisible. The tracking plan's
commitment-shrinking guardrails remain the real defence and are unchanged.

### 12.3 Automated Test Cases

Grouped by phase. Counts are definitions, not a promise about file layout.

**Tokens and theming (P1).**

- **T-IO-01.** Every one of the seven color tokens is defined in the light block.
- **T-IO-02.** Every one of the seven is redefined in the dark block. Fails today.
- **T-IO-03.** Each foreground-on-background pair meets WCAG AA in the light
  scheme, by computed contrast ratio.
- **T-IO-04.** The same pairs meet AA in the dark scheme.
- **T-IO-05.** `frontend/src` contains no `[var(--color-`, no `black/[0.`, and no
  `white/[0.` occurrence.
- **T-IO-06.** The type-scale and spacing tokens generate their utilities.

These are static and arithmetic assertions over `index.css` and the source tree,
not computed-style tests. jsdom does not evaluate media-query cascade reliably,
so a `getComputedStyle` assertion would prove nothing about the real browser.

**Routing and navigation (P1).**

- **T-IO-07.** `/` redirects to `/today`.
- **T-IO-08.** Each of the three paths renders its own screen.
- **T-IO-09.** An unknown path renders Today.
- **T-IO-10.** Navigation is absent in each of the four unauthenticated states,
  and the `isPaused` before `isPending` before 401 before outage ordering is
  preserved.
- **T-IO-11.** The active link carries `aria-current`.
- **T-IO-12.** Below the mobile breakpoint the bottom tab bar renders and the top
  bar does not; above it, the reverse.
- **T-IO-13.** A 409 on `/days/current` still renders History and Settings.

**Today (P2).**

- **T-IO-14.** Four slots render with zero, one, two and four primaries.
- **T-IO-15.** The scoring-floor marker is present at zero and one primary and
  absent at two, three and four.
- **T-IO-16.** The risk dot renders if and only if `is_at_risk`.
- **T-IO-17.** No modal, toast, `alert`, `confirm` or `Notification` reference
  exists in `frontend/src`.
- **T-IO-18.** The three per-task controls are in the accessibility tree without a
  hover event and are activatable by keyboard.
- **T-IO-19.** Starting a task renders the in-progress treatment and shows elapsed
  time.
- **T-IO-20.** Two tasks started concurrently both render as in progress.
- **T-IO-21.** Starting an already-started task issues the request and surfaces no
  error.
- **T-IO-22.** With four primaries taken, the remedy control is enabled and
  clicking it creates a non-primary task.
- **T-IO-23.** The demotion notice renders and names the demoted tasks.
- **T-IO-24.** A drag whose drop target is in another preference group is ignored.
- **T-IO-25.** Both task entry paths are reachable without hover.

**History and the backend (P3).**

- **T-IO-26.** `GET /tasks` with no parameter returns the current day's tasks, as
  the two existing tests already assert.
- **T-IO-27.** `GET /tasks?anchor=` returns the tasks of a past day.
- **T-IO-28.** `GET /tasks?anchor=` 404s for a date with no logical day row.
- **T-IO-29.** That 404 path creates no `logical_days` row and emits no event.
- **T-IO-30.** An anchor outside the retained range, and a malformed anchor, are
  rejected without a 500.
- **T-IO-31.** Clicking a cell navigates to `/history/{anchor}`.
- **T-IO-32.** `/history/{anchor}` renders a nothing-scheduled state on 404.
- **T-IO-33.** Streak: a run of successes counts; a failure resets to zero.
- **T-IO-34.** Streak: neutral and unscheduled days are skipped, extending
  neither and breaking neither.
- **T-IO-35.** Streak is zero when no day has ever scored.
- **T-IO-36.** The rolling 7-day rate is computed from the heatmap payload with no
  extra request.
- **T-IO-37.** `useDay` still polls while a task awaits an estimate after
  `keys.tasks` is parameterized, and stops when the last estimate resolves. This
  covers the coupling the survey found untested.
- **T-IO-38.** `colorFor` keeps all 12 of its existing assertions after moving to
  `lib/heatmap.ts`.

**Settings and polish (P4).**

- **T-IO-39.** The explainer paragraph and the day-end sentence are absent, and
  the derived figures carry the same numbers.
- **T-IO-40.** Under `prefers-reduced-motion: reduce`, no transition or animation
  class is applied.
- **T-IO-41.** Each screen renders a distinct loading, empty and error state.
- **T-IO-42.** Every interactive element on each screen is focusable.
- **T-IO-43.** The rewritten `ClockInput` cases preserve their original
  assertions: 24-hour display, no AM or PM anywhere, one tab stop under roving
  focus, two spinbuttons with correct `aria-valuetext` and `aria-valuemax`.
- **T-IO-44.** The rewritten `DayTimeline` cases preserve theirs: two sliders,
  correct `aria-valuetext`, `aria-valuemin` and `aria-valuemax`, three tab stops,
  the overlay passing pointer events through, and the read-only render having no
  slider and no tab stop.

### 12.4 Edge Cases to Handle

1. A day with zero tasks, and a day with four primaries and several extras.
2. A day with one primary: scoreable floor unmet, marker shown, verdict neutral.
3. A task started and then deleted. A task started and then demoted.
4. A task started, left overnight, and completed after the day closes.
5. Multiple tasks started at once, since AC-IO-14 permits it.
6. A heatmap cell for a date before the user's first ever day.
7. A heatmap cell for today, which is open and unscored.
8. `/history/{anchor}` entered directly by URL, including a malformed date and a
   future date.
9. A phase-shifted day running past midnight, where the anchor date and the
   calendar date differ. This is the case the whole logical-day model exists for.
10. Sign-out from each of the three screens.
11. Offline on each of the three screens, exercising the `isPaused` branch.
12. Calendar revoked and calendar stale, with their inline affordances.
13. An estimate that never resolves and one that fails, on both Today and in the
    four-slot header.
14. The narrowest supported width, 375px, with the heatmap: 26 columns at
    roughly 14px is about 364px and has almost no margin.
15. `prefers-reduced-motion` set, on every screen.
16. A browser with no `prefers-color-scheme` preference expressed.
