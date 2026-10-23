---
type: fix_plan
issue: time-inputs-show-12-hour-clock
severity: low
status: verified
related_feature: timeline-window-drag
linear_issue: null
created: 2026-10-23
updated: 2026-10-23
---

# Fix plan: the Settings time fields render a 12-hour clock

Severity low: the defect is presentational and misleads, but no data is wrong and
no objective is blocked.

## 1. Issue

Reported against the **Starts** field on Settings, which showed `12:00 AM` with the
hour segment selected:

> "I'm modifying the hours by keyboard (up and down arrows). After 12:00 AM,
> instead of becoming 1:00 PM, it goes back to 1:00 AM. Please fix this. Also,
> just remove AM/PM. I need 24hr clock system."

Both halves of the report resolve to one cause, and the first half is a misreading
invited by the second. `12:00 AM` is the display of the value `00:00`, not of hour
twelve, so arrow-up correctly produced `01:00`. In 24-hour terms the control was
already doing exactly what was asked, including the `23:00` to `00:00` wrap. Only
the rendering was wrong.

## 2. Business Impact

Setting up the day is on the critical path to Doer working at all: without focus
blocks the capacity model has nothing to judge. It happens during first setup,
when the user has the least invested. A time field that reads ambiguously at the
exact moment someone is deciding when their day begins is friction in the worst
place for it.

There is a second, sharper cost. Every other time surface in the application is
already 24-hour, because `offsetToClock` and `formatClock` emit zero-padded
`HH:MM` unconditionally: the block list, the day-end hint, the timeline's end
labels, the drag handles' `aria-valuetext`. The three native inputs were the only
12-hour surface in the codebase, so the Settings page contradicted itself on
screen. `docs/user_testing_documentation.md` is likewise written entirely in
24-hour notation, which means a tester on a 12-hour locale could not follow Flow
16.14 ("Type 14:22 into the From field") as written.

No data impact. The value crossing the browser boundary is always a
locale-independent `HH:MM`, so nothing wrong ever reached `parseClock`, the API,
or the database.

## 3. Root Cause

**Not a defect in this repository's code.** `<input type="time">` renders 12-hour
or 24-hour according to the browser's locale, and in a 12-hour locale it splits
into three segments: hour 1 to 12, minute, and a separate AM/PM field that arrow
keys on the hour do not touch.

Verified in the engines rather than assumed:

- Blink flips the day period only when a step lands exactly on 12 by increment
  (`date_time_field_elements.cc`, `DateTimeHour12FieldElement::NotifyOwnerIfStepUpRollOver`).
  Stepping 12 to 1 wraps, so no flip fires, correctly: 12 AM plus an hour is 1 AM.
- Gecko wraps within `[min, max]` and never touches `dayPeriod` at all
  (`toolkit/content/widgets/datetimebox.js`, `incrementFieldValue`).

**Two apparent one-line fixes are dead**, both verified against engine source:

- The `lang` attribute cannot force 24-hour rendering. Firefox never consults it
  for this control, reading `getWebExposedLocales()` instead. Release Chromium
  discards it: `Document::GetCachedLocale` returns `Locale::DefaultLocale()`
  unless `LangAttributeAwareFormControlUI` is enabled, and that flag carries no
  `status:` key, which `runtime_enabled_features.json5` defines as "not enabled
  anywhere by default". Independently, `index.html` sets `lang="en"`, which
  resolves to 12-hour conventions anyway.
- Hiding the segment with `::-webkit-datetime-edit-ampm-field { display: none }`
  is Chromium-only and makes matters worse: the hour still cycles 1 to 12, now
  with nothing on screen saying which half of the day it means.

Unreported engine bug found next door, recorded so nobody chases it later: in
Firefox, 11 AM arrow-up gives 12 **AM** rather than 12 PM, because Gecko never
rolls the day period. Chromium is correct. Replacing the control makes it moot.

