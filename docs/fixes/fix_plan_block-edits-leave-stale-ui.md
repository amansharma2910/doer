---
type: fix_plan
issue: block-edits-leave-stale-ui
severity: high
status: verified
related_feature: interface-overhaul
linear_issue: null
created: 2026-10-24
updated: 2026-10-24
---

# Block edits leave a stale interface

Severity **high**: no data is lost, but after any preference block edit the Today
screen presents capacity figures computed against a day shape that no longer
exists, and a block delete that fails is indistinguishable on screen from one
that succeeded.

## 1. Issue

Reported 2026-10-24. The user deleted the "Personal project 13:00 to 15:00"
block on the Settings screen. The server accepted it, but the row stayed in the
list and a band remained drawn on the day timeline.

The report turned out to contain three defects stacked on one another, which is
why it read as a single confusing symptom.

**The list was genuinely stale.** The screenshot's row carries a Remove button,
which the dashed preview window never does, so this was a real list row rather
than a misread preview. The delete committed server-side while the browser
received a 503: the `api` container runs uvicorn with `--reload` against a
mounted volume, and it was restarting after unrelated backend edits made earlier
in the session, so Docker's port proxy answered while the worker was down. The
mutation's `onSuccess` therefore never ran and nothing was invalidated.

**Nothing said it had failed.** `remove.error` is rendered nowhere, while
`add.error` and `save.error` both are. A failed delete and a successful one
produce identical screens.

**A successful delete also looks undone.** After the list does refresh, the
suggestion effect re-seeds the dashed preview window into the slot the delete
just freed, carrying the unchanged `kind`, so the screen still shows a band at
13:00 to 15:00 described as "2h of personal project". Reproduced on the
reporter's exact day shape.

**Found on the way, and wider than the report.** Block mutations invalidate only
`["blocks"]`, so the open day is never refetched after a block edit.

## 2. Business Impact

The capacity model is the product's central claim: Doer compares what you have
committed against what your day realistically holds. The backend keeps that
correct. `_apply_to_open_day` runs on every block create and delete,
recalculating the open day's capacity, and the `events` table shows it working:
`capacity_base_minutes` moved 660, 540, 570, 540 across the reported session.

The interface never asks for the result. No `GET /days/current` follows any
block mutation. So after editing blocks, Today keeps showing the previous
shape's committed-versus-fits figures, at-risk dot, and four-slot header. The
numbers are wrong and are presented as right, on the screen the entire
commitment contract rests on.

This also quietly undoes part of what
`docs/fixes/fix_plan_stale-block-snapshot.md` set out to achieve. That fix made
block edits reach the day in progress on the server. They do. The client simply
never looks, so from the user's seat the original symptom partly survives.

Secondary impact: a user who hits a genuine delete failure has no way to learn
that it failed, and will reasonably conclude the application is broken. That is
what happened here, and it cost a full root-cause investigation to establish
that the data layer was fine.

## 3. Root Cause

Three independent causes, all in `frontend/src/pages/Settings.tsx`.

**C1. Invalidation is conditional on client-side success.** Both block mutations
use `onSuccess`. `useTaskMutation` in `lib/hooks.ts` deliberately uses
`onSettled`, with a comment recording why: a failure must not leave stale state
behind. The block mutations predate that reasoning and never adopted it. Any
rejected promise, from a transient 503 to a dropped connection, leaves the list
showing a block the server has already deleted.

**C2. Invalidation is too narrow.** Both block mutations invalidate `["blocks"]`
only. `useTaskMutation` invalidates `["tasks"]`, `["day"]` and `["heatmap"]`
together, because any task change can move capacity. A block change moves
capacity through exactly the same server path, and is treated as though it
cannot.

**C3. The suggestion effect does not know a delete happened.** Its dependency
array is `[blocks, dayStart, user.day_duration_minutes]`, so it fires on any
change to `blocks`, including a removal. `firstFreeGap` then returns the
newly-freed slot, and `kind` is never reset, so the window reappears exactly
where the deleted block was with the deleted block's label. The effect was
written for the add case, where moving the form to the next free stretch is
correct and deliberate. The delete case was never considered.

C1 and C2 are pre-existing and unchanged by the interface overhaul: the
mutations are byte-identical to `HEAD`. C3 is also pre-existing, introduced with
the suggestion effect. What changed is that the Remove control became reachable:
it was `opacity-0` until hover before 2026-10-23, and unreachable by touch, so
the delete path was rarely exercised.

## 4. Chosen Strategy and Rationale

Chosen by the user on 2026-10-24: **the targeted fix, four edits, plus the
documented behaviour change to the preview.**

1. Both block mutations move from `onSuccess` to `onSettled`, matching
   `useTaskMutation`. The interface then reconciles with the server even when
   the client believes the request failed, which would have self-healed the
   reported incident in front of the user.
2. Both invalidate `["blocks"]`, `["day"]` and `["heatmap"]` by prefix.
3. `remove.error` is rendered beside the list, as `add.error` already is.
4. The delete path claims the form, so the preview window stays where it is
   instead of jumping into the freed slot.

Two alternatives were considered and declined. Routing both mutations through a
shared `useBlockMutation` in `hooks.ts` would define invalidation breadth once
and also pull in `DayShapeForm.save`; it was declined as a larger diff than the
defect warrants, and is recorded under Deferred below. Redesigning the dashed
preview so it can never read as a block would additionally fix the window moving
under a user on a window-focus refetch; it was declined as design work beyond a
fix, and is also recorded below.

