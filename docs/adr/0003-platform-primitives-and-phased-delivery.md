---
type: adr
id: 0003
status: accepted
supersedes: null
related_feature: interface-overhaul
created: 2026-10-23
---

# Platform primitives, a DOM test harness, and phased delivery

Four decisions for `interface-overhaul` plan v1: what the interface is built on,
how day detail is presented, how the work is tested, and how it is sequenced.

## 1. Context

Plan v1 (`docs/plans/implementation_plan_interface-overhaul_1.md`) restructures
the frontend from two pages into three screens behind a persistent navigation
bar, rebuilds the visual layer on an explicit token system, adds three
capabilities, makes one additive backend change, and expands the test suite. It
left four questions open (§10 questions 1, 6, 7, 8) and deferred them here.

`repo-surveyor` mapped the repository on 2026-10-23. Five findings shaped this
decision, and two of them contradict the plan.

### The two plan contradictions

**`heatmap.test.ts` is not insulated.** Plan M14 and SC-11 group it with the
tests that import only pure functions, and guarantee all 137 pass with their
source unmodified. In fact `frontend/src/__tests__/heatmap.test.ts:2` imports
`colorFor` from `../components/Heatmap`, and M8 moves that component. It is the
only one of the four logic test files whose import crosses into the component
layer. The other three (`daytime.test.ts`, `api.test.ts`, `hooks.test.ts`)
import from `lib/` and are genuinely insulated.

**The current harness cannot express the coverage M14 promises.**
`frontend/package.json` runs a bare `vitest run`, `frontend/vite.config.ts` has
no `test` block, no `vitest.config.*` exists, and neither jsdom, happy-dom nor
any `@testing-library/*` package is installed. Vitest therefore runs in its
default node environment, which is precisely why both component test files use
`renderToStaticMarkup` against an HTML string. ADR 0002 recorded this as a
deliberate deferral: a DOM test harness, revisit if the untested wiring produces
a defect. M14 commits to new coverage for navigation, routing, day detail and
in-progress state, all of which are event-driven and stateful, and none of which
static markup rendering can observe.

### Three further findings