## 4. Chosen Strategy and Rationale

**Replace all three native time inputs with one custom segmented control**, since
no attribute, style, or configuration can constrain the native one.

`ClockInput` renders an hour segment and a minute segment in a single bordered
field with one tab stop, matching the shape of the control it replaces. Left and
right arrows move between segments; up and down step the focused segment and wrap
through the 24-hour day. Its value contract is unchanged from the native input:
`HH:MM` in, `HH:MM` out, so every consumer downstream (`computeEnd`,
`endForStart`, `clampEndToDay`, `toOffsets`, the preview, both mutations) needs no
change.

Stepping is a single pure function, `stepClock(clock, deltaMinutes)`, which is one
line over the existing `parseClock` and `formatClock`. `formatClock` already wraps
in both directions, so `23:00` plus an hour is `00:00` and `00:00` minus an hour
is `23:00` fall out for free: the user's stated requirement, verbatim, from code
that already existed.

Rejected: two adjacent number fields. Less code, but two tab stops, and number
inputs clamp at their limits rather than wrapping, so `23` plus one stays `23`
unless the wrap is written by hand anyway, which is most of the work of the
segmented control for a worse result.

### Scope changes decided alongside this fix

Two decisions taken on 2026-10-23 that are **changed behaviour rather than
restored behaviour**, named here so they are not mistaken for part of the defect:

1. **From and Until accept only `:00` and `:30`.** This reverses a deliberate
   decision in ADR 0002, which left the inputs unstepped so an off-grid time
   stayed reachable, and which `docs/features/timeline-window-drag_doc.md` called
   "the only route" to one. ADR 0002 and the feature doc carry dated amendments
   rather than edits, and Flow 16.14 is rewritten.

   The magnetic grid-plus-flush decision itself is unaffected and still necessary:
   off-grid blocks remain reachable by three other routes, since the server
   validates no grid (`backend/doer/schemas/day.py`), `firstFreeGap` seeds from a
   stored block's end, and `endForStart` adds an hour to an off-grid start. No
   placement logic and no placement test changes.

2. **Starts keeps free minute entry.** The day start is set once and shifts the
   entire half-hour grid, since a day beginning at 14:15 puts the half hours at
   14:30 and 15:00. Snapping it would make the phase-shifted grid unreachable
   through the interface and render Flow 16.24 to 16.28 unrunnable, which is the
   manual test for the case most likely to be subtly wrong.

The control constrains **entry**, not display. A seeded or clamped value may still
be off the half hours, for instance when `firstFreeGap` proposes a stretch
beginning at a stored block's odd end. That is correct and is not worked around.

### Folded in by request

A `parseClock` guard, which is a separate defect reachable today without any of
these changes. Clearing a native time field yields `""`, and `parseClock` has no
guard, so `computeEnd("")` renders "Your day ends at NaN:NaN", and
`toOffsets("", ...)` returns `{ start: NaN, end: 240 }` which every comparison in
the function treats as valid, leaving Add block enabled on an invalid range,
sending `null` offsets, and surfacing the resulting 422 as "[object Object]"
because FastAPI's validation `detail` is an array.

`ClockInput` holds partial input internally and emits only complete values, so the
new control does not widen this. The guard is added anyway, as agreed, and called
out in the commit message.

## 5. Affected Files

| File | Change |
|---|---|
| `frontend/src/components/ClockInput.tsx` | New. The segmented 24-hour control. |
| `frontend/src/lib/daytime.ts` | New `stepClock`, `isClock`, `snapMinute`; `parseClock` guarded; `toOffsets` gains an unreadable-input error; stale AM/PM rationale on `clampEndToDay` revised, behaviour kept. |
| `frontend/src/pages/Settings.tsx` | Three `<input type="time">` call sites replaced; `computeEnd` guarded; stale AM/PM comment revised. |
| `frontend/src/__tests__/daytime.test.ts` | Cases for the new functions and the guard. |
| `frontend/src/__tests__/clock_input.test.tsx` | New. Markup structure, as `day_timeline.test.tsx` does. |
| `docs/adr/0002-magnetic-timeline-window-drag.md` | Dated amendment: one of the four routes to off-grid state is closed. |
| `docs/features/timeline-window-drag_doc.md` | "Only route to an odd time" corrected. |
| `docs/plans/implementation_plan_timeline-window-drag_1.md` | §12.4 edge case 1 corrected. |
| `docs/user_testing_documentation.md` | Flow 16.14 and 16.15 rewritten; a note that the fields are 24-hour. |

