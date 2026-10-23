---
type: roadmap
created: 2026-10-20
updated: 2026-10-23
---

# Roadmap

## Milestones

Derived from implementation plan `daily-task-planner` v1 and ADR 0001 (accepted).
All seven complete on 2026-10-21.

Prerequisites, both satisfied as stated: the tracking plan (`docs/metrics/daily-task-planner_tracking_plan.md`)
was written before M1 so instrumentation landed with each transition rather than
after, and the repository was initialized with a `.gitignore` covering `.venv`,
`node_modules`, `__pycache__`, `.env`, and `.DS_Store` before any scaffolding existed.

The second prerequisite was met and still proved insufficient. That list
enumerates the artifacts anticipated at the time, and `frontend/.pnpm-store`
was not among them, so 122 MB entered history during M5 and was only removed on
2026-10-21. Recorded here because the prerequisite reads as a guarantee and is
not one: see `docs/fixes/fix_plan_pnpm-store-committed-to-history.md`.

- [x] **M1: Foundations.** Docker Compose, uv on Python 3.13, Alembic baseline,
      Google OAuth with `calendar.freebusy`, Fernet-encrypted tokens, session
      cookie, materialized logical days with DST-correct arithmetic, preference
      blocks, the event writer and its append-only trigger.
- [x] **M2: Task core.** CRUD, the 4-primary cap with remedies, completed-task
      immutability enforced by trigger, reversal only before close, carry-forward
      with precedence, lazy idempotent close.
- [x] **M3: Assistant and estimation.** 15-minute buckets on `claude-haiku-4-5`,
      inline attempt plus in-process sweeper, per-user cache, confirmable chat
      proposals on `claude-opus-5`.
- [x] **M4: Capacity and scoring.** `freebusy.query` with window clipping and
      interval merging, snapshot reuse on failure, net capacity, the at-risk flag,
      the 75% verdict with the 2-primary neutral floor.
- [x] **M5: Surfaces.** Dashboard, collapsible chat, manual add, drag reorder,
      hand-built two-view heatmap, settings.
- [x] **M6: Metrics verification and aggregates.** `daily_metrics`, cost rollup
      from real token counts, event coverage verified transition by transition.
- [x] **M7: Production container parity.** The runtime image was built and
      smoke-tested at every milestone boundary and is green.

**Deferred to v2 by ADR 0001:** remote hosting (Cloud Run plus managed Postgres is
the indicated path, since a GCP project is already mandatory for OAuth), CI, error
reporting, push-based calendar sync, and any background worker or Redis.

## Feature Checklist

- [x] daily-task-planner: Daily commitment planner with 4-task cap, 75% success rule, user-defined logical day, and read-only Google Calendar capacity input (plan: v1, status: in_progress)
- [ ] provisional-day-signal: Live on-track or behind state for the day in progress in the history heatmap, additive to the persisted verdict (plan: v1, status: draft)
- [x] timeline-window-drag: Drag and resize the dashed preference block window directly on the day timeline, snapping to wall-clock half hours and to block edges, magnetically kept clear of existing blocks (plan: v1, status: approved)

timeline-window-drag is ticked as of 2026-10-23: both manual gates pass, the
changelog carries an entry, and the plan reads `approved`. It is **not** `shipped`,
and the distinction is real rather than bookkeeping. Nothing is deployed anywhere;
ADR 0001 defers hosting to v2, so the application runs on one machine. The release
checklist (`docs/releases/timeline-window-drag_release_checklist.md`) sits at
`ready` for the same reason, and names the one readiness gap: no tracking plan
exists for this feature, so nothing measures whether direct manipulation actually
made block setup faster. metrics-mode owns that.

Plan status stays `in_progress` rather than `shipped`: release-mode sets `shipped`
at ship time, and nothing has shipped, because deployment is deliberately out of
v1 scope. The implementation is complete.

## Fixes

- [x] stale-block-snapshot: Preference block edits did not reach the day in progress, so the "set up a work block" nudge survived the user acting on it (fix: high, status: verified)
- [x] heatmap-utc-date-shift: The history grid was labelled in UTC while cells are keyed by anchor dates in the user's timezone, so every label ran a day early (fix: high, status: verified)
- [x] tests-wipe-production-database: The suite dropped the schema of whatever DATABASE_URL named, and the api container names production, so running it destroyed all application data (fix: critical, status: verified)
- [x] signout-leaves-page-frozen: queryClient.clear() orphaned the mounted observers on stale success, so signing out left the dashboard on screen until a manual reload (fix: high, status: verified)
- [x] time-inputs-show-12-hour-clock: The three Settings time fields rendered a 12-hour clock with AM/PM, because `<input type="time">` takes its format from the browser locale and cannot be constrained; replaced with a custom 24-hour ClockInput (fix: low, status: verified)
- [x] pnpm-store-committed-to-history: The compose web service wrote pnpm's package store onto the host bind mount and nothing ignored it, so 122 MB and 7,863 files entered git history, 98.1% of the repository by size (fix: medium, status: verified)

