---
type: roadmap
created: 2026-10-20
updated: 2026-10-21
---

# Roadmap

## Milestones

Derived from implementation plan `daily-task-planner` v1 and ADR 0001 (local-first FastAPI monolith, proposed). No dates committed yet.

**Prerequisite (not a milestone): tracking plan. Satisfied 2026-10-21.** `docs/metrics/daily-task-planner_tracking_plan.md` defines 30 events across 4 domains, the `daily_metrics` aggregate row, and the unit economics. It requires no migration of `logical_days` or the task state machine, so ADR 0001 stands. Instrumentation lands inside each milestone as its state transitions are built, with events written in the same transaction as the state change so acceptance criterion AC-08 is provable.

**Prerequisite (not a milestone): repository hygiene.** Git initialized by the user on 2026-10-20. A `.gitignore` covering `.venv`, `node_modules`, `__pycache__`, `.env`, and `.DS_Store` still needs confirming before scaffolding lands, since `.env` carries the Fernet key and the Anthropic API key.

- **M1: Foundations.** Docker Compose scaffolding (Postgres 17, FastAPI under uvicorn, Vite dev server), uv project setup on Python 3.13, Alembic baseline, Google OAuth authorization code flow with `calendar.freebusy` in one consent screen, Fernet-encrypted refresh token storage, session cookie, logical day model (materialized rows, anchor date, snapshotted shape and capacity), preference blocks. Status: **done** (2026-10-21).
- **M2: Task core.** Task CRUD, primary and non-primary split, 4-primary cap, completed-task immutability, reversal allowed only before day close, carry-forward with precedence, lazy idempotent day close. Status: **done** (2026-10-21).
- **M3: Assistant and estimation.** Chat capture with confirmable proposals, inline estimation attempt, task-row estimation state, in-process asyncio sweeper with bounded retries, 15-minute bucket enforcement and clamping, manual override, per-user estimate cache. Status: **done** (2026-10-21).
- **M4: Capacity and scoring.** On-demand `freebusy.query` calls over the logical day window with snapshot reuse on failure, busy-interval-only persistence, net capacity base, configurable 50% threshold, at-risk flag, 75% verdict with the 2-primary neutral floor, indeterminate handling when focus blocks or estimates are missing. Status: **done** (2026-10-21).
- **M5: Surfaces.** Minimal dashboard, collapsible chat, manual add, drag-to-reorder with persisted sort index, hand-built two-view heatmap grid, settings. Status: **done** (2026-10-21).
- **M6: Metrics verification and aggregates.** The `daily_metrics` aggregate row, the rollup of logged token counts into `inference_cost_usd`, and verification that every event in the tracking plan fires exactly once per transition (AC-08, test group T-EVT). Status: **done** (2026-10-21).
- **M7: Production container parity.** The single-container target in which FastAPI serves the built SPA is built and smoke-tested at every milestone boundary rather than at the end. Status: **held green through M1 to M6** (2026-10-21).

**Deferred to v2 by ADR 0001:** remote hosting (Cloud Run plus managed Postgres is the indicated path, since a GCP project is already mandatory for OAuth and Calendar), CI, error reporting, push-based calendar sync, and any background worker or Redis.

## Feature Checklist

- [ ] daily-task-planner: Daily commitment planner with 4-task cap, 75% success rule, user-defined logical day, and read-only Google Calendar capacity input (plan: v1, status: in_progress)

Plan approved by the user on 2026-10-21, moved to `in_progress` when M1 began.

## Business Objective Coverage

- daily-task-planner: **Not started.** Objective is to validate that the 75% commitment contract changes behavior for a single user before investing in multi-user capability. Tracking plan `docs/metrics/daily-task-planner_tracking_plan.md` exists at status `draft`; no verdict yet, because no data exists. North star is the rolling 7-day success rate, guarded against commitment-shrinking by three anti-gaming guardrails (committed minutes, scheduled primaries, neutral-day rate). Review fires after 30 scored days, a usage threshold rather than a calendar date. `review_due` stays null until release-mode sets it at ship time.

## Unplanned Work

None. Items with `unplanned: true` in their frontmatter appear here.

## Next Up

1. **Begin M1.** Both prerequisites are now satisfied. First concrete steps: confirm `.gitignore` covers `.env`, scaffold the compose environment (Postgres 17, FastAPI, Vite), and create the GCP project per `docs/setup/gcp_setup.md`.
2. **Approve the plan.** It is still `draft`. It now carries an approach (ADR 0001), 21 acceptance criteria, 75 test definitions, and a tracking plan, so there is nothing left to discover before it moves to `approved`.

Completed since the last update:

- **git init** done by the user on 2026-10-20. A `.gitignore` covering `.venv`, `node_modules`, `__pycache__`, `.env`, and `.DS_Store` still needs verifying before scaffolding lands, since `.env` will carry the Fernet key and the Anthropic API key.
- **architecture-mode**: ADR 0001 (local-first FastAPI monolith), status proposed, amended twice (OAuth publishing status on 2026-10-20, calendar scope settled as `calendar.freebusy` with `freebusy.query` on 2026-10-21).
- **qa-mode**: plan §11 carries 21 acceptance criteria and 75 automated test case definitions across 9 groups; `docs/user_testing_documentation.md` carries 15 manual flows. Run ahead of metrics-mode at the user's direction rather than after it.
- **metrics-mode**: tracking plan written 2026-10-21, status `draft`. Estimation runs on `claude-haiku-4-5` and chat parsing on `claude-opus-5`, projected at roughly $1.30 per month against a $5 ceiling.
- **GCP setup guide** at `docs/setup/gcp_setup.md`. Research during that work corrected a factual error in ADR 0001: Testing publishing status with an External user type expires refresh tokens 7 days after consent, so the project must be Internal under a Workspace organization or External published to production.