**The styling layer has no vocabulary to extend, only usage to replace.** Every
color reference in the application is the arbitrary-value form
`[var(--color-*)]`; there is not one semantic utility anywhere.
`text-[var(--color-muted)]` alone appears 57 times and is the single most
frequent class in the codebase. Five text sizes are in use with no scale, ten
distinct top-margin values with no rhythm, five radii with no token, four black
alphas and four white alphas across eight hand-written hover surfaces, and one
`color-mix` recipe duplicated verbatim in two files. A grep for responsive
variants (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`) across all of `frontend/src`
returns zero matches, as does one for `motion-safe:` and `motion-reduce:`.

**`useDay` polls by reaching into the tasks cache.** `frontend/src/lib/hooks.ts`
has `useDay` read `queryClient.getQueryData<Task[]>(keys.tasks)` to decide
whether to poll. `keys.tasks` is the flat `["tasks"]`. Parameterising it by
anchor for M9 and M10 makes that lookup return `undefined`, and the day silently
stops following the estimate cadence. No test covers the coupling.

**`_resolve_day` has three side effects `get_day` does not.** The chain behind
`GET /tasks` runs `close_elapsed_days`, then `current_day`, which calls
`open_day` and materializes a `LogicalDay` row while emitting two analytics
events, then syncs the calendar if stale. `day_service.get_day` does none of
these and returns `None`. An anchor-addressed read must not materialize a past
day that never existed, nor emit day-open events for it.

### The dependency posture being tested

`docs/roadmap.md` cites "`package.json` is unchanged" as a success twice, and
ADR 0002 declined to reuse an installed dependency rather than add one. Plan
§10 question 1 deferred the reversal here, with the user's explicit instruction
that an ADR decide it.

## 2. Options Considered

Day detail is treated as settled rather than optioned: a route (`/history/:anchor`)
is linkable, survives a refresh, requires no focus management, and works on
touch, where the heatmap's current `title`-attribute affordance does not. All
three options below assume it. Plan §10 question 6 is answered by that sentence.

### Option A: Platform-first, nothing added

Build the token layer on Tailwind v4's `@theme`. Use the native `<dialog>`
element for anything modal, a styled native `<select>` for the three existing
selects, an always-visible icon row for per-task actions (plan M5a), and a route
for day detail. Keep `renderToStaticMarkup` and the node test environment.

- **Blast radius.** All 13 source files and `index.css`. No manifest change at
  all, runtime or development.
- **Complexity.** Moderate. The design deliberately avoids every problem that
  would require hand-rolled focus management.
- **New dependencies.** None.
- **Build vs buy.** Build, by declining to need the parts that are usually
  bought.
- **Cost.** Zero bundle growth. No inference cost; nothing here is agentic.
- **Risks.** M14 is not deliverable as specified. Navigation, routing and
  in-progress behaviour would ship with markup-shape assertions and no
  interaction coverage, which is less than the user chose when offered
  preservation, rewrite, or rewrite-plus-expansion.

### Option B: Platform-first, plus a DOM test harness

Option A's runtime design exactly, with `jsdom`, `@testing-library/react` and
`@testing-library/user-event` added as development dependencies and a `test`
block configured so the suite can render and drive real DOM.

- **Blast radius.** Same as A for source. `package.json` gains three
  `devDependencies`; `vite.config.ts` gains a `test` block.
- **Complexity.** Moderate, plus one-time harness setup.
- **New dependencies.** Three, all development-only.
- **Build vs buy.** Build the interface, buy the test environment. Writing a
  DOM implementation is not a reasonable alternative.
- **Cost.** Zero bundle growth: development dependencies are not shipped. Some
  increase in install size and test runtime.
- **Risks.** Reverses ADR 0002's deferral. `vite.config.ts` sits outside
  `tsconfig.json`'s `include`, so a `test` block added there is not type-checked
  by `pnpm lint`, which ADR 0002 already noted.

### Option C: Headless primitives as well

Option B plus `@radix-ui/react-dropdown-menu`, `@radix-ui/react-tooltip` and
`lucide-react`, styled entirely against Doer's own tokens. No shadcn generator
and no `components/ui` tree.

- **Blast radius.** Same source footprint, plus three runtime dependencies.
- **Complexity.** Lower per component, higher in total: a second styling
  vocabulary to reconcile with the token layer.
- **New dependencies.** Three runtime, three development.
- **Build vs buy.** Buy the menu, the tooltip and the icon set.
- **Cost.** Roughly 20 kB gzipped, against a measured baseline of 92.60 kB, so
  approximately 22% growth. Radix publishes each primitive as its own package
  carrying duplicated internals (`react-slot`, `react-primitive`), so the cost
  is superlinear in the number of primitives adopted.
- **Risks.** It buys less than it appears to. Native `<dialog>` already supplies
  the focus trap, backdrop, inert background, top layer and Escape handling that
  are the usual reason to reach for a primitive library, and Radix's own Dialog
  largely wraps or reproduces that behaviour. A route removes the drawer, and an
  icon row removes the menu. What remains to purchase is a tooltip primitive and
  an icon set.

### Full shadcn/ui, considered and rejected before reaching the shortlist

shadcn/ui supports React 18 and Tailwind v4, so neither is the obstacle. It
requires its own semantic variable vocabulary (`--background`, `--foreground`,
`--primary`, `--border`) declared through `@theme inline`, and the `.dark` class
convention rather than `prefers-color-scheme`. Doer's vocabulary is `ink`,
`paper`, `muted`, `line`, `success`, `failure`, `risk`, and those names carry
product meaning rather than framework meaning. Adoption would mean either
renaming them throughout or maintaining two parallel token systems. It also
pulls `cmdk`, `recharts`, `tailwind-merge`, `clsx` and `tw-animate-css` for
capability this plan does not use. Rejected as the largest blast radius for the
least fit.

### Sequencing, considered separately

One change, two phases, or four phases with lint, tests and build green at each
boundary. Plan §10 question 7 raised this directly.

## 3. Decision

**Option B, delivered in four phases.** Chosen by the user on 2026-10-23 after
the options were presented with the survey findings above.

This is a deliberate departure from the least-impact default. Option A is
smaller and changes no manifest, but it cannot deliver M14, and M14 is what the
user selected when offered three levels of test ambition. The posture
`docs/roadmap.md` celebrates is about shipped bundle size and runtime surface,
and a development-only harness costs nothing against either. ADR 0002's own
condition for revisiting has already been met: `docs/roadmap.md` records
`doc-crawler` finding two real defects in untested pointer wiring, one of them a
drag that passed straight through a block.

### What was verified rather than assumed

The token layer rests on one empirical property, tested against Tailwind 4.3.3,
the exact version in `pnpm-lock.yaml`, by building a throwaway project with the
installed plugin. A plain `@theme` block (not `@theme inline`) generates
utilities that reference the custom property rather than inlining its value:

```
.text-ink      ->  .text-ink{color:var(--color-ink)}
.bg-paper      ->  .bg-paper{background-color:var(--color-paper)}
.border-line   ->  .border-line{border-color:var(--color-line)}
.text-step-2   ->  .text-step-2{font-size:var(--text-step-2)}
.p-gutter      ->  .p-gutter{padding:var(--spacing-gutter)}
```

Three consequences follow. A `:root` override inside a media query cascades to
every utility at runtime, so dark mode continues to work by cascade and an
explicit theme selector (plan C1) can be added later as another selector block
without touching a component. Custom namespaces generate correctly, so the type
scale and spacing rhythm can be real tokens rather than conventions. And
`@theme inline`, which shadcn/ui requires, would have inlined the resolved value
and broken runtime overriding, which independently confirms the rejection above.

### Phases

Each phase ends with `pnpm lint`, `pnpm test` and `pnpm build` green, and is
separately reviewable and revertable.

1. **P1. Foundation and shell.** Token layer in `@theme` (three tiers:
   primitives, semantic, component), the dark palette completed to all seven
   colors, routing restructured to `/today`, `/history`, `/settings`, the
   navigation bar in both its desktop and mobile forms, and the responsive
   scaffolding. Existing screen content is moved, not redesigned. Outcome: the
   application is navigable as three screens and visually consistent, with no
   behaviour changed.
2. **P2. Today.** The four-slot commitment header, the task list and rows, the
   per-task action redesign (M5a), the task entry pair (M6), and task start with
   its in-progress state (M7). Outcome: the screen seen every day is finished.
3. **P3. History.** The heatmap relocated and given room, summary statistics,
   the day detail route, and the backend `anchor` parameter. Outcome: the
   analytics window works.
4. **P4. Settings and polish.** The day shape form and block editor restyled,
   the explainer prose removed, then motion, empty, loading and error states
   across all three screens. Outcome: nothing structural remains.

### Consequential sub-decisions

- **Day detail is a route**, `/history/:anchor`, answering plan §10 question 6.
- **Per-task actions become an always-visible icon row**, answering plan §10
  question 8. Hover-gated controls are chosen against because they have no touch
  equivalent and M12 makes mobile first-class. The survey confirms the current
  controls, and block Remove in Settings, are unreachable on touch today.
- **`colorFor` moves to `lib/heatmap.ts`.** It is a pure function that returns a
  CSS string and has no reason to live in a component file. The 12 assertions in
  `heatmap.test.ts` are preserved exactly; only the import path changes. Plan
  SC-11 is corrected accordingly rather than quietly broken.
- **`keys.tasks` becomes `["tasks", anchor]`**, and `useDay`'s cache lookup is
  updated in the same change, with a test covering the coupling. The survey
  found no existing test for it.
- **The anchor read uses `day_service.get_day` and 404s**, matching
  `GET /days/{anchor}`. It must not run `close_elapsed_days`, must not
  materialize a row through `open_day`, and must not emit day-open analytics
  events for a historical date.

## 4. Consequences

### Accepted

- `package.json` gains three development dependencies. The claim "`package.json`
  is unchanged" stops being true and should not be restated in future documents
  without qualification. The runtime manifest is still unchanged.
- ADR 0002's deferral of a DOM test harness is withdrawn, on the condition it
  set for itself. ADR 0002 is not superseded: every other decision in it stands,
  including the geometry-in-`daytime.ts` split and the no-new-runtime-dependency
  posture, which this decision upholds.
- Four phases means Today is touched twice, once in P1 for the shell and once in
  P2 for its content. That interim churn is accepted in exchange for four
  reviewable diffs instead of one unreviewable one.
- `vite.config.ts` gaining a `test` block introduces configuration that
  `pnpm lint` does not type-check, because `tsconfig.json` includes only `src`.

### Expected benefits

- Every color, size, space and radius becomes a named token, replacing 57
  arbitrary-value color references and ten unsystematic margin values.
- Dark mode becomes correct for the first time. Seven tokens resolve per scheme
  instead of four, which fixes the risk dot, the completed-task indicator, every
  heatmap fill, and every error message against a dark background.
- Interaction behaviour becomes testable at all, where today 137 of 158 cases
  test pure functions and the remaining 21 assert HTML substrings.
- `actual_minutes` starts being populated, closing the first of the three Drift
  Notes in `docs/roadmap.md`.

### Risks carried forward

- **The markup assertions are brittle in a specific way.** `day_timeline.test.tsx`
  asserts that exactly three `tabindex="0"` attributes exist in the document and
  that the substring `tabindex` is entirely absent in the read-only case.
  `clock_input.test.tsx` requires the digit pairs to be bare text nodes, so
  wrapping them in any element breaks four cases. Adding one focusable element
  anywhere in those subtrees fails tests that are nominally about something
  else. Rewriting them against the DOM harness should preserve the intent and
  drop the incidental coupling.
- **`Settings.tsx` has a second data-access pattern**, calling `api()` directly
  for three mutations and hand-invalidating. P4 touches that file; the
  divergence should be resolved then or deliberately left, not discovered.
- **The `pb-40` coupling spans three files**, and a mobile bottom tab bar
  occupies the same band that `AddTask`'s fixed panel does. P1 and P2 both touch
  this; it is the most likely source of a layout regression.
- **Task group ordering is Map insertion order**, which is the order the API
  happens to return tasks in, not a declared sequence. The redesign makes group
  headings more prominent, which makes the instability more visible.
- **The premise is unverified.** Plan §1 records that this work builds before
  measuring, justified on the reading that the interface suppresses daily use.
  Nothing in this ADR tests that.

### Sources

- [Tailwind v4, shadcn/ui](https://ui.shadcn.com/docs/tailwind-v4), for the
  `@theme inline` requirement, the variable naming convention, and React 18
  support.
- [HTML dialog element, accessible native modals](https://www.buildmvpfast.com/blog/html-dialog-element-accessible-modal-browser-native-2026),
  for what `showModal()` provides without a library.
- [Radix primitives package size discussion](https://github.com/radix-ui/primitives/discussions/1424),
  for per-package internal duplication.
- [Design tokens with Tailwind v4](https://www.maviklabs.com/blog/design-tokens-tailwind-v4-2026/),
  for the three-tier token hierarchy.
