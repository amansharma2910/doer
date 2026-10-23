---
type: implementation_plan
feature: timeline-window-drag
version: 1
status: approved
unplanned: false
linear_issue: null
created: 2026-10-21
updated: 2026-10-23
---

# Direct manipulation of the preference block window on the day timeline

## 1. Problem Statement

Defining a preference block on the Settings page means typing two wall-clock times
into a pair of time fields. (Those were native `<input type="time">` controls when
this plan was written; they became the custom 24-hour `ClockInput` on 2026-10-23,
which changes nothing about the problem below.) The day timeline above them
(`DayTimeline`) draws the resulting range as a dashed window, so the feedback loop
exists, but it runs one way: the bar reports, it does not accept input.

That is the wrong direction for the decision being made. Choosing when deep work
sits in a day is a spatial judgement about where the gaps are, made against the
blocks already on the bar. Expressing it as two clock strings forces a translation
the interface could do itself, and the translation is error-prone: the current code
carries `endForStart`, `clampEndToDay`, and a deliberate clamp deferred until the
edit settles, precisely because digit-by-digit time entry produces invalid
intermediate states that have to be caught and repaired. (That clamp now fires
through `ClockInput`'s `onCommit` rather than a native `onBlur`; the hazard it
guards against is unchanged.)

The window is already drawn in the right place, already validated against
neighbours, and already the thing the user is looking at. It should be the control.

## 2. Business Objective and End Goal

Doer's capacity model is only as good as the focus blocks it is given. The
dashboard tells a user with no focus time that it cannot judge what fits, so block
definition is on the critical path to the product working at all, and it happens
during setup, when the user has the least invested and is most likely to abandon.

The end goal is that marking out a day's shape takes a gesture rather than a form.
Specifically: fewer attempts per block added, and no state where the user is shown
an error for a range they were in the middle of expressing.

A counter-consideration recorded deliberately: this improves the create path only.
Adjusting a block that already exists still means Remove then re-add, and that is
plausibly where the friction will show up next. See Non-Goals.

## 3. Users and UX

Single user, on the Settings page, usually during first setup but also when a
routine changes.

The dashed preview window becomes directly manipulable:

- **Grab the body** and slide the whole range, keeping its length.
- **Grab either edge** and grow or shrink that side, keeping the other edge fixed.
- The **edge being dragged** lands on a wall-clock half hour (09:00, 09:30,
  10:00) or flush against a block edge or the end of the day. The opposite edge
  follows: anchored during a resize, carried along during a slide. So a window
  whose length is not a multiple of 30 keeps one edge off the half hours
  permanently, which is correct, since a drag never silently changes a length the
  user typed.
- The From and Until inputs stay, and track the drag live. They remain the
  keyboard path for jumping to an arbitrary time.
- Dragging never saves. The user still presses **Add block**, as today.

The defining behaviour is that **a drag cannot produce an illegal window**. Sliding
the body into occupied time does not overlap it and does not push it aside. The
window parks flush against the neighbour, and if the pointer carries far enough
past it, the window pops to the free space on the other side, keeping its length.
This is magnetic placement, resolved live during the drag, not on release:

```
pointer →

[░░░]  ▓▓▓▓▓        dragging right
   [░░░]▓▓▓▓▓        parks, flush against the block
       ▓▓▓▓▓[░░░]    pointer carried past it, pops across
```

Edge drags do not jump. An edge pulled into occupied time stops at the boundary,
so the window grows until it is flush and no further. Jumping an edge would move
the window rather than resize it.

Accessibility is not an afterthought here, because a drag-only control has no
keyboard path at all for the handles. The window body and both handles are
focusable; left and right arrows move the focused element by one half-hour step
under exactly the same placement rules as the pointer.

## 4. Functional Requirements

**Must**

- M1. The dashed preview window in `DayTimeline` responds to pointer drags on its
  body (slide, length preserved) and on either edge handle (resize, opposite edge
  anchored).