All six fixes are verified. Flow 17, the manual gate on the clock field, was run
and reported passing on 2026-10-23, alongside Flow 16 for the timeline drag.

## Business Objective Coverage

- daily-task-planner: **Instrumented, not yet measured.** The objective is to
  validate that the 75% commitment contract changes behavior for a single user
  before investing in multi-user capability. All 31 events in the tracking plan are
  emitted, and `daily_metrics` rows are written at close, so the data needed for a
  verdict now exists. No verdict can be cited yet because no real days have been
  recorded. North star is the rolling 7-day success rate, guarded against
  commitment-shrinking by three anti-gaming guardrails. Review fires after **30
  scored days**, a usage threshold rather than a calendar date. `review_due` stays
  null until release-mode sets it.

## Unplanned Work

None. No plan or fix plan carries `unplanned: true`, which is what this section
tracks.

Two exclusions worth stating, so the empty list is not read as a claim that
nothing happened. Defect work is tracked under Fixes above, not here. And by
agreement on 2026-10-21, layout-only fixes (no behavior change, no contract
change, no data-shape change) are applied without a fix plan, so they carry no
frontmatter and appear in neither section; commit `6e21e0a` is the first of
those. That SHA was `7d67df6` until the 2026-10-21 history rewrite re-pointed it.

## Scope and Document Corrections

Recorded here because each changed a commitment made in an earlier document.

1. **Carry-forward precedence (AC-21)** was added after implementation surfaced a
   direct collision between two Must requirements: carry-forward is unconditional,
   and a day holds at most four primaries.
2. **`calendar.freebusy` replaced `calendar.readonly`.** Least privilege, and
   titles never reach the server. It also means the calendar list cannot be
   enumerated, so v1 reads the primary calendar only.
3. **The OAuth publishing status was wrong in ADR 0001 as first written.** Testing
   mode with an External user type expires refresh tokens after 7 days.
4. **Six backend and two frontend dependencies** were specified and proved
   unnecessary. Removed from the manifests rather than left as aspiration.
5. **The API runs on port 8787**, not 8000, which was occupied on the development
   machine.
6. **AC-13 freezes the day shape, not the preference blocks.** Plan line 54 defines
   day shape as start time and duration; the implementation generalized the freeze
   to cover blocks as well, which made the dashboard's own nudge unactionable until
   the next day. Corrected by `docs/fixes/fix_plan_stale-block-snapshot.md`. AC-13's
   wording is worth tightening if plan v2 is ever written.
7. **The test suite never had its own database.** Plan §11 line 279 states that
   the suite "creates and migrates its own `doer_test` database and never touches
   the development one", and `docs/doer/DOCUMENTATION.md` repeated it. Neither was
   true: nothing created that database and nothing confined the suite to it, which
   is how the 2026-10-21 data loss happened. The property is now enforced by two
   assertions in `backend/tests/conftest.py`, so the separation is guarded rather
   than designed in. Plan v1 is left as written, being the record of what was
   planned; `DOCUMENTATION.md` is corrected.
8. **Development runs more than three compose services.** `README.md` and
   `docs/adr/0001-local-first-fastapi-monolith.md` both describe db, api and web.
   An always-on `backup` service and a profile-gated `tests` service now exist.
   The README is corrected; the ADR is left as written, since ADRs record the
   decision of their time.

## Verification

Checked on 2026-10-21 rather than asserted:

- All 21 acceptance criteria (AC-01 to AC-21) have at least one automated test.
- All 76 named test cases (T-*) in plan §11.3 are implemented. 208 backend tests
  plus 74 frontend tests as of 2026-10-21, the last check of the day; 7 live tests
  excluded from the default run. Figures here have been stale twice in one day, so
  treat any count in a document as the date it carries, not as current.
- All 31 events in the tracking plan are emitted by the code.
- The runtime container builds and serves both the SPA and the API.

## Next Up

1. **Use it.** Nothing further is needed to start recording days. The validation
   question is behavioral and cannot be answered by more building.
2. **Create the GCP project** when calendar-aware capacity is wanted; the app works
   without it, degraded to raw focus-block capacity. See `docs/setup/gcp_setup.md`.
3. **Three Drift Notes stand** in `docs/doer/DOCUMENTATION.md`: `actual_minutes`
   covers only explicitly started tasks, so the estimation-error indicator reads
   over a subset; a user row cannot be deleted once it has events; and calendar
   busy time is un-subtracted by any task mutation until the next stale sync.
