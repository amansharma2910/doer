---
type: fix_plan
issue: stale-block-snapshot
severity: high
status: verified
related_feature: daily-task-planner
linear_issue: null
created: 2026-10-21
updated: 2026-10-21
---

# Fix plan: preference block edits do not reach the open day

Severity is high because every new account hits this on its first day and the
remedy the interface offers cannot be carried out until the next one.

## 1. Issue

The dashboard shows "Set up at least one work block in settings and Doer can tell
you what fits" when the current logical day has no focus blocks. Adding a focus
block in settings does not clear it. The nudge stays until the next logical day
opens, and capacity, the threshold, and the at-risk flag stay at zero for the
whole day.

Reproduction, which is the default path for a new account:

1. Sign in. The dashboard is the default route, so the first load materializes
   today's logical day.
2. Go to settings and add a deep work or personal project block.
3. Return to the dashboard. The nudge is still there.

Confirmed with the user that the saved blocks are focus kind, so the wrong block
kind is excluded as an explanation.

## 2. Business Impact

The product's single promise is telling the user what fits in their day. On day
one it cannot, for every user, because the day is materialized before settings
can be reached. The at-risk signal is the entire over-commitment mechanism (no
modal, no alert, no nagging), and an indeterminate day emits none of it.

The nudge also names a remedy that does nothing today, which this repository has
already treated as a defect class in commit `9a2e6fd`, "an unreachable remedy".

Measurement impact: the tracking plan's north star is the rolling 7 day success
rate, and a day with a zero threshold contributes no capacity verdict. The first
scored day of every account is degraded.

## 3. Root Cause

Capacity is never computed from live preference blocks. It reads a frozen copy
held on the logical day row.

- `backend/doer/services/day_service.py:27-47`, `build_snapshot` copies the
  blocks into `shape_snapshot` at materialization. Its docstring states that once
  written this is never recomputed.
- `backend/doer/services/day_service.py:64-66`, `open_day` returns an existing
  row before blocks are read again, so reopening never re-snapshots.
- `backend/doer/services/capacity.py:35-46` reads `snapshot["blocks"]`, and
  `capacity.py:97-105` returns `indeterminate_reason="no_focus_blocks"` when that
  list yields no focus intervals.
- `backend/doer/api/settings_routes.py` imports no day or task service. Creating
  or deleting a block writes the `preference_blocks` row and nothing else.
- `backend/doer/services/task_service.py:386-392`, `recompute_capacity` passes
  `day.shape_snapshot`, so the frequent recomputations all read the stale copy.

Two explanations were eliminated. Frontend cache staleness is not involved:
`App.tsx` swaps route elements, so `Dashboard` unmounts and React Query refetches
the day on return with its default `staleTime` of zero. Designed behavior does
not account for it either: AC-13 in the implementation plan freezes the **day
shape**, defined at plan line 54 as start time and duration, while plan line 214
states the dashboard prompts the user to define at least one focus block. The
implementation generalized a shape scoped freeze to cover blocks as well.

## 4. Chosen Strategy and Rationale

Strategy A1, push from the settings write path. After a block is created or
deleted, refresh only the `blocks` array of the open day's snapshot and recompute
capacity.

Rejected alternatives:

- A2, re-derive blocks inside `open_day`'s early return. One edit would cover
  every path, but it puts a block query and a write on a read path that runs on
  essentially every authenticated request.
- A3, refresh only when the stored block list is empty. Four lines smaller, but
  deleting the last focus block would leave capacity computed from blocks that no
  longer exist. Not worth the asymmetry.

AC-13 is preserved exactly: `day_start_time`, `day_duration_minutes`, `timezone`
and `capacity_ratio` in the snapshot are untouched, and closed days are skipped.
`recompute_capacity` already takes the ratio from the `day.capacity_ratio` column
rather than from the user, so the frozen ratio survives for free.