- M2. A dragged edge comes to rest on a **candidate position**, which is either
  the **wall-clock half-hour grid**, offsets `o` where
  `(parseClock(dayStart) + o) % 30 === 0`, or an **anchor**: offset `0`, offset
  `dayDurationMinutes`, or the start or end of an existing block. Anchors are what
  make a flush position reachable when a block does not happen to sit on a half
  hour, which is the common case. Reaching any candidate is subject to M4. See
  ADR 0002 for why the grid alone could not work.
- M3. The window is clamped to `[0, dayDurationMinutes]`. It can never extend past
  either end of the day.
- M4. Minimum window length is 30 minutes, and **the floor outranks the anchors
  M2 adds**. On a day starting at 09:15 the grid is offsets 15, 45, 75 and so on,
  so the day's own start at offset 0 is 15 minutes from its nearest neighbour: a
  window may sit at `[0, 45]` but never at `[0, 15]`. The same holds at the day's
  end, and against a block whose boundary sits less than 30 minutes from the
  anchored edge. An edge dragged toward the anchored edge stops at the last
  candidate leaving 30 minutes, and does not collapse or swap.
- M5. **Body drag is magnetic**, and preserves length `L`. Let `s` be the
  gesture's anchor start plus the pointer delta, in minutes. Candidate starts,
  clamped to `[0, dayDurationMinutes - L]`, are the union of three sets: the start
  on the grid, the start on an anchor, and the **end** on an anchor, that is
  `{ a - L }`. The third is what lets the window sit flush against a block on its
  right. A candidate is legal when `[s, s + L]` overlaps no block, tested with the
  existing `findOverlap`. The window takes the legal candidate nearest `s`, ties
  resolving in the direction of travel. The window overlaps nothing at any point
  during a body drag.
- M6. Consequences of M5, called out because they are the behaviour being approved.
  Pushing into a block parks the window exactly flush against its near edge, with
  no sliver left over, because that block's boundary is itself a candidate. The pop
  to the far side fires when `s` passes the midpoint between the two parked
  positions,
  which for a block `[bs, be]` and a window of length `L` is `(bs - L + be) / 2`,
  not the midpoint of the block itself. A single continuous drag may clear several
  blocks in turn, parking and popping at each, because `s` moves continuously with
  the pointer. The window stays parked only when **no** free stretch beyond the
  obstruction, anywhere in the remaining day, is long enough to hold `L`; a
  too-short gap is skipped rather than squeezed into.
- M7. **Edge drags do not jump.** Candidates for the dragged edge are bounded by
  the nearest block boundary lying beyond it, and by the 30 minute floor at the
  anchored end. Because that boundary is itself an anchor, an edge dragged into a
  neighbour comes to rest exactly flush with it.
- M8. The placement rules live in **pure functions in `src/lib/daytime.ts`**, taking
  offsets and blocks and returning offsets, with no React and no DOM. The component
  converts pixels to minutes and calls them.
- M9. All drag arithmetic is done in **offset space**. Clock strings are produced
  once, at the end, via `offsetToClock`. `toOffsets` is not used inside a drag: its
  rule that `end <= start` means the range crosses midnight is correct for typed
  input and wrong for a gesture, where it would turn a backwards edge drag into a
  23.5 hour range and a spurious `past_day_end` error.
- M10. A drag writes through to the existing `from` and `to` state in
  `BlocksEditor`, so the time inputs, the duration readout, the collision message
  and the Add block button all update with no second source of truth.
- M11. A drag sets `edited.current = true`, so the `firstFreeGap` seeding effect
  does not move the window out from under the user the next time `blocks` changes.
- M12. Pointer events with `setPointerCapture`, so a drag survives the cursor
  leaving the 36 pixel tall bar. Text selection is suppressed for the duration.
- M13. New `DayTimeline` props are **optional**. The component keeps working as a
  read-only bar when no change handler is passed.

**Should**

- S1. The window body and both edge handles are keyboard focusable. Left and right
  arrows move the focused element by one 30 minute step, obeying M2 to M7.
