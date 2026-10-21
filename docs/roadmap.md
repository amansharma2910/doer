---
type: roadmap
created: 2026-10-20
updated: 2026-10-21
---

# Roadmap

## Milestones

Derived from implementation plan `daily-task-planner` v1 and ADR 0001 (accepted).
All seven complete on 2026-10-21.

Prerequisites, both satisfied: the tracking plan (`docs/metrics/daily-task-planner_tracking_plan.md`)
was written before M1 so instrumentation landed with each transition rather than
after, and the repository was initialized with a `.gitignore` covering `.venv`,
`node_modules`, `__pycache__`, `.env`, and `.DS_Store` before any scaffolding existed.

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

Plan status stays `in_progress` rather than `shipped`: release-mode sets `shipped`
at ship time, and nothing has shipped, because deployment is deliberately out of
v1 scope. The implementation is complete.

## Fixes

- [x] stale-block-snapshot: Preference block edits did not reach the day in progress, so the "set up a work block" nudge survived the user acting on it (fix: high, status: verified)
- [x] heatmap-utc-date-shift: The history grid was labelled in UTC while cells are keyed by anchor dates in the user's timezone, so every label ran a day early (fix: high, status: verified)
- [x] tests-wipe-production-database: The suite dropped the schema of whatever DATABASE_URL named, and the api container names production, so running it destroyed all application data (fix: critical, status: verified)

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
frontmatter and appear in neither section; commit `7d67df6` is the first of
those.

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
- All 76 named test cases (T-*) in plan §11.3 are implemented. 205 backend tests
  plus 72 frontend tests as of 2026-10-21; 7 live tests excluded from the default
  run. The earlier figures here (190 and 18) were stale and disagreed with
  `docs/doer/DOCUMENTATION.md`.
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
5. **Harden the test separation with a database role.** `doer` and `doer_test`
   share a cluster, a role and a password, so the suite is kept off production by
   two assertions rather than by permissions. A role with no rights on `doer` is
   the version that holds against a malformed URL or a future rewrite of the
   harness. Deferred deliberately in
   `docs/fixes/fix_plan_tests-wipe-production-database.md`.
6. **Documents doc-crawler flagged and this pass did not change**, each owned by a
   mode that has not run: `docs/user_testing_documentation.md` lines 13 and 18
   claim nothing runs migrations automatically, which contradicts the container
   start command (qa-mode owns that file); `docs/releases/CHANGELOG.md` has no
   `[Unreleased]` entries for today's three fixes or the heatmap endpoint change
   (release-mode); and `.env.example` line 4 disagrees with
   `docs/setup/gcp_setup.md` line 130 about the database host, which sends a
   reader following one of them to a connection failure and the other to
   production.
7. **Fix plan wanted for the busy-subtraction wipe.** Nine of the eleven
   `recompute_capacity` call sites pass no `busy`, inflating a calendar-connected
   user's threshold after any task write. Found during the stale-block-snapshot
   analysis and deliberately left out of that fix's scope.
8. **Post-launch review** after 30 scored days: re-enter metrics-mode, answer the
   five questions in tracking plan §6 in order, and write the verdict back.
9. **release-mode** only if and when deployment is wanted. That is a v2 decision,
   and ADR 0001 names Cloud Run plus managed Postgres as the indicated path.
