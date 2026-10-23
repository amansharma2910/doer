# Changelog

All notable changes to Doer are recorded here.

## [Unreleased]

### Added

- **Logical days.** A day is defined by the user, can span midnight, and is stored
  as a materialized row with its shape, capacity, and threshold frozen at open. A
  task completed at 03:00 is attributed to the day that began the previous
  afternoon. Days spanning a DST transition are genuinely 14 or 16 hours and
  capacity follows.
- **The commitment contract.** At most four primary tasks per day, scored at 75%.
  Fewer than two primaries leaves a day neutral and unscoreable. Completed tasks
  are permanent; completions can be reversed only before the day closes.
- **Carry-forward with precedence.** Incomplete tasks roll forward unconditionally.
  Where carried and pre-assigned primaries exceed four, carried tasks keep their
  slots and the excess pre-assigned ones demote.
- **Lazy day close.** Elapsed days close in order on the next read, so the app is
  correct after being shut for a week.
- **Estimation.** 15-minute buckets from `claude-haiku-4-5`, retried by an
  in-process sweeper, cached per user.
- **Doer Assistant.** `claude-opus-5` parses natural language into a confirmable
  proposal. It commits nothing on its own and does not decompose tasks.
- **Calendar availability.** Read-only through `calendar.freebusy`. Event titles
  never reach the server. Revoked grants and API failures degrade rather than fail.
- **Surfaces.** Minimal dashboard, collapsible chat, drag-to-reorder, settings, and
  a hand-built two-view heatmap.
- **Metrics.** 31 events written inside the transactions that change state, plus
  per-day aggregate rows and a cost rollup from real token counts.
- **Google sign-in** with Fernet-encrypted refresh tokens.
- **Direct manipulation of the day timeline.** The dashed preview window on the
  Settings day bar is now the control. Drag its body to slide the range keeping
  its length, drag either edge to resize, or tab to it and use the arrow keys. A
  dragged edge rests on a wall-clock half hour or on an anchor, meaning a block's
  edge or one end of the day. Body drags are magnetic: pushing into a block parks
  the window flush against it and carrying the pointer past pops it to the free
  space beyond, so a gesture can never produce an overlap. Edge drags stop at a
  boundary rather than jumping it.

### Changed

- **Times are entered on a 24-hour clock.** All three fields on Settings are now a
  custom `ClockInput` with hour and minute segments, one tab stop, and arrows that
  wrap through midnight in both directions. No AM or PM appears anywhere, which
  makes the page consistent with every other time surface in the app.
- **Block start and end accept only `:00` and `:30`.** The day's own start still
  takes any minute, because it shifts the entire half-hour grid. This closes one
  of the four routes to an off-grid time that the timeline placement rules were
  designed around; the other three remain, so those rules are unchanged. Recorded
  as dated amendments in ADR 0002 and the feature documentation.

### Fixed

- The Settings time fields rendered a 12-hour clock, and the hour appeared to
  refuse to advance past 12. `<input type="time">` takes its format from the
  browser's locale and cannot be constrained: Firefox ignores the `lang`
  attribute for it, and release Chromium discards it behind a flag that ships
  disabled. No data was ever affected; the value was always 24-hour.
- Clearing a time field left `parseClock` returning `NaN`, which compares false
  against everything, so an empty range passed as valid: "Your day ends at
  NaN:NaN", Add block enabled on nothing, null offsets sent to the server, and
  the resulting 422 displayed as "[object Object]".

### Fixed during implementation

- `close_elapsed_days` stopped after one day, because it took the pending list once
  and days created by carry-forward were never closed.
- Day aggregates under-reported scheduled primaries on days with unfinished work,
  which would have corrupted the north star's denominator.
- Contract refusals rendered as `[object Object]` in the interface: the structured
  error body was being coerced by `Error(message)`, so the remedy never appeared.
- The test schema was built from model metadata, omitting the triggers that enforce
  append-only events and completed-task immutability, so those guarantees appeared
  tested but were not.
- A migration adding NOT NULL columns had no server default and failed on any
  populated database.
- A detached background estimation task outlived its test fixtures, producing
  intermittent teardown failures.

### Known gaps

See the Drift Notes at the top of `docs/doer/DOCUMENTATION.md`.

### Not shipped

Deployment, CI, error reporting, push-based calendar sync, and any background
worker. All deferred by ADR 0001.
