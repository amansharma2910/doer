---
type: implementation_plan
feature: provisional-day-signal
version: 1
status: draft
unplanned: false
linear_issue: null
created: 2026-10-21
updated: 2026-10-21
---

# Provisional day signal in the history heatmap

Arrived here from fix-mode. The reported symptom was that "Days kept" does not
move when the day's tasks are all complete. Analysis found the scoring correct
(days are scored at close) and the legend wrong about why the cell is blank. The
chosen direction changes what a heatmap cell means, which is a behavior change
rather than a fix, so fix-mode handed off and no fix plan was written for it.

## 1. Problem Statement

A logical day is scored only when it closes. `close_service.verdict_for` is called
from `close_day`, which runs against elapsed days, so an open day's `verdict`
column stays NULL. The heatmap's verdict view paints NULL as transparent, which is
the same pixel it paints for a day with nothing scheduled.

The user finished all four primaries and the cell stayed blank, while the legend
told them "uncoloured days had too little scheduled to score". That sentence is
false for a day in progress, and the hover gives no correction either, because the
tooltip's "X of Y" line is suppressed when `scheduled_primary` is zero, which is
what an open day reports today.

Two things are therefore wrong at once: the day in progress makes no claim at all,
and the interface explains its silence incorrectly.

## 2. Business Objective and End Goal

The north star is the rolling 7 day success rate, and the mechanism that moves it
is the user choosing to finish the fourth task rather than the fifth easy one.
The heatmap is the only place that habit is visible over time, and it currently
says nothing until a day is over, which is after the moment when the signal could
have changed a decision.

The end goal is that the surface showing whether days are kept responds on the day
being lived, without ever claiming an outcome that is not yet settled.

A counter-consideration recorded deliberately: the "Tasks done" view already
paints today from live completion counts, so a live acknowledgement exists one
toggle away. This plan accepts that the verdict view needs its own live state
anyway, because the two views answer different questions.

## 3. Users and UX

Single user, the person living the day, on the dashboard they already have open.

- An open day that currently meets the 75% rule is drawn as a **dashed ring in the
  success colour**, not a solid fill. A closed, kept day keeps the solid fill. The
  difference in treatment is the signal that one is settled and the other is not.
- An open day that is behind and running out of day is drawn as a **dashed ring in
  the failure colour**.
- Every other open day stays blank, as now.
- The tooltip states the live counts and that the day is still in progress.
- The legend is rewritten to describe all of these states, and the phrase "three
  of four" is retired: the implemented rule is 75% of whatever was scheduled, so a
  3 primary day fails at 2 complete.

## 4. Functional Requirements

**Must**

- M1. The heatmap response carries a provisional outcome for days that are open
  and unclosed. It is additive: the persisted `verdict` column is never written
  before close.
- M2. The provisional outcome is computed with `close_service.verdict_for`, the
  same function close uses, against live counts. The 75% rule is never
  reimplemented in TypeScript.
- M3. Provisional `success` requires `completed_primaries / scheduled_primaries >=
  SUCCESS_RATIO` with `scheduled_primaries >= MIN_PRIMARIES_TO_SCORE`. A day below
  the minimum, or with no tasks, reports no provisional outcome and stays blank,
  matching what close would decide.
- M4. Provisional `failure` is reported only when the live ratio is below
  `SUCCESS_RATIO` **and** the day is substantially elapsed, defined as now being
  past the end of the last focus block in the day's snapshot. Before that moment a
  day that is merely behind stays blank.
- M5. A day with no focus blocks has no "last focus block" and therefore never
  reports provisional failure. Consistent with indeterminate days making no
  capacity claims.
- M6. The frontend renders provisional success and provisional failure as dashed
  rings in the success and failure colours, visually distinct from the solid fill
  of a closed day.
- M7. `is_at_risk` continues to override both views, as it does now.
- M8. The legend and tooltip describe the new states and stop attributing a blank
  current-day cell to "too little scheduled".
