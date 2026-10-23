---
type: adr
id: 0002
status: accepted
supersedes: null
related_feature: timeline-window-drag
created: 2026-10-22
---

# ADR 0002: Magnetic Window Drag on the Day Timeline

## 1. Context

Plan `timeline-window-drag` v1 makes the dashed preview window on the Settings day
timeline directly manipulable: drag the body to slide the range, drag either edge
to resize, everything in 30 minute steps, with placement that can never produce an
overlap. The plan is frontend only and explicitly forbids a backend, schema or API
change.

A repository survey established the starting conditions.

**The surface is small and has one consumer.** `DayTimeline` is 67 lines with no
state, no refs and no event handlers (`frontend/src/components/DayTimeline.tsx`).
It is imported in exactly one place, `Settings.tsx`. Preview state lives in
`BlocksEditor` as two clock strings, `from` and `to` (`Settings.tsx`), and
a single `toOffsets` call at `Settings.tsx` feeds five consumers: the collision
check, the validity flag, the POST body, the `preview` prop and the readout
paragraph. A drag that writes `setFrom`, `setTo` and `edited.current = true`
therefore updates all five for free, which is what the plan's M10 asks for.

**Pure logic in `lib`, thin components, is the established house pattern.**
`daytime.ts` has zero imports and no React. `Heatmap.tsx` exports `colorFor` so it
can be tested without a DOM. `hooks.ts` exports `signOutTeardown` with a
comment stating it is "Exported as a plain function so the behaviour is testable
without a DOM." The plan's M8 restates an existing convention rather than
introducing one.

**The project has a documented stance against new dependencies.** ADR 0001 line 85
records that date arithmetic is hand-written and the heatmap is hand-built rather
than a library; line 115 records that `zod` and `date-fns` were specified, proved
unnecessary, and were removed from the manifests rather than left as aspiration.
`docs/roadmap.md` repeats it for eight dependencies in total.

Three findings reframed the problem.

### The plan's own requirements were unsatisfiable

M2 placed every window edge on the wall-clock half-hour grid, M1 preserved window
length through a body drag, and M6 parked the window flush against a neighbour.
Any two hold; all three cannot, as soon as anything is off the grid:

- A 09:22 to 10:00 window is 38 minutes long. Snapping its start to 09:30 puts its
  end at 10:08, off the grid. Snapping both ends changes the length.
- For a block starting at offset 100 and a 60 minute window, the flush position is
  offsets 40 to 100. On a 09:00 day, 40 is not a grid value, so M5's own definition
  of a legal position excludes the position M6 requires.

Off-grid state is the normal case, not an edge case. It is reachable by four
independent routes: the time inputs carry no `step` attribute, so minute
granularity is typeable; `BlockIn`
validates only `0 <= start`, `end <= 1440` and `end > start`
(`backend/doer/schemas/day.py`), with no grid and no minimum length;
`firstFreeGap` seeds the window from a stored block's `end_offset_minutes`
(`daytime.ts`), inheriting its granularity; and `endForStart` adds 60 minutes
to whatever start it is handed (`daytime.ts`).

The real question, which plan v1 never posed, is whether the grid constrains a
window's **absolute edges** or only its **movement**.

**Amended 2026-10-23.** The first of those four routes is now closed: the From and
Until fields accept only `:00` and `:30`, decided while fixing
`time-inputs-show-12-hour-clock`. That is a reversal of a deliberate choice
recorded here, so it is noted rather than edited away. The decision below is
unaffected and still necessary, because the other three routes remain open: the
server validates no grid, `firstFreeGap` seeds from a stored block's end, and
`endForStart` adds an hour to an off-grid start. Off-grid blocks and off-grid
window lengths therefore stay reachable, and grid-plus-flush is still the only
rule that can satisfy M1, M2 and M6 together. The `Settings.tsx` line references
above were also stale. Rather than renumber them, **every** line number in this
document has been dropped and only file names kept, since a line number moves with
every edit to the file it names and a document nobody can trust is worse than one
that is merely less precise.

### The handles do not fit inside the bar