**One behaviour change, agreed explicitly rather than absorbed.**
`docs/user_testing_documentation.md` Flow 16.13 documents the window reappearing
in a free stretch as expected, and that flow was reported passing. After this
fix the window re-seeds after an **add** but not after a **delete**. The flow is
amended with a dated note rather than silently edited, so a later reader sees
the decision. This is the only intended-behaviour change in this fix; everything
else restores behaviour the application already claimed.

## 5. Affected Files

| File | Change |
|---|---|
| `frontend/src/pages/Settings.tsx` | Both block mutations: `onSettled`, widened invalidation, claim the form on delete. Render `remove.error`. |
| `frontend/src/__tests__/settings_blocks.test.tsx` | New. Covers the four behaviours above. |
| `docs/user_testing_documentation.md` | Flow 16.13 amended; a delete step added to Flow 23. |

Not changed, deliberately: `lib/hooks.ts`, `lib/api.ts`,
`backend/doer/api/settings_routes.py`. The analyzer confirmed the data path is
correct end to end. Five deletes in the reported session each returned 204 and
each was followed by a refetch within 19 milliseconds. Nothing on the server
needs to move.

## 6. Regression Risk

**Low, with two named exceptions.**

`onSettled` fires on failure as well as success, so a genuinely failed delete now
triggers a refetch. That is the point, and it is harmless: the refetch returns
the truth either way.

**Exception 1: the `edited.current` invariant.** This ref gates the suggestion
effect and is written in five places and reset in one. ADR 0002 records why it
is claimed on pointer *down* rather than on first move: a window-focus refetch
landing mid-gesture must not re-seed the form. Adding a sixth writer is exactly
the class of change that invariant is fragile to. The new writer sets it in the
delete handler, before the mutation is issued, and the reset in `add`'s
`onSuccess` is left untouched, so adding a block still hands the form back to
the suggestion logic.

**Exception 2: widened invalidation increases request volume.** A block edit now
refetches the day and the heatmap as well as the blocks. That is three requests
where there was one, on a user action that is infrequent and deliberate. The
same breadth has been in `useTaskMutation` since M2 on a far more frequent path.

## 7. Test Plan

Automated, in `frontend/src/__tests__/settings_blocks.test.tsx`:

1. Deleting a block issues `DELETE /settings/blocks/{id}`.
2. After a **successful** delete, the blocks, day and heatmap queries are all
   invalidated.
3. After a **failed** delete, they are still invalidated. This is the regression
   test for the reported incident.
4. A failed delete renders a visible error naming the failure.
5. A successful delete does not move the From and Until fields into the freed
   slot.
6. Adding a block still does move them to the next free stretch, so the
   behaviour the effect exists for is preserved.
7. The same invalidation breadth holds for add as for remove.

Manual: Flow 16 in full, since this touches the form the timeline drives; Flow
23 for the error treatment. Specifically, with the API stopped, a delete must
show a visible failure rather than appearing to do nothing.

Verification that the third defect is actually closed: edit a block, then move
to Today and confirm the committed-versus-fits figures change without a reload.

## 8. Verification

Applied and verified 2026-10-24.

**Automated.** Seven cases in `frontend/src/__tests__/settings_blocks.test.tsx`.
Four of them were run against the unfixed mutations first and fail there
(T-FIX-02, T-FIX-03, T-FIX-05, T-FIX-07), which is the evidence that they test
the defect rather than the implementation. T-FIX-04 guards the error surface,
which was a separate edit. Full suite 323 tests across 14 files, lint clean,
production build green. The 146-case untouched floor from AC-IO-01 is intact.

**Live, in the running application**, which is where the defect was reported and
the only place the third finding could be confirmed:

1. Added a block at 13:00 to 15:00. The list, the timeline, the focus figure
   (9h to 11h) and the flagged figure (4h 30m to 5h 30m) all updated, and the
   window moved on to 15:00 to 17:00, which is the behaviour the suggestion
   effect exists for and which this fix preserves.
2. Removed it. The row went, and the 13:00 to 15:00 region of the timeline is
   now genuinely empty: no solid band and, critically, no dashed one. The window
   stayed at 15:00 to 17:00 instead of jumping into the freed slot.
3. Moved to Today without reloading. It reads "0m of the 4h 30m that fits",
   matching the recomputed threshold. Before this fix it would have kept showing
   the previous day shape's figure.

## 9. Rollback Plan

One file of application code. Revert `frontend/src/pages/Settings.tsx` to its
prior revision; the new test file fails and is deleted with it. No schema
change, no API change, no dependency change, so there is nothing to unwind on
the server or in the database.

The doc amendment to Flow 16.13 should be reverted with it, since it describes
the fixed behaviour.

## Deferred

Recorded here rather than widened into this fix.

1. **`DayShapeForm.save` has the same narrow shape.** It invalidates `keys.me`
   only, on `onSuccess`. Day shape feeds capacity exactly as blocks do, so the
   open day goes stale after a day-shape save too. Not reported, not reproduced,
   and outside the symptom under investigation.
2. **A shared `useBlockMutation`.** Would define invalidation breadth once for
   all three Settings mutations, and would remove the second data-access pattern
   that the architecture survey flagged in `Settings.tsx`. Declined as larger
   than this defect warrants.
3. **The dashed preview is visually indistinguishable from a block.** Fixing
   that would also stop the window moving under a user on a window-focus
   refetch. Design work rather than a fix.
4. **`api.ts` sends `Content-Type` on every request**, including GETs with no
   body, which forces a CORS preflight on each one. Visible as `OPTIONS` before
   every `GET` in the access log. A performance nit, not a defect.
5. **`api.ts` does not forward React Query's `AbortSignal`**, so cancelled
   refetches still complete on the wire. Harmless today, because the result is
   discarded, but it makes future races harder to reason about.