The recompute passes the day's stored busy snapshot rather than nothing, so a
calendar connected user's threshold stays honest at the moment of the edit. This
requires renaming `calendar._stored` to `calendar.stored_busy`, a mechanical
change with two internal call sites and no behavior change.

Deliberately out of scope:

- `keys.day` is never invalidated by the settings mutations in
  `frontend/src/pages/Settings.tsx`. The remount refetch masks it, so it is not
  load bearing for this symptom.
- Nine of the eleven `recompute_capacity` call sites pass no `busy` and therefore
  zero `busy_minutes_subtracted` until the next stale triggered calendar sync.
  That is a separate latent defect, recorded in section 6, and needs its own fix
  plan.

## 5. Affected Files

- `backend/doer/services/day_service.py`: extract the block projection out of
  `build_snapshot`, add a function that re-freezes blocks onto an already open,
  unclosed day without materializing one.
- `backend/doer/api/settings_routes.py`: call it after `create_block` and
  `delete_block`, then recompute.
- `backend/doer/services/calendar.py`: rename `_stored` to `stored_busy`.
- `backend/tests/test_day_service.py` and `backend/tests/test_api.py`: new
  coverage, see section 7.

## 6. Regression Risk

Low, with three specific watch points.

1. **Snapshot immutability.** `backend/tests/test_day_service.py:91-137`,
   `TestSnapshotImmutability`, mutates only `day_start_time`,
   `day_duration_minutes` and `capacity_ratio`. A blocks only refresh leaves all
   three alone, so those tests remain meaningful and must stay green unchanged.
2. **Closed days.** The refresh must skip `LogicalDay.is_closed`
   (`backend/doer/models/day.py:89`), or a block edit could rewrite a scored day.
   Covered by a new test.
3. **Event volume.** `recompute_capacity` appends a `day_capacity_computed`
   event, which is append only by database trigger, so nothing is mutated. Block
   edits now emit one such event each. `day_risk_flag_raised` and
   `day_risk_flag_cleared` fire on transition only; adding focus blocks raises the
   threshold, so the realistic direction is fewer false flags.

Separate latent defect found during analysis, not fixed here: nine of eleven
`recompute_capacity` call sites pass no `busy`, so `capacity.compute` subtracts
zero and `busy_minutes_subtracted` is wiped. Since `calendar.sync_day` only runs
when the snapshot is stale, a calendar connected user's threshold is inflated
after any task mutation until the next day. Worth its own fix plan.

## 7. Test Plan

No test covers the edit settings then re-read the day transition in either suite
today, which is why this shipped. Adding:

- `backend/tests/test_day_service.py`: adding a focus block to an open day clears
  `is_indeterminate` and `indeterminate_reason`, while
  `shape_snapshot["day_start_time"]` and `day.capacity_ratio` stay untouched.
- `backend/tests/test_day_service.py`: deleting the last focus block restores
  `no_focus_blocks` the same day.
- `backend/tests/test_day_service.py`: a closed day is not modified by a block
  edit.
- `backend/tests/test_api.py`: end to end, `GET /days/current` then
  `POST /settings/blocks` then `GET /days/current`, asserting the second read is
  no longer indeterminate.

Acceptance: the full backend suite (190 tests, 7 live tests deselected) and the
frontend suite (74 tests) stay green, with `TestSnapshotImmutability` unchanged.

Result on 2026-10-21: 195 backend passed, 74 frontend passed, including the six
new cases above. `TestSnapshotImmutability` passed unmodified. One unrelated
failure, `test_the_chat_model_is_used_not_the_estimation_model`, which hardcodes
`claude-opus-5` while `.env` sets `CHAT_MODEL` to `claude-sonnet-5`; it passes
when run against the config default, so it is environment brittle rather than a
regression. Not addressed here.

## 8. Rollback Plan

The change is additive and confined to two endpoints plus one helper. Reverting
the commit restores the previous behavior exactly. No migration, no schema
change, no data backfill. Snapshots already refreshed by the fix stay refreshed,
which is harmless: they describe blocks the user really did configure, and the
next recompute reproduces the same numbers from them.
