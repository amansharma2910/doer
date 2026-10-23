---
type: release_checklist
feature: timeline-window-drag
status: ready
linear_issue: null
created: 2026-10-23
updated: 2026-10-23
---

# Release checklist: timeline-window-drag

Covers the direct-manipulation timeline and the 24-hour clock field
(`docs/fixes/fix_plan_time-inputs-show-12-hour-clock.md`), which shipped together
in commit `ecfcfc9`.

Status is `ready`, not `released`, and the plan stays `approved` rather than
`shipped`. Nothing is deployed anywhere: ADR 0001 defers hosting, CI, and error
reporting to v2, and the application runs only on the developer's machine. Marking
this `released` would be a claim about a deployment that does not exist.

## 1. Readiness

| Check | State |
|---|---|
| Acceptance criteria (AC-TWD-01 to AC-TWD-26) | Pass |
| Automated suite | 158 frontend tests across 6 files, up from 74 |
| Backend suite | Unaffected, no backend change in the commit |
| `pnpm lint` and production build | Green |
| Manual gate, Flow 16 (28 steps) | Run and passed, 2026-10-23 |
| Manual gate, Flow 17 (18 steps) | Run and passed, 2026-10-23 |
| Documentation | Project doc, two feature docs, ADR, plan, testing doc all current |
| New dependencies | None. `package.json` and the lockfile untouched |
| **Instrumentation** | **Not met.** See below |

**The one gap, recorded rather than resolved.** There is no tracking plan for this
feature, so no event fires when a user drags, resizes, or types a block time. The
31-event inventory is unchanged. That matters more than it looks: block definition
is on the critical path to the capacity model working at all, and the stated reason
for building direct manipulation was that typing two clock strings is slow and
error-prone. Nothing currently measures whether that is now true. metrics-mode owns
this; it is a prerequisite for the claim, not for the code.

## 2. Rollout

There is no rollout mechanism, and inventing one would be fiction. A feature flag
splits a population; this application has one user and one machine. Staged
percentages, canaries, and cohort analysis have nothing to divide.

What exists instead:

- **Delivery.** `git pull`, then `docker compose up -d --build`. The `web` service
  runs Vite in development mode, so the frontend change is live on reload; no
  migration runs because there is no schema change.
- **Blast radius if wrong.** The Settings page only. The dashboard, task flow,
  assistant, calendar sync, and scoring are untouched by the commit.
- **Who decides.** The single user, on sight.

## 3. Rollback

- **Path.** `git revert ecfcfc9`, rebuild. The commit is self-contained.
- **Data.** No migration, no schema change, no wire-format change, so there is no
  down-path to write and no point of no return. Preference blocks are stored as
  integer offsets exactly as before, and any block created through the new control
  is indistinguishable from one created by typing.
- **Documents.** The two behaviour decisions that reversed earlier ones, snapping
  From and Until to `:00` and `:30`, are recorded as dated amendments in ADR 0002
  and `docs/features/timeline-window-drag_doc.md` rather than as edits. A revert
  therefore restores those documents' original meaning without erasing the record
  that the decision was taken and undone.
- **Partial rollback.** The clock field and the drag can be reverted independently
  in principle, but not by reverting half a commit: they share three source files.
  Reverting the whole commit is the supported path.

## 4. Release notes

### Internal

Two changes to the Settings day-shape editor, landed together in `ecfcfc9`.

The preference block preview is now directly manipulable. Placement is magnetic:
candidate positions are the wall-clock half hours plus anchors, meaning block
boundaries and the day's two ends, and body drags filter to positions that overlap
nothing, so a gesture cannot create an invalid block. The design question that
shaped it, recorded in ADR 0002, was that snapping every edge to the grid,
preserving window length, and parking flush against a neighbour are mutually
unsatisfiable once anything sits off the grid. Adding anchors resolves it.

The three time fields were replaced because `<input type="time">` takes its format
from the browser locale and cannot be constrained, verified against Chromium and
Gecko source rather than assumed. The reported "hour goes back to 1:00 AM" was a
misreading the control invited: `12:00 AM` displays the value `00:00`.

All geometry and clock arithmetic is pure functions in `daytime.ts`, covered by
tests; the components only convert pixels to minutes and track segments. ADR 0002
declined a DOM test harness, so the pointer and keystroke layers are gated by
Flows 16 and 17 of the user testing documentation instead, both of which passed.

### User-facing

Setting up your day is now something you do by hand rather than by typing.

Drag the dashed window along the bar to move a block, or pull either edge to make
it longer or shorter. It snaps to half hours and to the edges of blocks you have
already marked out, so it lands flush with no awkward gaps, and it will not let you
overlap something. Push it into an existing block and it slides past to the free
time on the other side.

Times now read on a 24-hour clock throughout. One in the afternoon is 13:00, and
the hour rolls from 23:00 round to 00:00. AM and PM are gone.

## 5. Ship bookkeeping

- [x] Changelog entry under `[Unreleased]` in `docs/releases/CHANGELOG.md`
- [x] Plan status set to `approved` (by user instruction; `shipped` would be false)
- [x] Fix plan status set to `verified`
- [x] This checklist written, status `ready`
- [ ] Plan status `shipped` and tracking plan `review_due` set. Deferred: both
      belong at an actual deployment, which ADR 0001 puts in v2
- [ ] Tracking plan for this feature. metrics-mode owns it
- [x] roadmap-mode triggered

Launch communication is undefined and no GTM material exists for this feature. If
that is wanted, gtm-strategy is the mode, and it never runs on its own.