The bar is `relative h-9 w-full overflow-hidden` (`DayTimeline.tsx`), inside
`mx-auto max-w-2xl px-6` (`Settings.tsx`), so roughly 620 pixels wide. A 30
minute window is 3.3% of a 15 hour day, about 21 pixels, and 2.1% of a 24 hour day,
about 13 pixels. The plan's non-functional requirement of an 8 pixel grab zone
means two handles consume the whole of a minimum-length window. Worse, at offset 0
or at `dayDurationMinutes` the bar's own `overflow-hidden` clips a handle away
entirely. Percentage-based `left` and `width`, which is how blocks and the preview
are positioned today (`DayTimeline.tsx`), cannot express a
pixel-sized grab zone.

### A DOM test harness would not buy real coverage

Confirmed exactly: `package.json` runs `vitest run` with no flags,
`vite.config.ts` has no `test` block, no vitest config file exists, and the
lockfile importers list no jsdom, happy-dom or `@testing-library/*`. Vitest
therefore runs its default node environment and all four existing test files are
pure-function tests. Adding a harness means four devDependencies, a `test` block,
and a `tsconfig.json` change, since `vite.config.ts` sits outside `include` and is
not type-checked by `pnpm lint`. And `@testing-library/user-event` under jsdom does
not emit a usable pointer-capture sequence, so the magnetic behaviour would remain
weakly covered after paying for all of it.

Two hazards are recorded here because they constrain the decision rather than the
implementation. `toOffsets` reads `end <= start` as crossing midnight and adds a
full day (`daytime.ts`); since `Settings.tsx` passes `null` for an error
range, a backwards edge drag routed through `toOffsets` would make the window
vanish mid-gesture. And `useBlocks` sets no `staleTime` while
`refetchOnWindowFocus` is on globally (`main.tsx`), so every refetch returns a
fresh array identity and re-runs the seeding effect at `Settings.tsx`,
meaning an alt-tab back to the browser mid-drag would overwrite the window unless
`edited.current` is already set.

## 2. Options Considered

### Snap semantics

#### Option A: Grid plus flush (chosen)

A position is legal when the dragged edge lands on the half-hour grid, **or** the
window sits flush against a block boundary or the day's own edge. Length is always
preserved through a body drag.

- Blast radius: definitional. It changes M2, M4, M5 and M6 of the plan, not the
  files touched.
- Complexity: one extra candidate set in the placement function.
- Risk: the set of reachable positions is larger than "every half hour", so the
  times shown can include a block's odd boundary, for example 10:40.
- Precedent: it is what the user's own analogy does. In a video editor, clips snap
  to the time ruler and to the edges of other clips, which is why trimming leaves
  no gap.

#### Option B: Normalise on grab

The first moment an off-grid window is touched it snaps clean: start to the nearest
half hour, length to the nearest multiple of 30 minutes.

- Simplest rule to state and to implement.
- Rejected because parking against an off-grid block then leaves an unusable
  sliver (in the worked example, 10 minutes between 10:30 and 10:40), and because
  grabbing a window would silently rewrite it before the user has moved anything.

#### Option C: Half-hour steps only

The grid is relative. A drag moves the window by multiples of 30 minutes from
wherever it started, and absolute position is never normalised.

- Closest to the literal original request, "increments of 0.5 hr".
- Rejected because a 09:22 window drags to 09:52 and 10:22 and can never reach
  09:30, so odd times are permanent, and because the user explicitly chose a
  wall-clock grid during discovery.

### Handle placement

#### Option D: Unclipped overlay layer (chosen)

Wrap the bar in a `relative` container. Blocks stay inside the existing
`overflow-hidden` bar. The preview window and its handles move to a sibling layer
that spans the same box and does not clip, so handles may overhang the window's
edges.

- Blast radius: one wrapper element in `DayTimeline`.
- Gives the body a full-width grab area even at minimum length, because the handles
  sit outside the rectangle rather than eating into it.
- Requires the overlay to be `pointer-events-none` with the window and handles
  `pointer-events-auto`, or the `title` tooltips on blocks (`DayTimeline.tsx`)
  stop working.

#### Option E: Handles inset within the window

No structural change. Rejected: at minimum length two 8 pixel handles leave no body
to grab, and a window at offset 0 or at the day's end loses a handle to the bar's
clipping.

#### Option F: Make the bar taller

Rejected: it addresses vertical targeting, and both real constraints, horizontal
width and clipping, are unaffected.

