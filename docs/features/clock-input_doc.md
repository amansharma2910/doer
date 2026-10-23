# The 24-hour clock field

## What it does

Every time on the Settings page is entered through `ClockInput`: **Starts** under
"Your day", and **From** and **Until** under "How your day is split". It is a
24-hour field with an hour segment and a minute segment, no AM or PM anywhere.

- Click a segment, or Tab into the field and use left and right to move between
  segments.
- Up and down step the focused segment, wrapping through midnight in both
  directions: `23:00` up is `00:00`, `00:00` down is `23:00`.
- Type digits. `1` then `4` gives 14; a digit that cannot begin a legal hour, such
  as `9`, resolves on its own.

**From** and **Until** accept only `:00` and `:30`. **Starts** accepts any minute,
because the day's start shifts the entire half-hour grid: a day beginning at 14:15
puts the half hours at 14:30 and 15:00, so snapping it would make the
phase-shifted case unreachable through the interface.

## Implementation detail

### Why a custom control at all

`<input type="time">` renders 12-hour or 24-hour from the browser's locale, and
nothing in the page can constrain it. Verified in the engines rather than assumed:
Firefox never reads the `lang` attribute for this control, taking the format from
`getWebExposedLocales()`; release Chromium discards `lang` because the flag that
would honour it ships with no status, which its own feature file defines as
disabled everywhere. Hiding the AM/PM segment with
`::-webkit-datetime-edit-ampm-field` is Chromium-only and makes things worse: the
hour still cycles 1 to 12 with nothing on screen saying which half of the day it
means.

The reported symptom was the hour "going back to 1:00 AM" after `12:00 AM`. That
was a misreading the control invited: `12:00 AM` is the display of the value
`00:00`, so stepping to `01:00` was correct. The data was never wrong. Every other
time surface in the app already read 24-hour, because `offsetToClock` and
`formatClock` emit zero-padded `HH:MM` unconditionally, so the native fields were
the only ones disagreeing with the rest of the page.

### The value contract, and the one obligation it places on callers

`HH:MM` in, `HH:MM` out, identical to the native input, so nothing downstream
changed. Partial input is held in component state and never emitted, so a
half-typed `1` on the way to `14` cannot reach the form and be read as one in the
morning.

The component holds no copy of the value, so **a caller must echo back what it
emits**. Transforming the value inside `onChange` would leave the segment the user
is not editing reading from a stale prop. A caller that needs to adjust a finished
edit uses `onCommit`, which is handed the settled value for exactly this reason:
the Until field caps an overrunning end time there, and reading the parent's `to`
instead would clamp against a value a digit resolving in the same event had not
yet updated.

### Stepping

All arithmetic is pure functions in `daytime.ts`:

- `stepClock(clock, deltaMinutes)` is one line over `parseClock` and `formatClock`.
  `formatClock` already wrapped in both directions, so `23:00` plus an hour being
  `00:00` came free from code that already existed.
- `stepToMultiple(clock, step, forward)` is what the minute segment uses on a
  snapped field, and it is deliberately **not** `stepClock` by the step. Stepping
  15:45 by 30 gives 16:15, 16:45, 17:15, so a field accepting only `:00` and `:30`
  would never land on a value it accepts. `firstFreeGap` seeds exactly such a
  value, from a stored block's odd end, so this is reachable in ordinary use.
- `snapMinute(minutes, step)` resolves a typed minute. "Nearest" and "never
  carries" genuinely conflict above the last multiple, and the conflict is settled
  in favour of never carrying: a typed 45 becomes 30 rather than advancing the
  hour, because the hour is a segment the person did not touch.
- `isClock(value)` guards against an unreadable value. A cleared native field
  reported `""`, `parseClock` returned NaN, and every NaN comparison in `toOffsets`
  was false, so an empty range passed as valid: "Your day ends at NaN:NaN", Add
  block enabled on nothing, `null` offsets on the wire, and "[object Object]" when
  the server rejected them. `toOffsets` now reports `{ kind: "unreadable" }`.

### Accessibility

Each segment is a `role="spinbutton"` with its own `aria-valuenow` and
`aria-valuetext`, under a `role="group"` host carrying the field's name. Focus
roves: the inactive segment holds `tabIndex={-1}`, so the field is a single tab
stop as the native control was, while a screen reader still gets a real value
announced on every arrow press. Plain spans would have left the selected segment
legible only as a background colour.

## Key files and entry points

| Concern | File |
|---|---|
| The control | `frontend/src/components/ClockInput.tsx` |
| Clock arithmetic | `frontend/src/lib/daytime.ts` |
| The three call sites | `frontend/src/pages/Settings.tsx` |
| Arithmetic tests | `frontend/src/__tests__/daytime.test.ts` |
| Markup tests | `frontend/src/__tests__/clock_input.test.tsx` |
| Manual gate | `docs/user_testing_documentation.md`, Flow 17 |
| Root cause and decisions | `docs/fixes/fix_plan_time-inputs-show-12-hour-clock.md` |

## Pointers for developers traversing the source

- **Do not reach for `SNAP_MINUTES`.** That constant governs gestures on the day
  timeline. The `minuteStep={30}` on From and Until is a separate decision taken
  for the fields, written as a literal at the call site on purpose.
- The control constrains **entry**, not display. A seeded or clamped value may
  still be off the half hours, and that is correct rather than a bug to work
  around. `stepToMultiple` is what gets such a value back onto the grid.
- The field's keystroke behaviour has no automated coverage. Flow 17 is the gate,
  as Flow 16 is for the timeline drag. The arithmetic beneath it is covered
  exhaustively as pure functions.
- Closing the typed route to an odd time removed one of the four routes ADR 0002
  relied on. Three remain, so the magnetic grid-plus-flush rule is unchanged and
  still necessary. ADR 0002 and `timeline-window-drag_doc.md` carry dated
  amendments saying so.