- S2. The handles carry `role="slider"` with `aria-valuemin`, `aria-valuemax`,
  `aria-valuenow` and `aria-valuetext` reading as a clock time. The body carries a
  label describing the whole range.
- S3. Cursor affordances: `grab` and `grabbing` on the body, `ew-resize` on the
  handles, so the control is discoverable without a tooltip.
- S4. Unit tests in `src/__tests__/daytime.test.ts` for the placement functions,
  covering: snapping against a non-half-hour day start, clamping at both ends of
  the day, the 30 minute floor, parking flush, popping across, the no-space-ahead
  dead end, and edge drags stopping at a boundary.
- S5. The existing `firstFreeGap` seed is unchanged, so the window still appears in
  a sensible place before the user touches it.

**Could**

- C1. Home and End to send the focused window to the first or last legal position.
- C2. A live tooltip or label on the window showing its times during the drag,
  rather than relying on the legend and the time inputs below.
- C3. Click on empty track to move the window there in one action.

**Won't**

- W1. Dragging existing saved blocks. There is no `PATCH /settings/blocks/{id}`
  endpoint, and adding one is a separate piece of work. The unused `skip_id`
  parameter already in `_reject_overlap` is where it would land.
- W2. Displacing, resizing or reordering neighbouring blocks on collision.
- W3. Zoom, pan, or any timeline scale other than the whole day.
- W4. Precision finer than 30 minutes, including a modifier key for it.
- W5. Changing the day shape (start time, duration) by dragging the bar's own ends.
- W6. Saving on drop. Add block stays an explicit action.
- W7. Touch-specific gestures beyond what pointer events give for free.

## 5. Non-Functional Requirements

- No backend change, no schema change, no migration, no API change.
- No new dependency. `@dnd-kit/core` is present for task reordering but models
  discrete sortable items, not a continuously constrained range; native pointer
  events are the smaller tool here.
- Pixel-to-minute conversion reads the bar width once per drag via
  `getBoundingClientRect()` at pointer down. No `ResizeObserver`, no layout read
  per move event.
- Placement is recomputed per pointer move against at most a handful of blocks, so
  it stays a linear scan with no memoisation needed.
- On a 15 hour day a 30 minute window is about 3.3% of the roughly 620 pixel bar,
  near 21 pixels; on a 24 hour day, near 13 pixels. Handles need a grab zone of at
  least 8 pixels, so they cannot fit inside a minimum-length window. Per ADR 0002
  the preview and its handles move to an unclipped overlay layer and the handles
  overhang the window's edges, which leaves the body grabbable at any length and
  keeps a handle from being clipped away at the day's edges.

## 6. Inputs and Outputs

**Inputs**

- Pointer position relative to the bar, converted to an offset in minutes.
- Which element is being dragged: body, start handle, or end handle.
- The window's offsets at pointer down, as the anchor for the gesture.
- `blocks`, `dayStart`, `dayDurationMinutes`, already props of `DayTimeline`.
- Arrow key presses on a focused body or handle.

**Outputs**

- A `{ start, end }` offset pair, emitted on every move, via a new optional
  `onPreviewChange` prop.
- `BlocksEditor` converts that pair to `from` and `to` clock strings with
  `offsetToClock`, which feeds the time inputs, the duration line, and validation
  unchanged.
- Nothing is written to the API until Add block is pressed.

## 7. Success Criteria

1. A block can be defined end to end with the pointer alone, never touching the
   time inputs, and the inputs show the matching times throughout.
2. No body drag, from any start position, in any direction, at any speed, produces
   a window that overlaps an existing block.
3. No drag produces a window shorter than 30 minutes, longer than the day, or
   positioned outside it. The floor holds at the day's own edges too, so on a
   09:15 day no gesture reaches the 15 minute window `[0, 15]`.