### Implementation structure

#### Option G: Humble component (chosen)

All geometry as pure functions in `daytime.ts`. `DayTimeline` holds a ref and
pointer handlers that convert pixels to minutes, call those functions, and emit the
result.

- Blast radius: `DayTimeline.tsx`, `Settings.tsx`, `daytime.ts`, and new cases in
  `daytime.test.ts`.
- Complexity: low. No new dependency, no new file.
- Build versus buy: build. Nothing is bought.
- Cost: none. No inference, no runtime service, no bundle growth.
- Risk: roughly 60 lines of pointer wiring are untested by construction.

#### Option H: Extracted `useRangeDrag` hook

The same pure core, with pointer plumbing lifted into a new `lib/useRangeDrag.ts`.
Rejected: the untested surface is identical in size and merely relocated, and the
abstraction pays for itself only if a second draggable timeline appears. None is
planned, and `DayTimeline` has one call site.

#### Option I: Build on `@dnd-kit/core`

Reuse a dependency already present. Rejected on evidence. `TaskList.tsx`
configures `DndContext` with `onDragEnd` only, no `onDragMove`, no custom
modifiers, no custom collision detection, and `@dnd-kit/modifiers` is not in the
lockfile. dnd-kit models discrete drop targets resolved at drop time; this feature
needs a continuous value recomputed on every pointer move against a custom
constraint solver, and resize is not a dnd-kit concept at all. It would require a
custom sensor plus a custom modifier plus a separate mechanism for the handles, so
the pointer loop gets written regardless, with a context to pay for.

### Test harness

#### Option J: Pure functions only (chosen)

Cover the geometry exhaustively in `daytime.test.ts`; verify the wiring by hand.

#### Option K: Add jsdom and testing-library

Rejected on cost against value, for the reasons in Context: four devDependencies
and three config changes against a documented stance, buying coverage of the
wiring but not of the drag behaviour, which is the part worth testing.

## 3. Decision

**Options A, D, G and J.** Concretely:

### Legal positions

Let `D` be `dayDurationMinutes` and let all arithmetic be in offsets, never clock
strings (plan M9).

- **Grid.** `phase = (30 - (parseClock(dayStart) % 30)) % 30`, and
  `G = { phase + 30k } ∩ [0, D]`. For a day starting at 09:00, `phase` is 0 and `G`
  is every half hour. For 09:15, `G` is offsets 15, 45, 75 and so on, which is
  09:30, 10:00, 10:30 on the clock.
- **Anchors.** `A = {0, D} ∪ { b.start_offset_minutes } ∪ { b.end_offset_minutes }`
  over all existing blocks.
- Candidate positions for any dragged edge are `G ∪ A`, and the 30 minute minimum
  length outranks both: a candidate that would leave a window shorter than 30
  minutes is excluded, which is why a 09:15 day cannot reach the window `[0, 15]`.

### Body drag

Length `L` is preserved. Let `s_raw` be the gesture's anchor start plus the pointer
delta in minutes. Candidate starts are the union of three sets, clamped to
`[0, D - L]`:

- start on the grid, `{ g ∈ G }`
- start flush to an anchor, `{ a ∈ A }`
- end flush to an anchor, `{ a - L : a ∈ A }`

Legal candidates are those whose `[s, s + L]` overlaps no block, tested with the
existing `findOverlap`, whose half-open comparison matches the server's
`_reject_overlap` (`settings_routes.py`) exactly. The window takes the legal
candidate nearest `s_raw`, ties resolving in the direction of travel. The pop past
a block therefore fires midway between the two parked positions, as plan M6 states.

When no legal candidate exists, because no free stretch is long enough to hold `L`,
the window falls back to the nearest candidate from `G ∪ A` without the legality
filter, and the existing invalid styling plus disabled Add block apply. That state
is reachable only from typed input, since a magnetic drag cannot create it.

### Edge drag

Edges never jump (plan M7). For a legal window every block lies entirely to one
side of it, so the barriers are well defined:

- Start handle: candidates are `(G ∪ A) ∩ [barrier_left, end - 30]`, where
  `barrier_left` is the greatest `b.end_offset_minutes` at or below the current
  start, or 0.