Backend untouched: no schema, migration, endpoint, or validation change.

## 6. Regression Risk

**Moderate, and concentrated in one place: nothing automated covers these three
controls.** No test renders `Settings`, so a mistake in the replacement cannot
break a test, and equally nothing catches it. This is the same gap ADR 0002
accepted for the drag, and the same answer applies: put the logic in pure
functions in `daytime.ts` where `daytime.test.ts` covers it, keep the component
thin, and assert its markup with `renderToStaticMarkup` as
`day_timeline.test.tsx` already does.

Specific risks:

- **Losing the picker and native validation.** Accepted; the control is simple
  enough that neither is load-bearing.
- **Deleting the `onBlur` clamp along with its comment.** The stated reason goes
  stale under a 24-hour control, but the deferral is still needed: typing `1` on
  the way to `14` momentarily reads `01:00`. Revise the comment at
  `Settings.tsx` and `daytime.ts`; keep the behaviour.
- **Applying `SNAP_MINUTES` to the control.** The timeline's grid constant governs
  gestures on the bar and is not the same decision. From and Until snap because
  that was decided here; Starts does not.
- **Changing `parseClock`'s return type.** It returns `number` today and callers
  do not check. The guard is added as a separate `isClock` predicate used by
  `toOffsets` and `computeEnd`, so no call site's contract moves.

## 7. Test Plan

**Automated, in `daytime.test.ts`:**

1. `stepClock` advances and wraps: `23:00` +60 is `00:00`; `00:00` -60 is `23:00`;
   `23:45` +30 is `00:15`.
2. `stepClock` carries between segments: `15:30` +30 is `16:00`.
3. `isClock` accepts `00:00`, `09:15`, `23:59`; rejects `""`, `24:00`, `9:15`,
   `12:60`, `abc`.
4. `snapMinute` rounds to the nearest step and never carries past the hour.
5. `toOffsets` reports an unreadable input as an error rather than returning a
   range containing `NaN`.
6. Every existing test passes unmodified, in particular the placement geometry,
   which this change must not touch.

**Automated, in `clock_input.test.tsx`:** the field renders both segments, exposes
them to assistive technology, and carries one tab stop.

**Manual**: Flow 17 of `docs/user_testing_documentation.md`, 17 steps covering
the wrap at both ends of the day, segment selection by pointer and by keyboard,
the snapped and free minute rules, the single tab stop, the deferred clamp, and
the absence of AM or PM anywhere on the page. Flow 16.14 and 16.15 are rewritten,
since they instructed a tester to type `14:22` into From.

Status as of 2026-10-23: **both halves pass.** The automated half is 158 tests
across 6 files. Flow 17 was run manually and reported passing by the user, as was
Flow 16 for the related timeline work. This plan is `verified`.

## 8. Rollback Plan

Self-contained and revertible in one commit. `ClockInput.tsx` and
`clock_input.test.tsx` are new files; the three call sites in `Settings.tsx` revert
to `<input type="time">`; the `daytime.ts` additions are purely additive except
the `toOffsets` error variant, whose removal is mechanical.

The two behaviour decisions revert with it, which is the reason they are recorded
as dated amendments to ADR 0002 and the feature doc rather than as edits: a revert
restores the documents' original meaning without losing the record that the
decision was made and then undone.
