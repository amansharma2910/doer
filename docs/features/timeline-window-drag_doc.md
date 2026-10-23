# Direct manipulation of the preference block window

## What it does

On the Settings page, under "How your day is split", the day is drawn as a single
bar with existing preference blocks in position and a dashed window showing the
block about to be added. That window is now the control, not just a readout.

- **Drag the body** to slide the range, keeping its length.
- **Drag either edge** to resize, with the opposite edge anchored.
- **Tab to it and use the arrow keys** for the same moves without a pointer.

A dragged edge comes to rest on a **candidate**: a wall-clock half hour, or an
**anchor**, meaning a block's boundary or one of the day's two ends. Anchors are
why "flush against the neighbour" works at all, since nothing obliges a stored
block to start on a half hour.

Body drags are **magnetic**: only positions overlapping no block are considered,
so pushing into a block parks the window flush against it, and carrying the
pointer far enough pops the window to the free space beyond. Edge drags are not
magnetic; an edge stops at a block boundary rather than jumping it, because
carrying the far side of the window along would be a move, not a resize.

Nothing is saved by dragging. Add block is still an explicit action, and the
From and Until fields remain, mirroring the window.

**Amended 2026-10-23.** Those fields used to be the only route to a time that was
neither a half hour nor a block edge. They are not any more: they now accept only
`:00` and `:30`, decided while fixing `time-inputs-show-12-hour-clock`. Odd times
still reach the window by three other routes, so the placement rules below are
unchanged. See `docs/fixes/fix_plan_time-inputs-show-12-hour-clock.md`.

## Implementation detail

### Where the logic lives

All placement is pure functions in `frontend/src/lib/daytime.ts`, which has no
React, no DOM, and no imports. `DayTimeline` does the one thing a pure function
cannot: turn pixels into minutes. This is the house pattern, not a new one, and it
is what makes the behaviour testable at all, since the Vitest suite runs in the
default node environment with no DOM (ADR 0002 declined to add one).

### The candidate model

For a day starting at `dayStart` and running `dayDurationMinutes`:

- **Grid.** `phase = (30 - parseClock(dayStart) % 30) % 30`, then every 30 minutes
  from `phase`. A day starting at 09:00 gives offsets 0, 30, 60; a day starting at
  09:15 gives 15, 45, 75, which are 09:30, 10:00, 10:30 on the clock.
- **Anchors.** Offset 0, offset `dayDurationMinutes`, and every block boundary.
- **Candidates.** Grid plus anchors, deduped and ascending.

The 30 minute minimum window length outranks the anchors. On a 09:15 day the
window `[0, 45]` is reachable and `[0, 15]` is not, even though offset 0 is a
legal position.

### Body drag

`slideWindow` preserves length `L` and builds candidate starts from three sets:
the start on the grid, the start on an anchor, and the **end** on an anchor
(`{a - L}`), the last being what lets the window sit flush against a block on its
right. Candidates overlapping a block are filtered out with `findOverlap`, and the
nearest surviving one to the pointer's implied position wins, ties going the way
the drag is headed.

That tie-break is what decides the pop. For a block `[bs, be]` and a window of
length `L`, the two parked positions are `bs - L` and `be`, so the window crosses
at `(bs - L + be) / 2`. For a block at offsets 100 to 160 and a 60 minute window
that is offset 100 exactly.

When no candidate is legal, because `L` fits nowhere, the legality filter is
dropped so the control still responds and the existing invalid styling does the
talking. Only typed input can produce that state.

### Edge drag

`resizeWindow` bounds the dragged edge by the 30 minute floor at the anchored end
and by the nearest block boundary beyond it. Because boundaries are candidates, an
edge dragged into a neighbour lands exactly flush.