- End handle: candidates are `(G ∪ A) ∩ [start + 30, barrier_right]`, where
  `barrier_right` is the least `b.start_offset_minutes` at or above the current
  end, or `D`.

The nearest candidate to the pointer wins. Because anchors are candidates, an edge
dragged into a neighbour comes to rest exactly flush with it.

### Structure

- New pure functions in `frontend/src/lib/daytime.ts`, following the file's
  existing conventions: inline structural parameter types so the file keeps its
  zero imports, `null` rather than a sentinel for "nothing to do", and a JSDoc
  block explaining the decision rather than the mechanics.
- `freeGaps(blocks, dayDurationMinutes)` is extracted, and `firstFreeGap` is
  rewritten on top of it rather than generalised in place, so its existing tests
  at `daytime.test.ts` continue to pin its behaviour unchanged (plan S5).
  **Withdrawn 2026-10-23.** The candidate-set formulation above removes the need
  for `freeGaps`: legality is decided per candidate by `findOverlap`, the dead-end
  case falls out of an empty filtered set, and edge barriers come from block
  boundaries directly. `firstFreeGap` is left entirely untouched instead, which
  satisfies S5 more strongly than rewriting it would. The clause is struck rather
  than deleted because it was part of the decision as accepted; see plan §12.5.
- `DayTimeline` gains a `relative` wrapper. The bar keeps `overflow-hidden` for
  blocks. The preview window and its two handles render in a sibling
  `absolute inset-0` layer that is `pointer-events-none`, with the window and
  handles `pointer-events-auto` so block tooltips survive.
- `DayTimeline` emits offsets through a new optional `onPreviewChange`.
  `BlocksEditor` converts them once with `offsetToClock` and writes `from` and
  `to`. `toOffsets` is never called inside a gesture.
- `edited.current = true` is set on **pointer down**, not on first move, so a
  window-focus refetch arriving during a press cannot re-seed the form.
- Native pointer events with `setPointerCapture`. No new dependency.

## 4. Consequences

**Accepted.**

- Reachable times are no longer only half hours. A window parked against a block
  that starts at 10:40 reads 10:40, which is correct and is the point, but it means
  the legend can show times the grid alone would not produce.
- About 60 lines of pointer wiring in `DayTimeline` ship without automated test
  coverage. The geometry beneath them is fully covered. This is a deliberate trade,
  recorded so it is not rediscovered as an oversight.
- `DayTimeline` gains a DOM ref, pointer handlers and keyboard handlers. It is the
  first component in `frontend/src` to hold any of them; greps for
  `getBoundingClientRect`, `setPointerCapture` and `onPointer*` return zero hits
  today. There is no house pattern to match and none to contradict.
- The component gains the first `role`, `tabIndex` and `aria-value*` attributes in
  the frontend. Three `aria-label`s and one `aria-hidden` are the entire current
  ARIA surface.

**Required by this decision.**

- Plan v1's M2, M4, M5 and M6 are corrected in place to the grid-plus-flush rule.
  This resolves a contradiction rather than changing scope, so the plan is updated
  and its `updated` date bumped rather than superseded by a v2.
- The plan's §5 note that handles take precedence over the body in a narrow window
  is largely obsolete: overhanging handles leave the body grabbable at minimum
  length.

**Unaffected.**

- No backend change, no migration, no new API surface. `_reject_overlap` remains
  the authoritative check and will reject anything the frontend lets slip, surfaced
  as a 409 at `Settings.tsx`.
- `firstFreeGap`, `findOverlap`, `clockToOffset` and `offsetToClock` keep their
  current behaviour and tests. `endForStart` and `clampEndToDay` are untouched and
  remain the repair path for typed input only; neither is reusable here, since both
  route through `toOffsets` and inherit the midnight rule.

**Deferred.**

- Dragging saved blocks, which plan v1 lists as W1 and which would need a
  `PATCH /settings/blocks/{id}`. The unused `skip_id` parameter already present in
  `_reject_overlap` (`settings_routes.py`) is where it would land.
- A DOM test harness. Revisit if the untested wiring produces a defect.
- Two pieces of dead code the survey turned up and this change does not touch: the
  `zero_length` branch in `toOffsets` is unreachable, because line 69 has already
  guaranteed `end > start`, and with it the "Pick an end time after the start"
  fallback at `Settings.tsx`.
