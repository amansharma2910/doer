---
type: fix_plan
issue: heatmap-utc-date-shift
severity: high
status: verified
related_feature: daily-task-planner
linear_issue: null
created: 2026-10-21
updated: 2026-10-21
---

# Fix plan: the heatmap grid is labelled in UTC

Severity is high because every cell in the grid is mislabelled for part of every
day in any timezone ahead of UTC, which silently misattributes a user's history
to the wrong dates.

## 1. Issue

`buildRange` in `frontend/src/components/Heatmap.tsx:152-165` builds `Date`
objects that carry the current local wall-clock time, then labels each one with
`d.toISOString().slice(0, 10)`, which is UTC. For any timezone ahead of UTC, the
label is a day behind whenever the local time of day is earlier than the offset.

Observed on 2026-10-21 at 05:29 IST, with UTC at 2026-10-20 23:59: every label in
the grid is one day early. Cells render one square to the right of where they
belong, and the `start` and `end` sent to the API shift with them. When the shift
crosses the week boundary, the current anchor date falls outside the grid
entirely and today's cell disappears from both views.

Found while analysing the "Days kept is not updating" report. It is not the cause
of that symptom, which was the absence of a verdict on an open day, and is
tracked separately for that reason.

## 2. Business Impact

The heatmap is the only longitudinal view of whether days are kept, and the north
star is a rolling 7 day success rate read off exactly this history. A grid whose
labels are off by one attributes a kept day to the day before it, for a window of
hours that recurs daily. The user cannot tell this is happening, because the grid
looks plausible either way.

It also makes the current day's cell intermittently vanish, which is itself a
support question of the kind that prompted this analysis.

## 3. Root Cause

One function mixing two time bases. `new Date()` and `setDate` operate on local
time; `toISOString` serializes UTC. `backend/doer/api/days.py` keys every cell by
`LogicalDay.anchor_date`, which `resolve_anchor_date` computes in the user's
configured timezone (`backend/doer/daytime.py:68`). The client was deriving the
same dates by a third rule, the browser's UTC offset, so the two agreed only when
the browser happened to be at or behind UTC.

Existing tests could not catch it. `frontend/src/__tests__/heatmap.test.ts:88-99`
asserts only that the day count is a multiple of seven and that dates ascend.
Both hold while every label is wrong.

## 4. Chosen Strategy and Rationale

The backend returns the grid. `GET /days/heatmap` takes a `weeks` parameter and
returns both the list of dates in the grid and the cells, computing the dates in
the user's configured timezone. The frontend stops deriving dates at all.

Chosen over two smaller options:

- Labelling from local date parts (`getFullYear`/`getMonth`/`getDate`) is five
  lines, but it is correct only while the browser timezone matches the timezone
  configured in settings.
- Building the grid with `Intl.DateTimeFormat` in the configured timezone is
  correct, but it leaves two implementations of the same date rule, one in Python
  and one in TypeScript, free to drift.

The server already owns anchor-date resolution and already knows the user's
timezone. Returning the dates alongside the cells makes one component the author
of the rule, which is why this was picked despite being the largest of the three.

Noted for the record: this crosses backend and frontend, which is where the
router would normally call for architecture-mode and an ADR. It proceeds under
fix-mode because the approach was chosen explicitly and the change is confined to
one endpoint with exactly one consumer. The response-shape decision is recorded
here rather than in an ADR.

## 5. Affected Files

- `backend/doer/daytime.py`: add `local_date(now, tz)` and `grid_days(today,
  weeks)`, both pure, so the date rule is unit-testable without HTTP or a clock.
- `backend/doer/api/days.py`: replace `GET /days/heatmap/range` with `GET
  /days/heatmap`, returning a grid object instead of a bare cell list.
- `frontend/src/lib/hooks.ts`: `useHeatmap(weeks)`, keyed `["heatmap", weeks]` so
  the existing `["heatmap"]` prefix invalidation keeps working.
- `frontend/src/lib/types.ts`: add the grid type.
- `frontend/src/components/Heatmap.tsx`: delete `buildRange`, render the dates the
  server returned, and show a placeholder grid while the query is in flight.
- `backend/tests/test_daytime.py`, `backend/tests/test_api.py`,
  `frontend/src/__tests__/heatmap.test.ts`: see section 7.

## 6. Regression Risk

Low in blast radius, moderate in surface change.

1. **Contract break.** `GET /days/heatmap/range` is removed. It has exactly one
   consumer, `useHeatmap`, used by one component mounted once. No other client
   exists, and the app ships as a single bundle with its API.
2. **Loading flash.** The grid previously rendered its squares immediately from
   client-computed dates and filled in colour when the query resolved. With the
   dates coming from the server, an empty grid would flash on every mount. A
   placeholder grid of the right size while loading is part of the fix, not a
   follow-up.
3. **Week convention.** The grid runs Sunday to Saturday, matching the current
   `getDay()` padding. Python's `weekday()` is Monday-based, so the conversion is
   an explicit step and is unit-tested rather than inlined.
4. **Cache keys.** The key becomes `["heatmap", weeks]`. The prefix is preserved,
   so the invalidation in `useTaskMutation` that covers eight mutations continues
   to match.

## 7. Test Plan

- `backend/tests/test_daytime.py`: `grid_days` returns `weeks * 7` ascending dates
  ending on the Saturday on or after the given date, for a date that is itself a
  Saturday, a Sunday, and a midweek day.
- `backend/tests/test_daytime.py`: `local_date` returns the date in the given
  timezone, not UTC, for an instant where the two differ. This is the assertion
  that pins the defect.
- `backend/tests/test_api.py`: the endpoint returns `weeks * 7` days, and the
  current date in the user's configured timezone is among them. Replaces the
  existing range-based heatmap tests.
- `frontend/src/__tests__/heatmap.test.ts`: the two `buildRange` tests are
  removed with the function. `colorFor` coverage is untouched.

Acceptance: both suites green, and the current date in the user's timezone is
present in the returned grid when the UTC date differs from it.

Result on 2026-10-21: 205 backend passed (7 live tests deselected), 72 frontend
passed. Eleven new backend cases: seven unit tests over `local_date` and
`grid_days`, four over the endpoint. The frontend suite is two smaller because
the `buildRange` tests went with the function. No new lint or formatting
findings: HEAD already carried the same one ruff error and four unformatted
files, all in code this fix did not touch.

## 8. Rollback Plan

Reverting the commit restores the previous endpoint and the client-side range.
No schema change, no migration, no stored data touched: the fix only changes
which dates are asked for and how they are labelled. Any cell the user saw under
the old behaviour is the same row in the database, read under a correct label
afterwards.
