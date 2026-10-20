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

Plan status stays `in_progress` rather than `shipped`: release-mode sets `shipped`
at ship time, and nothing has shipped, because deployment is deliberately out of
v1 scope. The implementation is complete.

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

None. Every change traces to plan v1 or to a correction recorded in ADR 0001's
amendments.

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

## Verification

Checked on 2026-10-21 rather than asserted:

- All 21 acceptance criteria (AC-01 to AC-21) have at least one automated test.
- All 76 named test cases (T-*) in plan §11.3 are implemented. 190 backend tests
  plus 18 frontend tests; 7 live tests excluded from the default run.
- All 31 events in the tracking plan are emitted by the code.
- The runtime container builds and serves both the SPA and the API.

## Next Up

1. **Use it.** Nothing further is needed to start recording days. The validation
   question is behavioral and cannot be answered by more building.
2. **Create the GCP project** when calendar-aware capacity is wanted; the app works
   without it, degraded to raw focus-block capacity. See `docs/setup/gcp_setup.md`.
3. **One Drift Note remains** in `docs/doer/DOCUMENTATION.md`: `actual_minutes`
   is populated only for tasks that were explicitly started, so the
   estimation-error indicator reads over a subset. Worth revisiting if that subset
   is thin at review time.
4. **Post-launch review** after 30 scored days: re-enter metrics-mode, answer the
   five questions in tracking plan §6 in order, and write the verdict back.
5. **release-mode** only if and when deployment is wanted. That is a v2 decision,
   and ADR 0001 names Cloud Run plus managed Postgres as the indicated path.