4. **provisional-day-signal, plan v1 is draft.** Architecture-mode next: the two
   open questions that decide the shape are how "substantially elapsed" is defined
   and whether `scheduled_primary` becomes live-when-open in the same change.
5. **timeline-window-drag is built, verified and in the changelog.** ADR 0002
   (accepted 2026-10-22) settles grid-plus-flush snapping, an unclipped overlay
   layer for the handles, pure geometry in `daytime.ts` with a humble component,
   and no DOM test harness. The survey behind it found plan v1's M1, M2 and M6
   mutually unsatisfiable whenever a block or a window is off the half-hour grid;
   those requirements were corrected in place, a clarification rather than a scope
   change, so the plan stays at v1.

   Implemented 2026-10-23 in `frontend/src/lib/daytime.ts`,
   `frontend/src/components/DayTimeline.tsx` and `frontend/src/pages/Settings.tsx`.
   The frontend suite went from 74 tests to 117: 33 new geometry cases and 10 new
   markup cases, with every pre-existing test unmodified. `pnpm lint` and the
   production build are green and `package.json` is unchanged, so ADR 0002's
   no-new-dependency decision held in practice. (The suite has since reached 158
   with the clock field fix; see item 6.)

   **Flow 16 passed**, run manually and reported by the user on 2026-10-23. ADR
   0002 named it the gate on the roughly 60 lines of pointer wiring that ship
   without automated coverage, so the feature is now verified end to end. All 28
   steps, including the phase-shifted day at 14:15.

   **Shipped as far as this project ships.** Commit `ecfcfc9`. release-mode ran on
   2026-10-23: the changelog carries Added, Changed and Fixed entries under
   `[Unreleased]`, the release checklist is written at `ready`, and the plan is
   `approved` at the user's instruction. `shipped` is deliberately not set, because
   there is no deployment for it to describe.

   **One gap remains, and it is a measurement gap rather than a quality one.**
   No tracking plan exists for this feature, so no event fires when anyone drags,
   resizes, or types a block time. The 31-event inventory is unchanged. The stated
   reason for building direct manipulation was that typing two clock strings is
   slow and error-prone, and nothing currently tests whether that is now false.
   metrics-mode owns it.

   **Two additions beyond the plan, both deliberate.**
   `frontend/src/__tests__/day_timeline.test.tsx` renders the component with
   `react-dom/server`, which needs no DOM and no new dependency, and asserts
   markup structure only: ARIA on both handles, three tab stops, the overlay
   passing pointer events through, and the read-only bar rendering unchanged with
   no handler passed. It does not test gestures and does not reopen the harness
   decision. Separately, `doc-crawler` found a real defect by executing the
   module: an edge drag could pass straight through a block when the window
   already straddled one, because such a block is neither entirely left of the
   window nor entirely right of it and the barrier fell back to the day's edge.
   Fixed, with three tests.

   **The `freeGaps` question is settled.** Dropped on the user's instruction,
   2026-10-23. `firstFreeGap` and its tests are untouched, which honours S5 more
   strongly than rewriting them would. ADR 0002 carries a dated withdrawal of the
   clause rather than a deletion, so the decision as accepted stays legible.

6. **time-inputs-show-12-hour-clock is verified.** The
   three Settings time fields rendered a 12-hour clock because
   `<input type="time">` takes its format from the browser's locale. Verified
   against engine source rather than assumed: Firefox never reads the `lang`
   attribute for this control, and release Chromium discards it behind a flag that
   ships with no status, which its own feature file defines as disabled
   everywhere. The CSS route to hiding AM/PM is Chromium-only and leaves the hour
   still cycling 1 to 12. Both apparent one-line fixes would have shipped and
   failed, which is why the analysis was worth doing before the code.

   The reported symptom was itself a misreading the control invited: `12:00 AM` is
   the display of the value `00:00`, so stepping to `01:00` was correct. No data
   was ever wrong, and every other time surface in the app already read 24-hour.

   Applied 2026-10-23 as `frontend/src/components/ClockInput.tsx` plus three call
   sites and new clock arithmetic in `daytime.ts`. The suite is at 158 tests
   across 6 files, lint and build green, `package.json` still unchanged.

   **Two decisions here were changed behaviour, not restored behaviour**, and are
   recorded as dated amendments to ADR 0002, `timeline-window-drag_doc.md` and the
   timeline plan rather than as edits, so a revert restores their original meaning:
   From and Until now accept only `:00` and `:30`, which closes one of the four
   routes to an off-grid time that ADR 0002 relied on; and Starts keeps free minute
   entry, because snapping it would make the phase-shifted grid unreachable through
   the interface and Flow 16.24 to 16.28 unrunnable.

   **Flow 17 passed**, all 18 steps, run manually and reported on 2026-10-23. The
   fix plan is `verified`.

   **Found by review, not by tests.** `doc-crawler` caught a regression introduced
   by the fix itself: `onCommit` fired before React had applied the value `settle()`
   had just emitted, so the end-of-day clamp evaluated against a stale time
   whenever the last keystroke left a pending digit. The settled value is now
   passed to `onCommit` directly. It also caught that arrow-stepping a snapped
   field by 30 from an off-grid seed never reached the grid (15:45, 16:15, 16:45),
   fixed by `stepToMultiple`, and an accessibility regression against the native
   control, fixed by giving each segment real spinbutton semantics under roving
   focus. Earlier in the same change, the first version of the control had no
   working pointer path to the minute segment at all.

   While here, every line number was dropped from ADR 0002 and only file names
   kept. Eight of its citations had drifted, and a document whose references
   cannot be trusted is worse than one that is less precise.