4. Every reachable window position has its dragged edge on a wall-clock half hour
   or on an anchor (a block boundary, or the day's own start or end), where
   criterion 3 still permits it.
5. Tab reaches the window and both handles; arrows move them by 30 minutes under
   the same rules as the pointer.
6. The placement functions are covered by unit tests under `pnpm test`, including
   a day whose start is not on a half hour.
7. `pnpm lint` passes and `DayTimeline` still renders correctly with no change
   handler passed.

## 8. Failure Handling and Fallbacks

- **No legal position exists**, because no free gap is long enough to hold the
  window: the body drag falls back to the nearest candidate without the legality
  filter, so it still moves in clean steps, with the existing red invalid styling
  and a disabled Add block. This is reachable only from a range typed into the
  inputs, since a magnetic drag can never create it.
- **The preview is already invalid** when a drag starts, again only reachable from
  typed input: the first move snaps it to the nearest legal position, which
  resolves the error rather than preserving it.
- **The preview is null**, when the typed range cannot be read as offsets at all:
  there is no window to drag and the bar behaves as it does today. The time inputs
  remain the way out.
- **Pointer capture is lost** (browser interruption, window blur): the drag ends
  where it is. The window keeps its last legal position; nothing is left mid-gesture.
- **A zero-width bar**, before layout settles: the drag is a no-op rather than a
  division by zero.
- **Blocks change under an active drag**, which only a second tab can cause: the
  drag continues against the block list it started with and the next move
  recomputes against the new one. Validation on Add block is authoritative, and the
  server rejects overlaps regardless.

## 9. Non-Goals

- Editing saved blocks by direct manipulation (W1). The gap this leaves is real and
  is the obvious follow-up: today, changing a block means Remove then re-add.
- Any change to how capacity, focus time, or the comfortable load threshold are
  computed.
- Any change to the Add, Delete or day-shape endpoints.
- Replacing the From and Until inputs. They are additive to the drag, not replaced
  by it.
- Applying the same control to any other timeline in the product.

## 10. Open Questions

1. The magnetic crossover in M6 fires midway between the two parked positions,
   which is the conventional behaviour and feels responsive. The alternative is to
   require the pointer to fully clear the block before the window pops, which is
   more literal and less lively. Worth a look once it is on screen.
2. Whether the handles should appear only on hover or always show as grab marks.
   There are no handles today and the window has no hover treatment at all, so
   either is new. Always showing teaches the affordance; hiding keeps the bar
   clean. Leaning toward always showing, on the grounds that a control nobody
   finds is worth nothing.
3. Whether arrow keys should step candidate to candidate, as the pointer does, or
   by a single minute with a modifier for the coarse step. The plan assumes
   candidate to candidate, to match the pointer, which means the keyboard reaches
   every half hour and every block edge but no arbitrary minute. The From and
   Until inputs remain the only path to one.

## 11. Chosen Approach

Decided 2026-10-22 and recorded in full in
`docs/adr/0002-magnetic-timeline-window-drag.md`. Four choices, each against two
rejected alternatives:

1. **Grid plus flush**, over normalising the window on grab and over relative
   half-hour steps. The grid alone could not coexist with length preservation and
   flush parking, because off-grid windows and off-grid blocks are both reachable
   through four ordinary routes. Adding block boundaries and the day's edges as
   candidate positions resolves it, and matches the video-editor behaviour the
   request invoked: clips snap to the ruler and to each other. M2, M4, M5, M6 and
   M7 above are corrected to this rule.
2. **An unclipped overlay layer** for the preview and its handles, over insetting
   handles inside the window and over a taller bar. A 30 minute window is 13 to 21
   pixels wide and the bar clips its own contents, so handles must overhang.
3. **The humble component**, over an extracted `useRangeDrag` hook and over
   building on `@dnd-kit/core`. All geometry goes in pure functions in
   `daytime.ts`; `DayTimeline` only converts pixels to minutes and calls them. The
   hook relocates the untested surface without shrinking it. dnd-kit resolves
   discrete drop targets at drop time and has no concept of resize, so its pointer
   loop would be rewritten regardless.
4. **No DOM test harness.** The geometry is covered exhaustively as pure
   functions; the roughly 60 lines of pointer wiring are verified by hand. A
   harness costs four devDependencies and three config changes against a
   documented stance, and `user-event` under jsdom cannot emit a real
   pointer-capture sequence, so it would not cover the drag anyway.

Two implementation constraints follow from the survey and are binding:

- `freeGaps(blocks, dayDurationMinutes)` is extracted and `firstFreeGap` is
  rewritten on top of it, rather than generalised in place, so S5 holds and the
  existing tests at `daytime.test.ts:133-170` keep pinning its behaviour.
- `edited.current = true` is set on **pointer down**, not on first move.
  `useBlocks` sets no `staleTime` and `refetchOnWindowFocus` is on globally, so
  every refetch hands back a fresh array identity and re-runs the seeding effect.
  Alt-tabbing back to the browser during a press would otherwise re-seed the form
  mid-gesture.

## 12. QA

Criteria are prefixed `AC-TWD` because `AC-01` to `AC-21` are already claimed by
plan `daily-task-planner` v1 and are referenced by number across the backend test
suite.

### 12.1 Acceptance Criteria

**Candidate positions**

- AC-TWD-01. For a day starting 09:00 with `dayDurationMinutes = 900` and one block
  at offsets 100 to 160, the candidate set is exactly
  `{0, 30, 60, ..., 900} ∪ {100, 160}`. Duplicates are collapsed: offset 0 and
  offset 900 appear once each despite being both grid values and anchors.
- AC-TWD-02. For a day starting 09:15, the grid is offsets 15, 45, 75 and so on,
  because `(555 + 15) % 30 === 0`. Offset 0 is not a grid value and is a candidate
  only as an anchor.

**Body drag**

- AC-TWD-03. Length is preserved exactly through any body drag, including a length
  that is not a multiple of 30. A 38 minute window is 38 minutes at every position
  it reaches.
- AC-TWD-04. Whenever at least one legal candidate exists, no body drag at any
  pointer position produces a window overlapping a block.
- AC-TWD-05. The window parks exactly flush, leaving no sliver, against a block
  that does not sit on the grid. Day 09:00, block at 100 to 160, `L = 60`: the
  parked positions are start 40 and start 160, not start 30 and start 180.
- AC-TWD-06. The pop to the far side fires at `(blockStart - L + blockEnd) / 2`.
  For the AC-TWD-05 case that is offset 100: at `s = 99` the window is at 40, at
  `s = 101` it is at 160, and at exactly `s = 100` the tie resolves in the
  direction of travel.
- AC-TWD-07. Off-grid length and flush parking compose. Day 09:00, block at 100 to
  160, window 22 to 60 (`L = 38`): the parked positions are start 62 (ending
  exactly at 100) and start 160, and the crossover is at `s = 111`.
- AC-TWD-08. A free gap shorter than `L` is skipped, not squeezed into. The window
  never changes length to fit.
- AC-TWD-09. When no free stretch beyond the obstruction is long enough to hold
  `L`, the window stays parked however far the drag continues.
- AC-TWD-10. When no legal candidate exists anywhere, because `L` fits nowhere, the
  window still moves candidate to candidate without the legality filter, is styled
  invalid, and Add block is disabled.
- AC-TWD-11. A block's own `start_offset_minutes` is a candidate start and is
  rejected by the legality filter, since `[b.start, b.start + L]` overlaps that
  block for any positive `L`. The filter is applied to the full candidate union,
  never assumed to be pre-vetted.

**Edge drag**

- AC-TWD-12. An edge never jumps. With free space beyond a block, an edge dragged
  toward it stops at that block and does not reappear on the far side.
- AC-TWD-13. An edge dragged into a neighbour comes to rest exactly flush with it,
  including when the neighbour's boundary is off the grid.
- AC-TWD-14. The window never shrinks below 30 minutes, never collapses to zero,
  and the edges never swap.
- AC-TWD-15. The 30 minute floor outranks the anchors. On a day starting 09:15, no
  gesture reaches the window `[0, 15]`, and `[0, 45]` is reachable.

**Bounds and state**

- AC-TWD-16. No gesture produces a window extending outside `[0, dayDurationMinutes]`.
- AC-TWD-17. A drag writes through to `from` and `to`, and all five derived
  consumers update in the same render: the time inputs, the duration readout, the
  collision message, the `preview` prop, and the `disabled` state of Add block.
- AC-TWD-18. `edited.current` is set on pointer down, not on first move. A blocks
  refetch arriving between pointer down and pointer up does not re-seed the form.
- AC-TWD-19. `toOffsets` is not called during a gesture. A backwards edge drag
  never makes the window disappear, which is what routing through its
  midnight-crossing rule would cause.
- AC-TWD-20. `DayTimeline` renders exactly as it does today when no
  `onPreviewChange` is passed: no handles, no focusable elements, no behaviour
  change.
- AC-TWD-21. The `title` tooltips on existing blocks still appear on hover, proving
  the overlay layer does not swallow pointer events.

**Keyboard and assistive technology**

- AC-TWD-22. Tab reaches the window body and both handles, in left-to-right order.
- AC-TWD-23. Left and right arrows move the focused element one candidate at a
  time, under the same placement rules as the pointer, including parking and
  popping.
- AC-TWD-24. Each handle exposes `role="slider"` with `aria-valuemin`,
  `aria-valuemax`, `aria-valuenow` and an `aria-valuetext` reading as a clock time.

**Regression**

- AC-TWD-25. Every existing test in `daytime.test.ts` passes unmodified. In
  particular `firstFreeGap`'s cases at lines 133 to 170 and the touching-is-not-
  overlapping case at lines 119 to 122.
- AC-TWD-26. `pnpm lint` passes and `frontend/package.json` gains no dependency.

### 12.2 Evaluation Criteria

The feature is done when **both** gates are green. Neither substitutes for the
other.

1. **Automated.** Every acceptance criterion above that can be expressed as a pure
   function test is implemented in `frontend/src/__tests__/daytime.test.ts` and
   passes under `pnpm test`, alongside the existing suite unmodified.
2. **Manual.** Every numbered step of Flow 16 in `docs/user_testing_documentation.md`
   passes. A failed manual step blocks the feature exactly as a failed automated
   test does. This is the agreed gate for the roughly 60 lines of pointer wiring
   that ADR 0002 accepted would ship without automated coverage; without it that
   surface has no gate at all.

Criteria AC-TWD-17 through AC-TWD-24 are reachable only through gate 2, since the
suite has no DOM environment.

### 12.3 Automated Test Cases

Grouped by the function under test. Style follows the existing file: `describe`
blocks named as behavioural sentences, `it.each` tables for parametrics, local
fixture factories, and a comment on any case whose reason is not obvious.

**`candidatePositions(dayStart, dayDurationMinutes, blocks)`**

- T-TWD-01. Day start on a half hour yields the plain grid plus the day's edges.
- T-TWD-02. Day start at 09:15 yields offsets 15, 45, 75, with offset 0 present as
  an anchor only.
- T-TWD-03. Block boundaries appear as candidates.
- T-TWD-04. A block boundary that coincides with a grid value appears once.
- T-TWD-05. No candidate falls outside `[0, dayDurationMinutes]`.
- T-TWD-06. Unsorted block input produces the same result as sorted, matching the
  defensiveness `firstFreeGap` already has and its test at line 163.
- T-TWD-07. Zero blocks yields grid plus the two day edges.

**`placeWindow(start, length, delta, dayStart, dayDurationMinutes, blocks)`**

- T-TWD-08. Unobstructed drag lands on the grid.
- T-TWD-09. Length preserved for a 30 minute window.
- T-TWD-10. Length preserved for a 38 minute window across six consecutive
  positions.
- T-TWD-11. Parks flush before an off-grid block (AC-TWD-05 numbers).
- T-TWD-12. Pops across at the exact midpoint (AC-TWD-06 numbers), as an `it.each`
  table over `s = 99, 100, 101`.
- T-TWD-13. Off-grid length plus flush parking (AC-TWD-07 numbers).
- T-TWD-14. Direction of travel breaks the midpoint tie, both directions.
- T-TWD-15. A gap of 20 minutes is skipped by a 60 minute window.
- T-TWD-16. Dead end: a 60 minute window with nothing ahead that fits stays parked
  at the same offset for three increasing deltas.
- T-TWD-17. No legal candidate anywhere: the result still moves and is reported as
  overlapping.
- T-TWD-18. A candidate equal to a block's `start_offset_minutes` is filtered out.
- T-TWD-19. Window already at offset 0, dragged left, does not move.
- T-TWD-20. Window already at the day's end, dragged right, does not move.
- T-TWD-21. Zero blocks: every grid position is reachable.

**`resizeWindowEdge(edge, start, end, delta, dayStart, dayDurationMinutes, blocks)`**

- T-TWD-22. Start handle grows left onto the grid.
- T-TWD-23. Start handle stops exactly flush at a preceding block's off-grid end.
- T-TWD-24. Start handle stops at the 30 minute floor and does not cross the end.
- T-TWD-25. End handle, each of the three above, mirrored.
- T-TWD-26. End handle reaches `dayDurationMinutes` exactly.
- T-TWD-27. No edge drag jumps a block even when free space lies beyond it.
- T-TWD-28. On a 09:15 day the end handle cannot produce `[0, 15]`, and can produce
  `[0, 45]`.

**Regression**

- T-TWD-29. The existing `daytime.test.ts` file is unmodified above the new
  `describe` blocks, and passes.

### 12.4 Edge Cases to Handle

1. A window whose length is not a multiple of 30. Confirmed in discovery as
   supported rather than designed out, so one edge stays off the half hours
   permanently. **Corrected 2026-10-23:** the stated reason, that the time inputs
   keep minute granularity, no longer holds. From and Until now accept only `:00`
   and `:30`. The edge case itself stands, reached instead through off-grid stored
   blocks, `firstFreeGap` seeding from a block's end, and `endForStart`.
2. A block whose boundaries are not on the half hours, which the server permits
   (`backend/doer/schemas/day.py:32`) and which makes anchors necessary.
3. A day whose start is not on a half hour, so the grid is phase-shifted.
4. A day whose duration is not a multiple of 30, which `step={0.5}` on the hours
   field advises against but does not prevent.
5. A blocks refetch arriving mid-gesture, which `refetchOnWindowFocus` makes
   reachable by alt-tabbing away and back.
6. A 30 minute window on a 24 hour day, about 13 pixels wide.
7. A window at offset 0 or at the day's end, where the bar's own clipping would
   otherwise remove a handle.
8. Pointer capture lost to a browser interruption.
9. A bar of zero width, before layout settles.
10. A window that currently overlaps because it was typed that way, then dragged.

### 12.5 Flagged: one ADR requirement is now redundant

ADR 0002 requires extracting `freeGaps(blocks, dayDurationMinutes)` and rewriting
`firstFreeGap` on top of it. That requirement comes from the earlier
gap-scanning formulation and the candidate-set formulation in the same ADR removes
the need for it: legality is decided per candidate by `findOverlap`, the dead-end
case falls out of an empty filtered set, and the edge barriers come from block
boundaries directly. Nothing in this QA section needs `freeGaps` to exist.

**Decided 2026-10-23: the `freeGaps` extraction is dropped, and `firstFreeGap`
and its tests are left entirely untouched.** That satisfies S5 more strongly than
rewriting it would, and removes a function nothing calls. ADR 0002 carries a dated
withdrawal of the clause rather than a deletion of it, so the decision as accepted
stays legible.