The barrier is selected by reaching **past the anchored edge**, not by sitting
clear of the dragged one. The difference matters for a window that already
straddles a block, which typed input can produce: such a block is neither entirely
left of the window nor entirely right of it, and the obvious filter would miss it
and leave the barrier at the day's edge, letting the drag pass straight through
the block. Caught as written, the gesture produces no movement instead. The way
out of that state is a body drag, which snaps to a legal position, or the inputs.

### Keyboard

`stepWindow` and `stepEdge` move to the next candidate past the current position,
rather than calling `slideWindow` with a 30 minute delta. The distinction is not
cosmetic: a window parked flush against a block is already the candidate nearest a
small nudge, so a nudge would return it unchanged and the arrow key would read as
broken. Stepping always moves. It still obeys every placement rule, and the step
out of a parked position is precisely the pop to the far side.

### The overlay layer

`DayTimeline` renders three levels where it rendered one:

1. A `relative` wrapper establishing the shared box.
2. The bar, keeping `overflow-hidden`, now holding only the blocks.
3. A sibling `pointer-events-none absolute inset-0` overlay holding the preview
   window and its handles, which re-enable pointer events locally.

Both halves earn their place. A 30 minute window is about 13 pixels wide on a 24
hour day, so handles must straddle the window's edges rather than inset into it or
there is no body left to grab; and the bar's own clipping would shave a handle off
entirely at offset 0 or at the day's end. The `pointer-events-none` is equally
load-bearing: without it the overlay swallows every hover and the blocks' `title`
tooltips silently stop working.

### Gesture bookkeeping

- The gesture is held in a ref, not state, so a pointer move does not re-render on
  its own account.
- `pixelsPerMinute` and the window's offsets are captured at pointer down, and
  every move measures from that origin. Recomputing against the live preview each
  move would accumulate rounding and let the window drift from the cursor. The
  cost is that a layout reflow during a held drag leaves the conversion stale
  until release; that is the intended trade, not an oversight.
- `preventDefault` on pointer down suppresses the focus the press would otherwise
  grant, so focus is granted explicitly. Without it, grabbing a handle leaves the
  arrow keys unreachable.
- Handles are children of the window, so a captured move bubbles into the window's
  own handler. `moveGesture` stops propagation, or placement runs twice per frame.
- `endGesture` releases pointer capture explicitly. `pointerup` releases it
  implicitly, `pointercancel` does not reliably, and an element left capturing
  retargets the next press anywhere on the page.

### Why `toOffsets` is never called during a gesture

`toOffsets` reads `end <= start` as crossing midnight and adds a full day. That is
right for a time someone typed and wrong for a gesture: pulling an edge backwards
past its partner would become a 23.5 hour range, trip the `past_day_end` branch,
and make `Settings.tsx` pass `preview={null}`, so the window would vanish
mid-drag. Placement works in offsets only; clock strings are produced once, by
`offsetToClock`, on the way out.

### Why `edited.current` is set on pointer down

`useBlocks` sets no `staleTime` and `refetchOnWindowFocus` is on globally, so
every refetch returns a fresh array identity and re-runs the seeding effect that
calls `firstFreeGap` and overwrites `from` and `to`. Setting the flag on first
*move* would be too late: alt-tabbing away and back during a held press fires a
focus refetch with no pointer move in between, and the window would jump back to
the suggested position mid-gesture. It is set in `onPreviewChange` as well as in
`onGestureStart`, so the invariant is local to the write rather than split across
two callbacks a future caller could pair wrongly.

## Key files and entry points

| Concern | File |
|---|---|
| Placement geometry, all of it | `frontend/src/lib/daytime.ts` |
| Pointer and keyboard wiring, DOM layering | `frontend/src/components/DayTimeline.tsx` |
| Form state the drag writes through to | `frontend/src/pages/Settings.tsx`, `BlocksEditor` |
| Geometry tests | `frontend/src/__tests__/daytime.test.ts` |
| Markup structure tests | `frontend/src/__tests__/day_timeline.test.tsx` |
| Manual gate on the pointer wiring | `docs/user_testing_documentation.md`, Flow 16 |
| The decisions and why | `docs/adr/0002-magnetic-timeline-window-drag.md` |
| Requirements and acceptance criteria | `docs/plans/implementation_plan_timeline-window-drag_1.md` |