7. **Harden the test separation with a database role.** `doer` and `doer_test`
   share a cluster, a role and a password, so the suite is kept off production by
   two assertions rather than by permissions. A role with no rights on `doer` is
   the version that holds against a malformed URL or a future rewrite of the
   harness. Deferred deliberately in
   `docs/fixes/fix_plan_tests-wipe-production-database.md`.
8. **Documents doc-crawler flagged that are still wrong**, each owned by a mode
   that has not run. The `docs/user_testing_documentation.md` migration wording is
   fixed as of 2026-10-22, verified against `docker-compose.yml:28`. Still open:
   `docs/releases/CHANGELOG.md` has no `[Unreleased]` entries for the three
   2026-10-21 fixes or the heatmap endpoint change, which the 2026-10-23
   release-mode pass did not cover because it was scoped to the two newest changes
   (release-mode); and `.env.example` line 4 disagrees with
   `docs/setup/gcp_setup.md` line 130 about the database host, which sends a
   reader following one of them to a connection failure and the other to
   production.
9. **Tracking plan wanted for timeline-window-drag.** The feature is built,
   verified and in the changelog, and no event measures it. Block definition is on
   the critical path to the capacity model working at all, and the case for direct
   manipulation was that typing two clock strings is slow and error-prone. That
   claim is currently untested. metrics-mode owns it; named in the release
   checklist as the single unmet readiness item.
10. **Sign-out is unplanned and unmeasured.** Plan v1 §4 lists no requirement for
   session termination and AC-01 to AC-21 contain no criterion for it, so the
   control fills an unenumerated gap rather than satisfying a commitment. It also
   emits no event, where sign-in emits `user_signed_in`, so the tracking plan's
   31-event inventory is unchanged while a new user-facing transition exists.
   Worth a decision in metrics-mode rather than a silent asymmetry.
11. **Fix plan wanted for the Docker build context.** No `.dockerignore` exists, so
   the context carries roughly 264 MB of ignored-but-copied artifacts, and
   `Dockerfile:27` copies the host's darwin-arm64 `node_modules` over the linux
   install from line 26. The size half is cosmetic; the overlay half is a
   correctness question that no build has been run to settle. Declined as
   out-of-scope in `docs/fixes/fix_plan_pnpm-store-committed-to-history.md`.
12. **`README.md` does not reach the fix plans or the newer ADR, and no mode owns
   it.** Its "Where the thinking is written down" table lists six documents and
   omits `docs/fixes/` entirely, so none of the five fix plans is discoverable
   from the entry point, and the 2026-10-21 history rewrite is recorded nowhere a
   reader starting at the README would find it. As of 2026-10-23 the table also
   omits ADR 0002 and both newer plans, so the ADR index it presents is no longer
   complete. Its "## Tests" section lists only the backend `pytest` invocations
   and never mentions `cd frontend && pnpm test`, so a reader following the README
   alone never runs the 158 frontend tests. The re-clone guidance now lives in
   `docs/doer/DOCUMENTATION.md`. `README.md` appears in no row of CLAUDE.md's
   file ownership table, so this needs either a user decision or a new owner.
13. **Fix plan wanted for the busy-subtraction wipe.** Nine of the eleven
   `recompute_capacity` call sites pass no `busy`, inflating a calendar-connected
   user's threshold after any task write. Found during the stale-block-snapshot
   analysis and deliberately left out of that fix's scope.
14. **Post-launch review** after 30 scored days: re-enter metrics-mode, answer the
   five questions in tracking plan §6 in order, and write the verdict back.
15. **release-mode** only if and when deployment is wanted. That is a v2 decision,
   and ADR 0001 names Cloud Run plus managed Postgres as the indicated path.
