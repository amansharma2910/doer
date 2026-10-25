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
- **Surfaces.** Three screens behind a persistent navigation bar: Today, History
  and Settings, plus a day-detail view at `/history/:anchor`. Today leads with a
  four-slot commitment header and carries both ways of adding work. History holds
  summary statistics over a hand-built two-view heatmap whose every cell is a
  link. Settings holds the day shape and the block editor. Tasks reorder by drag.
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
- **Starting a task.** Every pending row carries a start control, and a running
  task shows elapsed time where its estimate was. This is the only thing that
  populates `actual_minutes`, so it is what makes the estimation-error indicator
  measurable at all.
- **History statistics and day detail.** Current streak, days kept, and a rolling
  7-day rate, all computed from the heatmap payload the screen already fetched, so
  History still issues one request. A cell opens that day: its outcome, its tasks.
- **A design token layer.** `frontend/src/index.css` is the single source for
  every colour, type step, spacing step, radius and shadow, in both schemes.
  No component holds a colour literal, and a test enforces that. Five
  arbitrary-value sizes do remain, and the test does not cover sizes.
- **Sign-out.** A control that ends the calling session only, so other browsers
  stay signed in.
- **`GET /tasks` accepts an optional `anchor`.** Given one it returns that day's
  tasks and 404s when no logical day exists on it. It never materializes a day and
  never writes an event, which the "now" path deliberately does.

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
- **The interface was restructured from two pages into three screens.** The
  dashboard is gone and the chat is no longer a collapsible panel on it. Task
  controls are always present rather than revealed on hover, which on touch meant
  they did not exist. Documents and test flows written before 2026-10-23 say "the
  dashboard"; read that as the Today screen.
- **Heatmap grid dates are computed on the server**, in the user's timezone, and
  returned alongside the cells rather than derived from the browser's clock.

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
- **The test suite destroyed the development database.** It dropped and
  re-migrated the schema of whatever `DATABASE_URL` named, and the `api` container
  names production. The suite now refuses to start unless the target database's
  name ends in `_test`, takes its target only from `DOER_TEST_DATABASE_URL`, and
  treats an inherited non-test `DATABASE_URL` as a hard refusal rather than a
  silent redirect. An hourly dump service was added at the same time.
- **Signing out left the page frozen on stale data.** `queryClient.clear()`
  destroys the query objects but leaves mounted observers attached to the dead
  ones, still reporting their last success, so React was never notified and the
  screen stayed up until a manual reload. Teardown now uses `resetQueries`.
- **Preference block edits did not reach the day in progress**, so the "set up a
  work block" nudge survived the user acting on it. Blocks are now refreshed onto
  the open day and capacity recomputed. The day shape itself stays frozen, which
  is the part AC-13 is about.
- **A block edit left the interface showing a day shape that no longer existed**,
  and a failed delete looked identical to one that succeeded.
- **Every history grid label ran a day early.** The grid was labelled in UTC
  while its cells are keyed by anchor dates in the user's timezone.
- **A repeat sign-in rendered the Google account picker twice.** Treating the
  absent refresh token as fatal sent every returning user through a second
  authorization leg, when Google issues a refresh token only on first consent and
  the stored grant survives sign-out. Consent is now forced only when nothing
  usable is stored. This also stops the refresh token rotating on every sign-in,
  and moves detection of a revoked grant from sign-in to the next calendar read.
- **122 MB of pnpm package store was committed to git history**, 7,863 files and
  98.1% of the repository by size. The compose `web` service wrote the store onto
  the host bind mount and nothing ignored it. A named volume now keeps it off the
  host, `.gitignore` matches it at any depth, and `main` was rewritten with
  `git filter-repo` on 2026-10-21. See the README for what a pre-rewrite clone
  needs to do.

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

Found during the interface overhaul, all after its phase gates had passed, and
all invisible to the previous suite because nothing asserted a colour or mounted
a component:

- Dark mode defined four of seven colour roles, leaving `success`, `failure` and
  `risk` at values chosen for light paper.
- The palette failed WCAG AA in both schemes. `muted` sat at 3.11:1 while being
  the most-used class in the application, and `risk` at 2.79:1, below even the
  3:1 graphic threshold.
- The rolling 7-day figure counted the grid's forward padding, so it held one
  real day on a Sunday and seven only on a Saturday.
- `formatAnchorDate` rendered `/history/2026-13-45` as a confident "Sunday,
  February 14", because `Number("")` is 0 rather than NaN and `new Date` rolls
  out-of-range parts over.
- Today rendered a loading state forever on any failure that was not a 409, and
  History and Settings had no loading or error state at all, while a test named
  "every screen has a designed loading, empty and error state" asserted only
  Today's.
- The compact layout reserved exactly the tab bar's own height, so the last line
  of a page sat on the bar's top border with no gap.

### Known gaps

See the Drift Notes at the top of `docs/doer/DOCUMENTATION.md`.

### Not shipped

Deployment, CI, error reporting, push-based calendar sync, and any background
worker. All deferred by ADR 0001.