- M9. The provisional state is recomputed whenever the heatmap is refetched. Task
  mutations already invalidate the `["heatmap"]` key prefix, so no new
  invalidation is required.

**Should**

- S1. The tooltip for an open day reads the live counts, for example
  "2026-10-21 · 4 done · 4/4 of the four · still in progress".
- S2. Closed days are untouched by this work, in data and in rendering.

**Could**

- C1. A transition treatment when a provisional state resolves into a verdict at
  close.
- C2. Surfacing the provisional state anywhere other than the heatmap.

**Won't**

- W1. Persisting a provisional verdict to `logical_days.verdict` or to
  `DailyMetrics`.
- W2. Changing how `verdict_for`, the 75% rule, or day close works.
- W3. Any provisional state for past days, open or closed.
- W4. Notifications, celebration, or any prompt when the threshold is reached.

## 5. Non-Functional Requirements

- The heatmap endpoint is a single SQL aggregation over a date range. The
  provisional computation must not turn it into per-day queries; the inputs it
  needs (live primary counts, the day's snapshot, `start_at`) are already on the
  rows being selected.
- No schema change and no migration.
- The provisional field is additive to the response, so an older client ignores
  it.
- The rule stays single-sourced in Python. Any drift between the provisional and
  final outcomes is a defect.

## 6. Inputs and Outputs

Inputs, all already available to the heatmap query:

- Live counts of primaries and completed primaries for the day, from the existing
  `Task` outerjoin.
- `LogicalDay.shape_snapshot`, for the focus blocks, via
  `capacity.focus_intervals`, which already returns real UTC interval bounds.
- `LogicalDay.closed_at`, to restrict this to open days.
- Current time.

Output: one additional field per cell, for example `provisional_verdict`, set to
`"success"`, `"failure"` or null. Null for every closed day and for every open day
that does not meet M3 or M4.

Note for implementation: the existing `scheduled_primary` field reads the
close-time snapshot column `scheduled_primary_count`, which is NULL and coerced to
zero while the day is open. If the tooltip in S1 is wanted, that field must become
live-when-open and snapshot-when-closed. It cannot become live for closed days:
carry-forward reassigns incomplete tasks off a closed day, so a live count there
would read 100% for every day in history.

## 7. Success Criteria

- With four of four primaries complete on an open day, the current cell shows a
  dashed success ring, and the tooltip says the day is in progress.
- With two of four complete before the last focus block ends, the cell is blank.
- With two of four complete after the last focus block ends, the cell shows a
  dashed failure ring.
- A day with one primary, complete, stays blank while open and neutral at close.
- At close, the provisional ring is replaced by the solid verdict fill, and the
  two agree whenever the counts have not changed in between.
- No closed cell changes appearance as a result of this work.
- The legend contains no statement that is false for any state it describes.

## 8. Failure Handling and Fallbacks

- A day whose snapshot has no focus blocks: no provisional failure, ever (M5).
- A missing or malformed snapshot: no provisional outcome; blank, never an error.
- Provisional outcomes retract when work is reversed while the day is open. This
  is accepted and is the reason the treatment is a dashed ring rather than a fill.
- The endpoint must never fail because a provisional outcome could not be
  computed. The field is optional and null is always a valid answer.

## 9. Non-Goals

- Changing when or how days are scored.
- Any persisted provisional state.
- Rewriting closed cells, retroactively or otherwise.
- A streak counter, a progress bar, or any second live surface. The dashboard
  already carries committed against threshold.
- Fixing the UTC date shift in `buildRange`. That is a separate defect in the same
  component, tracked under its own fix plan.

## 10. Open Questions

1. "Past the end of the last focus block" is one definition of substantially
   elapsed. A fraction of the day elapsed, for example 75%, is another, and would
   also work for days with no focus blocks. Worth settling in architecture-mode.
2. Whether `scheduled_primary` becomes live-when-open in this change or stays as
   it is, which decides whether S1 ships with the Musts.
3. Whether a dashed ring is legible at the current cell size in both themes. If
   not, the fallback is a reduced-opacity fill, which was the runner-up.