Start at `slideWindow` in `daytime.ts`. Everything else is either a variation on
it or the plumbing that feeds it.

## Interfaces and contracts

### `DayTimeline` props

```ts
blocks: PreferenceBlock[];
dayStart: string;
dayDurationMinutes: number;
preview?: { start: number; end: number; isFocus: boolean; invalid?: boolean } | null;
onPreviewChange?: (start: number, end: number) => void;   // new, optional
onGestureStart?: () => void;                              // new, optional
```

Both new props are optional and the first four are unchanged. Without
`onPreviewChange` the component renders exactly the read-only bar it did before:
no handles, no `tabIndex`, no `role`, no cursor or focus classes. Passing
`onGestureStart` alone enables nothing, and `preview={null}` stays read-only
whatever is passed.

`onPreviewChange` emits **offsets in minutes**, never clock strings. That is the
point of the contract: the conversion happens once, in the caller.

`preview.isFocus` is required by the type and read nowhere. Pre-existing, left
alone.

### `findOverlap`

Now generic: `findOverlap<T extends BlockRange>(start, end, blocks: T[]): T | null`,
where `BlockRange` is the two offset fields. The body is unchanged, including the
half-open comparison that matches the server's `_reject_overlap`.

The change widens what it accepts (a `kind` field is no longer required, so
placement can pass bare ranges) and narrows what it returns (`Settings.tsx` now
gets `PreferenceBlock | null` rather than an anonymous shape). Not a breaking
change for any caller. One consequence: the `as PreferenceKind` cast in
`Settings.tsx`'s collision message is now redundant, since `PreferenceBlock.kind`
is already `PreferenceKind`. Harmless, left in place.

### Backend

Untouched. No schema change, no migration, no new or changed endpoint. The
frontend's magnetism makes a 409 from `_reject_overlap` unlikely, never
impossible, and the existing error handler still surfaces it.

## Pointers for developers traversing the source

- `@dnd-kit/core` is a dependency and is **not** involved here. It drives task
  reordering in `TaskList.tsx` and nothing else. ADR 0002 Option I rejected it
  explicitly: it resolves discrete drop targets at drop time and has no concept of
  resize, so its pointer loop would have been rewritten regardless.
- `firstFreeGap` is deliberately untouched. ADR 0002 originally required
  extracting a `freeGaps` helper and rewriting it on top; that clause was withdrawn
  on 2026-10-23 once the candidate model made it unnecessary. The ADR carries a
  dated withdrawal rather than a deletion.
- `endForStart` and `clampEndToDay` are not reusable here and were not reused.
  Both take clock strings, both route through `toOffsets`, and both exist to
  repair half-finished typed input.
- ADR 0002 §3 specified inline structural parameter types to keep `daytime.ts`
  importless. The implementation introduced a named `BlockRange` type instead; the
  zero-imports property is preserved either way.
- `gridOffsets`, `anchorOffsets`, `SNAP_MINUTES`, `MIN_WINDOW_MINUTES` and
  `BlockRange` are exported but imported nowhere outside `daytime.ts`. They
  document the model and match existing practice in the file (`parseClock`,
  `formatClock`, `MINUTES_IN_DAY` and `DEFAULT_BLOCK_MINUTES` are the same).
  `candidatePositions` is exported for its tests.
- `day_timeline.test.tsx` renders with `react-dom/server`, not a DOM harness. It
  asserts markup facts only and never behaviour. `react-dom` is an existing
  runtime dependency, so this added nothing to install.
- The pointer gestures themselves have no automated coverage, by decision. Flow 16
  of `docs/user_testing_documentation.md` is the gate, and a failed step there
  blocks exactly as a failed test does.
