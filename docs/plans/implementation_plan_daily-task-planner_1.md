---
type: implementation_plan
feature: daily-task-planner
version: 1
status: in_progress
unplanned: false
linear_issue: null
created: 2026-10-20
updated: 2026-10-21
---

# Implementation Plan: Doer Daily Task Planner (v1)

## 1. Problem Statement

Conventional task managers fail two ways for people with non-standard schedules. First, they anchor everything to the midnight-to-midnight calendar date, so a person whose working day runs 14:00 to 05:00 has every late-night accomplishment land on the wrong square and every "today" view reset in the middle of their most productive stretch. Second, they accept unbounded task lists, which means a day never has a defined outcome: there is no point at which the day was a success or a failure, so there is no signal to learn from and no pressure to commit honestly.

Doer addresses both. It replaces the unbounded list with a daily commitment contract (at most 4 primary tasks, 75% completion counts as success), and it replaces the calendar date with a user-defined logical day that can span midnight. The assistant estimates effort so over-commitment is visible before the day starts rather than discovered at the end of it.

## 2. Business Objective and End Goal

The objective of v1 is to validate that the 75% commitment contract changes behavior for a single user before any investment in multi-user capability. The app is not trying to be a better task manager, it is trying to make daily commitment legible and scoreable.

End state for v1: the user plans and scores their day in Doer every day, the heatmap shows a real history of pass, fail, and neutral days, and the metrics tables hold enough per-task and per-day data to answer later questions about estimation accuracy, over-commitment, and streak behavior without a schema migration.

Secondary objective: accumulate an estimation accuracy corpus (estimated versus actual) that a future version can use to calibrate the assistant per user.

## 3. Users and UX

Primary user for v1 is a single operator with a late-shifted, self-directed schedule who is already comfortable with developer tooling. Multi-user support exists in the data model (user-scoped rows, per-user auth) but no invitation, sharing, or team surface ships in v1.

Core screens:

- **Dashboard.** Minimal by design. Pending primary tasks for the current logical day are the visual focus. A small, visually recessed section lists tasks completed in that day. A collapsible chat panel docks to the side. A floating plus button opens a manual add form. The current day shows its capacity state inline (neutral or at-risk).
- **Chat (Doer Assistant).** Collapsed by default. The user describes what they want to get done, the assistant parses it into one or more tasks, estimates each, and proposes them. The user confirms before anything is committed.
- **Manual add.** A plus button opens a short form (title, optional notes, primary or non-primary). Estimation still runs automatically in the background; the user never types a duration unless they choose to override.
- **Heatmap.** GitHub-style grid with two toggleable views. View 1 colors by number of tasks completed, with brighter and more opaque green as the count rises and no color for zero. View 2 colors by day verdict: green for success, red for failure, no color for unscored days. Days flagged as over-committed read orange.
- **Settings.** Day shape (start time, duration), preference blocks, Google Calendar connection, capacity ratio.

UX principles: the app never nags. Over-commitment is communicated by color, not by a modal or an alert. The dashboard shows one day at a time and does not expose a backlog view.

## 4. Functional Requirements

### Must

**Identity and calendar**
- Google OAuth sign-in as the only authentication method, requesting login identity and `calendar.freebusy` in a single consent flow.
- Read-only Google Calendar access via `freebusy.query`, returning busy intervals for the user's calendars over the logical day's window. Doer requests availability only, never event content.
- Encrypted storage of OAuth refresh tokens with automatic refresh and an explicit reconnect path when consent is revoked.

**Logical day model**
- Every logical day is stored as an anchor date plus a start time and a duration, so a day may span midnight. The anchor date is the date the day began.
- All task scheduling, completion attribution, carry-forward, scoring, and heatmap placement resolve through the anchor date, never through the raw UTC or local timestamp. A task completed at 03:00 in a day that began 14:00 the previous date paints the previous date's square.
- The user configures one default day shape (start time and duration) in settings. Changing the day shape applies from the next logical day forward and never retroactively rewrites closed days.

**Preference blocks**
- Within a day shape, the user defines typed time blocks: deep work, personal project, personal, social, and other. Blocks are ordered and non-overlapping.
- Blocks tagged as work or personal project are designated focus blocks and form the capacity base.
- Tasks carry a preference type and are placed into matching blocks when ordering the day.

**Tasks**
- Task CRUD for incomplete tasks: create, read, update (title, notes, estimate override, preference type, primary flag, target day), delete.
- A task is either primary or non-primary. At most 4 primary tasks may be assigned to a given logical day. Attempting a fifth is blocked with an inline message offering to demote an existing primary or add the new task as non-primary.
- Non-primary tasks are unlimited and are tracked and logged, but never counted toward the 75% verdict.
- Tasks group under their preference block and are user-orderable within the day by drag, backed by a persisted sort index and a reorder endpoint. New tasks append to the end of their block. Reordering is a user action only; the assistant never re-sequences a day in v1.
- Completed tasks are immutable and are never deleted, hard or soft. Deletion is rejected at the API layer, not just hidden in the UI.
- A completion may be reversed only while its logical day is still open. Once the day has closed and been scored, reversal is rejected and the day's verdict is permanent, so the heatmap can never be rewritten retroactively. Every reversal is recorded as an event alongside the original completion.
- Incomplete tasks at day close carry forward automatically to the next logical day, preserving their primary or non-primary status and their original creation timestamp, with a carry-forward count incremented on each roll. Carry-forward is unconditional and requires no user action; a task the user no longer wants is edited or deleted through normal CRUD after it rolls, not triaged at the boundary.
- **Carry-forward precedence.** Carried primaries claim primary slots ahead of tasks that were pre-assigned to that day while it was still in the future. If the combined count would exceed 4, the excess pre-assigned tasks demote to non-primary, oldest carried task winning, and the user is told which tasks were demoted on first opening the day. An unfinished commitment outranks a new intention. A demotion is recorded as an event and the task can be promoted back manually if a slot frees up.

**Estimation**
- Every task receives an automatic duration estimate from an LLM call (Claude) on creation, through both the chat path and the manual add path.
- Estimates are expressed in 15-minute buckets (15, 30, 45, 60, 90, 120 and upward). The model is prompted to emit a bucket directly; any off-bucket value is snapped up to the next bucket on ingest. Buckets keep the estimate honest about the precision an LLM actually has, and keep the estimated-versus-actual corpus analyzable.
- Estimation is asynchronous. The task appears immediately with a pending estimate and updates in place when the estimate resolves.
- The user may override any estimate manually. Overrides are recorded separately from the model estimate so both survive in the metrics.
- The assistant does not decompose tasks into subtasks in v1.

**Capacity and risk flagging**
- Capacity base for a logical day is the total hours in that day's focus blocks, minus Google Calendar busy time overlapping those blocks.
- The over-commitment threshold is 50% of that net capacity base, stored as a user-level configurable ratio defaulting to 0.5.
- When the sum of primary task estimates for a day exceeds the threshold, the day is flagged at risk. The flag surfaces as an orange day cell and an inline dashboard indicator. No modal, no blocking, no alert.

**Scoring**
- At day close, a day is scored as success when completed primaries divided by scheduled primaries is at least 0.75.
- A day with fewer than 2 scheduled primary tasks is neutral: it is not scored as pass or fail and is excluded from streak and rate calculations.
- A day with 0 scheduled tasks has no color in either heatmap view.
- Day close is computed lazily and idempotently on the next read after the day's end, so a day still scores correctly if the app was never open at the boundary.

**Heatmap**
- View 1: completion count intensity, green, scaling opacity with the number of tasks completed, no color at zero. The count includes both primary and non-primary completions, since non-primary tasks are excluded only from the 75% verdict, not from tracking. View 2 remains primary-only, so the two views deliberately use different denominators.
- View 2: verdict, green for success, red for failure, no color for neutral or unscheduled days.
- At-risk days read orange in both views.

**Assistant**
- Natural-language task capture through chat, producing a structured task proposal (title, preference type, primary or non-primary, estimate) that the user confirms before commit.
- The assistant is scoped to capture and estimation in v1. It does not re-plan, reorder, or answer analytics questions.

**Metrics**
- Append-only event logging covering: task created, estimated, estimate overridden, started, completed, carried forward, promoted or demoted between primary and non-primary, deleted (incomplete only), day opened, day closed, day scored, capacity computed, risk flag raised or cleared, calendar synced.
- Per-day aggregate rows: scheduled primary count, scheduled non-primary count, completed primary count, completed non-primary count, total estimated minutes, total actual minutes where known, capacity base minutes, threshold minutes, at-risk boolean, verdict.

### Should

- Actual-duration tracking: completion timestamps always, with an optional start action so estimated-versus-actual becomes measurable rather than inferred.
- A visible last-synced timestamp, and a cached busy-interval snapshot reused when a refresh fails.
- Staleness handling in the UI when the last successful calendar sync is older than the current day's start.
- Estimation prompt includes the user's preference block types so estimates are context-aware.

### Could

- Per-weekday day shapes (a different shape for weekends).
- Estimate calibration from the user's own logged actuals.
- Streak counters and weekly or monthly rollup views.
- Keyboard-first task entry on the dashboard.
- Assistant-proposed sequencing within preference blocks (hardest first during deep work).

### Won't (this version)

- Writing tasks or blocks back to Google Calendar.
- Subtask decomposition by the assistant.
- Teams, sharing, or any multi-user surface.
- Native mobile applications.
- Push notifications, email, or reminders of any kind.
- Recurring or templated tasks.
- Timezone travel handling (the user's timezone is fixed at the account level).
- Calendar providers other than Google.
- Remote hosting and multi-device access. v1 runs locally only; deployment is a v2 milestone.

## 5. Non-Functional Requirements

**Stack.** React frontend (Vite, decided in ADR 0001) talking to a separate Python FastAPI backend over a versioned REST API. Postgres for persistence. Anthropic Python SDK for estimation and chat parsing. The split exists because the scheduling, capacity, and estimation logic is expected to grow model-heavy, and keeping it in a typed Python service keeps that growth out of the frontend.

**Performance.** Dashboard first paint under 1 second on a warm cache. Task creation returns immediately (under 200ms server time) with estimation resolving asynchronously, target under 5 seconds. Calendar sync runs on a schedule and on demand, never blocking a page render.

**Security.** OAuth tokens encrypted at rest with a key held outside the database. `calendar.freebusy` is the only Calendar scope requested, which is the least-privilege scope that satisfies the requirement: `freebusy.query` returns availability intervals and never event content, so titles and descriptions never reach the server at all rather than being received and discarded. All task and metrics rows are user-scoped, with authorization enforced server-side on every query, not by client filtering. Only busy intervals (start, end) are stored.

**Cost.** One LLM call per task creation, plus one per chat turn. At 4 to 10 tasks a day for a single user this is negligible, but the estimation prompt is kept short and the model choice is revisited in architecture-mode. Estimation results are cached by normalized task text so re-creating an identical task does not re-bill.

**Data integrity.** Completed tasks and all event log rows are append-only. Day scoring is deterministic and recomputable from the event log. Lazy day close must be idempotent under concurrent requests.

**Availability.** Single-user service, no high-availability requirement. v1 runs locally only (ADR 0001); remote hosting is deferred to v2. A failed calendar sync or estimation call degrades the feature, never the app.

**Compliance.** Google OAuth verification requirements apply for the Calendar scope if the app is ever published beyond test users. For v1 with the developer as the sole test user, the unverified-app path is acceptable and is noted as a constraint on expanding user count.

## 5.1 Chosen Approach (ADR 0001)

Local-first FastAPI monolith. Docker Compose on the developer machine: Postgres 17 in a container, FastAPI under uvicorn, and a Vite dev server. A second build target produces the single container in which FastAPI serves the built SPA, maintained and smoke-tested from the first milestone so that deploying later is configuration rather than a rewrite.

- Frontend: Vite, React, TypeScript, React Router, Tailwind, TanStack Query, `@dnd-kit` for drag reordering, `zod`, `date-fns`. The heatmap is a hand-built CSS grid, not a library.
- Backend: Python 3.13 under uv, FastAPI, SQLAlchemy 2.0 async with asyncpg, Alembic, pydantic-settings, the Anthropic SDK, `google-api-python-client` with `google-auth-oauthlib`, `cryptography` for a Fernet envelope around refresh tokens, `tenacity`, `structlog`. Tests use pytest, pytest-asyncio, `freezegun`, and `respx`.
- Logical days are materialized rows keyed on (user, anchor date), with the day shape, capacity base, and threshold snapshotted at day open. All timestamps are `timestamptz` in UTC against a fixed account-level IANA timezone.
- Authentication is the Google authorization code flow handled directly by FastAPI, one consent screen covering `openid`, `email`, `profile`, and `calendar.freebusy` with offline access, session carried in an HttpOnly cookie.
- Calendar reads are on-demand `freebusy.query` calls scoped to the logical day's window against the primary calendar, triggered at day open and by explicit refresh, with the last successful snapshot reused on failure. Note that `calendar.freebusy` does not permit enumerating the user's calendar list, which would require the broader `calendar.readonly` scope; v1 therefore reads the primary calendar only. Supporting additional calendars means letting the user name them, not discovering them.
- Asynchronous estimation keeps its state on the task row and is retried by an in-process asyncio sweeper, with the sweep logic also exposed as an authenticated endpoint so a scheduler can drive it after deployment.

Deferred to v2: hosting, CI, error reporting, push-based calendar sync, and any background worker or Redis.

Trade-off accepted: no phone or second-device access in v1, which is in tension with the late-night completion premise. Data lives in a single Docker volume, so a periodic `pg_dump` to a backed-up location is an operational requirement.

## 6. Inputs and Outputs

**Inputs**
- Natural-language task descriptions through the chat panel.
- Structured task entries through the manual add form (title, notes, primary flag, preference type).
- Day shape configuration (start time, duration) and preference block definitions.
- Capacity ratio setting (default 0.5).
- Google Calendar busy intervals for the user's primary calendar.
- Task state transitions: complete, promote, demote, edit, delete (incomplete only).

**Outputs**
- An ordered task list for the current logical day, split into pending primaries, pending non-primaries, and a completed section.
- A per-task duration estimate in minutes, with its source (model or user override).
- A per-day capacity computation: base minutes, threshold minutes, committed minutes, at-risk boolean.
- A per-day verdict: success, failure, or neutral.
- Two heatmap datasets: per-day completion counts, and per-day verdicts.
- A queryable append-only event stream and per-day aggregate rows.

## 7. Success Criteria

**Product**
1. The user plans and scores at least 21 consecutive logical days in Doer without falling back to another tool.
2. At the end of 30 days, the heatmap shows a non-trivial mix of success, failure, and neutral days (that is, the bar is neither trivially easy nor never met).
3. The at-risk flag precedes a failed day more often than chance, measurable from the logged aggregates after 30 days.

**Functional acceptance**
4. A task completed at 03:00 within a day that started at 14:00 the previous date is attributed to the previous date's anchor and paints that heatmap square.
5. Attempting to assign a 5th primary task to a day is rejected by the API with a clear error, and the UI offers demotion as the remedy.
6. A completed task cannot be deleted through any API path, and the attempt is logged.
7. Incomplete tasks present at day close appear automatically in the next logical day with an incremented carry-forward count, exactly once, even when the app was closed across the boundary.
8. A day with 4 primaries and 3 completions scores success. A day with 4 primaries and 2 completions scores failure. A day with 1 primary scores neutral regardless of outcome.
9. With Calendar connected, the capacity base equals focus-block minutes minus overlapping busy minutes, verified against a hand-computed fixture.
10. Every task creation produces an estimate within 5 seconds, or is marked unestimated and retried.
11. Every state transition named in the Must metrics list produces exactly one event row.
12. A completion can be reversed while its day is open, and the same reversal is rejected with a 409 once the day has closed.
13. Every stored estimate is a multiple of 15 minutes, including model outputs that were not, and including user overrides.
14. Reordering tasks by drag persists across reload, and a newly created task appends to the end of its preference block.

## 8. Failure Handling and Fallbacks

**Estimation unavailable or slow.** The task is persisted immediately with a null estimate and an `unestimated` marker. A bounded retry (3 attempts, exponential backoff) runs in the background. Unestimated primaries are excluded from the committed-minutes sum but are counted in the UI as unknown capacity, so the day is shown as indeterminate rather than falsely safe. The user may enter an estimate manually at any point.

**Calendar consent revoked or refresh token invalid.** Capacity falls back to the raw focus-block base with no busy-time subtraction, the day is marked as computed without calendar data, and a non-blocking reconnect banner appears. The app remains fully usable.

**Calendar API unavailable or rate-limited.** The last successfully synced busy-interval snapshot is used, with a visible staleness indicator when it predates the current day's start. Sync retries on the next scheduled run.

**Chat misparse.** The assistant never commits tasks directly. Parsed tasks are shown as a confirmable proposal; the user can edit any field or discard the whole proposal before anything is written.

**Day close missed because the app was closed.** Day close is lazy and idempotent: the next authenticated read computes and persists closure for every elapsed unclosed day in order. Closure is guarded by a uniqueness constraint on (user, anchor date) so concurrent requests cannot double-close or double-carry-forward.

**Day shape changed mid-day.** The change takes effect from the next logical day. The current day's shape, capacity base, and threshold are snapshotted at day open and never recomputed retroactively.

**DST transition inside a logical day.** Day duration is stored as a wall-clock duration and resolved against the user's fixed timezone, so a day spanning a transition is one hour longer or shorter. The capacity base follows the resolved duration. This is documented rather than specially handled.

**No focus blocks defined for a day.** Capacity is not computed and the day is marked indeterminate, the same treatment given to a day containing unestimated primaries. The app does not fall back to the full declared day span, because counting sleep-adjacent and social hours as available capacity would make the at-risk flag meaningless. The dashboard prompts the user to define at least one focus block.

**Attempted deletion of a completed task.** Rejected with a 409 and an explanatory message, and the attempt is logged as an event.

**LLM returns an implausible estimate.** Estimates are clamped to a sane range (15 minutes to 8 hours) and snapped to the nearest 15-minute bucket, rounding up. Clamping is logged with both the raw and clamped values so prompt quality is measurable later.

## 9. Non-Goals

1. Writing to Google Calendar, or acting as a calendar replacement. Calendar is a read-only input.
2. Decomposing tasks into subtasks. Without context on dependencies and partial progress, decomposition would be wrong often enough to erode trust in the estimates.
3. Being a backlog or project manager. Doer is a daily commitment instrument; long-horizon planning, epics, and dependencies are out of scope.
4. Teams, collaboration, assignment, or sharing of any kind.
5. Notifications, reminders, or any form of proactive nagging. Over-commitment is signalled by color only.
6. Native mobile applications. Responsive web only.
7. Recurring tasks and templates.
8. Supporting travel across timezones.
9. Calendar providers other than Google.

## 10. Open Questions

1. **Metrics event schema.** The instruction is to log as much as possible and decide usage later, which in practice tends to produce data that is not queryable. The event and property schema must be defined by metrics-mode before M1 begins, because acceptance criterion 11 makes event coverage a v1 ship gate rather than a later addition. The roadmap treats the tracking plan as a prerequisite to M1, not as a trailing milestone. ADR 0001 fixes the `logical_days` structure and the task state machine; metrics-mode must be able to define its events without migrating either.

Resolved since first draft: completion reversal (allowed only before day close), estimate granularity (15-minute buckets), task ordering (drag, persisted sort index), heatmap view 1 counting (all completions), capacity base when no focus blocks exist (indeterminate, no fallback), deploy target (local-first for v1, see ADR 0001), frontend framework (Vite), and Google OAuth verification (not required for v1, but the project must be either Internal under a Workspace organization or External published to production while unverified, never left in Testing, because Testing expires refresh tokens after 7 days; see `docs/setup/gcp_setup.md`).

## 11. QA

Added by qa-mode. Test depth is integration-heavy against a real Postgres; LLM calls are mocked by default with an opt-in tagged live suite. The pass bar is criterion coverage, not line coverage.

### 11.1 Acceptance Criteria

Each criterion below is individually testable and fails loudly when the behavior breaks. AC-01 to AC-11 restate plan §7 items 4 to 14 as assertions; AC-12 onward are derived from the edge cases confirmed in QA.

| ID | Criterion | Source |
|---|---|---|
| AC-01 | A task completed at 03:00 inside a day that began 14:00 the previous date is attributed to the previous anchor date and paints that heatmap cell. | §7.4 |
| AC-02 | Assigning a 5th primary task to a day is rejected by the API with an error naming demotion as the remedy. | §7.5 |
| AC-03 | A completed task cannot be deleted through any API path, and the attempt is logged. | §7.6 |
| AC-04 | Incomplete tasks present at day close appear in the next logical day exactly once with an incremented carry-forward count, including when the app was closed across the boundary. | §7.7 |
| AC-05 | 4 primaries with 3 completions scores success; 4 with 2 scores failure; a day with 1 primary scores neutral regardless of outcome. | §7.8 |
| AC-06 | With Calendar connected, capacity base equals focus-block minutes minus overlapping busy minutes, matching a hand-computed fixture. | §7.9 |
| AC-07 | Every task creation produces an estimate within 5 seconds, or is marked unestimated and retried. | §7.10 |
| AC-08 | Every state transition in the Must metrics list produces exactly one event row. | §7.11 |
| AC-09 | A completion can be reversed while its day is open, and the same reversal is rejected once the day has closed. | §7.12 |
| AC-10 | Every stored estimate is a multiple of 15 minutes, including model outputs that were not and including user overrides. | §7.13 |
| AC-11 | Reordering tasks by drag persists across reload, and a new task appends to the end of its preference block. | §7.14 |
| AC-12 | A logical day spanning a DST transition resolves to a wall-clock duration one hour longer or shorter, and the capacity base follows that resolved duration. | derived |
| AC-13 | Changing the day shape applies from the next logical day and does not alter the snapshot, capacity, or verdict of any closed day. | derived |
| AC-14 | Concurrent requests that trigger lazy day close produce exactly one close and one carry-forward per anchor date. | derived |
| AC-15 | With Calendar consent revoked, capacity falls back to raw focus-block minutes, the day is marked as computed without calendar data, and the app remains usable. | derived |
| AC-16 | A day with no focus blocks defined is marked indeterminate and never falls back to the full declared day span. | derived |
| AC-17 | Unestimated primaries are excluded from the committed-minutes sum and cause the day to read indeterminate rather than safe. | derived |
| AC-18 | No calendar event title or description is persisted anywhere in the database. | §5 |
| AC-19 | A user cannot read or mutate another user's tasks, days, or events through any API path. | §5 |
| AC-20 | Refresh tokens are stored encrypted; the plaintext token never appears in any database column. | §5 |
| AC-21 | When carried primaries and pre-assigned primaries together exceed 4, carried tasks keep primary status, the excess pre-assigned tasks demote to non-primary, each demotion is logged, and the user is told on first opening the day. | §4 |

Plan §7 items 1 to 3 (21 consecutive days of use, a non-trivial mix of verdicts over 30 days, at-risk flagging preceding failure more often than chance) are observational outcomes measured after release, not automated gates. They are evaluated in the post-launch review.

### 11.2 Evaluation Criteria

- **Pass bar for v1:** every criterion AC-01 to AC-21 has at least one automated test that fails when the behavior breaks. Line coverage is deliberately not tracked, to keep tests tied to the product contract rather than to lines executed.
- **Test depth:** integration-heavy. The majority of tests exercise the API against a real Postgres (compose service or testcontainer), because the uniqueness constraint on (user, anchor date), transactional carry-forward, and append-only enforcement cannot be proven against a mocked database. Pure functions (capacity arithmetic, bucket snapping, verdict calculation) are unit-tested directly.
- **LLM calls:** mocked by default using recorded responses, so the default suite is deterministic, offline, and free. A separately tagged live suite, excluded from the default run, asserts loose properties against the real API (a known phrase parses to a task; the returned estimate is a valid bucket) to catch prompt and API drift.
- **Time control:** every time-dependent test pins the clock with freezegun and runs against an explicit account timezone fixture. No test may depend on the machine's local time or on the real current date.
- **Determinism:** the suite must pass when run in any order and must not depend on a previously seeded database. Each test owns its fixtures.
- **Execution:** the suite runs inside the compose environment with a single documented command, with no dependency on a deployed environment.
- **Manual pass:** `docs/user_testing_documentation.md` is walked end to end before v1 is called done, covering the judgment calls automation cannot make, principally whether the at-risk signal reads as quiet rather than alarming.

### 11.3 Automated Test Cases

Identifiers are stable; the AC column names the criterion each case proves.

**Authentication and authorization (T-AUTH)**

| ID | Must prove | AC |
|---|---|---|
| T-AUTH-01 | Completing consent with offline access stores a refresh token, and the stored column is ciphertext that round-trips through decryption. | AC-20 |
| T-AUTH-02 | A plaintext refresh token value appears in no database column, checked by scanning for the known fixture value. | AC-20 |
| T-AUTH-03 | An expired access token triggers a refresh and the new token is persisted. | AC-20 |
| T-AUTH-04 | An `invalid_grant` on refresh marks the calendar connection revoked and returns a normal response, not a 500. | AC-15 |
| T-AUTH-05 | The session cookie is HttpOnly and SameSite=Lax, and a request without it is rejected. | AC-19 |
| T-AUTH-06 | User A receives 404 or 403, never data, when requesting User B's tasks, logical days, or events by id. | AC-19 |

**Logical day (T-DAY)**

| ID | Must prove | AC |
|---|---|---|
| T-DAY-01 | A completion at 03:00 within a 14:00-start day resolves to the previous anchor date. | AC-01 |
| T-DAY-02 | A completion at 15:00 on the same date as day start resolves to that date. | AC-01 |
| T-DAY-03 | Day open snapshots shape, capacity base, and threshold onto the logical day row. | AC-13 |
| T-DAY-04 | Editing the day shape mid-day leaves the open day's snapshot unchanged and applies to the next day. | AC-13 |
| T-DAY-05 | A closed day's snapshot, capacity, and verdict are unchanged by any later settings edit. | AC-13 |
| T-DAY-06 | A day spanning a spring-forward DST transition resolves one hour shorter, and the capacity base follows. | AC-12 |
| T-DAY-07 | A day spanning a fall-back DST transition resolves one hour longer, and the capacity base follows. | AC-12 |
| T-DAY-08 | Three elapsed unclosed days close in anchor-date order on the next read. | AC-04 |
| T-DAY-09 | Two concurrent requests triggering close produce exactly one close row per anchor date, enforced by the uniqueness constraint. | AC-14 |
| T-DAY-10 | Two concurrent closes produce exactly one carry-forward per incomplete task, with the counter incremented once. | AC-14 |
| T-DAY-11 | All persisted timestamps are timezone-aware UTC, and day queries filter on anchor date rather than on raw timestamps. | AC-01 |

**Tasks (T-TASK)**

| ID | Must prove | AC |
|---|---|---|
| T-TASK-01 | Creating a 5th primary for a day is rejected, and the error payload names demotion as the remedy. | AC-02 |
| T-TASK-02 | Demoting a primary to non-primary frees a slot and a subsequent primary creation succeeds. | AC-02 |
| T-TASK-03 | Non-primary tasks beyond four are accepted without limit. | AC-02 |
| T-TASK-04 | Deleting a completed task is rejected on every path (REST delete, bulk, cascade). | AC-03 |
| T-TASK-05 | A rejected deletion of a completed task writes exactly one event row recording the attempt. | AC-03, AC-08 |
| T-TASK-06 | Reversing a completion while the day is open succeeds and restores pending state. | AC-09 |
| T-TASK-07 | Reversing a completion after the day has closed is rejected and the verdict is unchanged. | AC-09 |
| T-TASK-08 | Carry-forward preserves the primary flag, the original creation timestamp, and increments the carry-forward count. | AC-04 |
| T-TASK-09 | A task that has carried forward can still be edited and deleted while incomplete. | AC-04 |
| T-TASK-10 | When carried primaries plus pre-assigned primaries exceed 4, the carried tasks keep primary status and the excess pre-assigned tasks demote to non-primary. | AC-21 |
| T-TASK-14 | Each demotion caused by carry-forward precedence writes exactly one event row and is surfaced to the user on first opening the day. | AC-21, AC-08 |
| T-TASK-15 | A day never holds more than 4 primaries after carry-forward, under any combination of carried and pre-assigned tasks. | AC-21 |
| T-TASK-11 | Drag reorder persists a sort index that survives reload. | AC-11 |
| T-TASK-12 | A newly created task appends to the end of its preference block, not to the top of the list. | AC-11 |
| T-TASK-13 | Reordering is scoped within a preference block and cannot interleave tasks across blocks. | AC-11 |

**Estimation (T-EST)**

| ID | Must prove | AC |
|---|---|---|
| T-EST-01 | Task creation returns before the estimate resolves, with the task in a pending-estimate state. | AC-07 |
| T-EST-02 | The estimate resolves and updates the task in place within the 5 second budget. | AC-07 |
| T-EST-03 | A failing LLM call leaves the task marked unestimated and schedules a retry. | AC-07 |
| T-EST-04 | Retries are bounded at three attempts with increasing backoff, after which the task stays unestimated. | AC-07 |
| T-EST-05 | A model output of 37 minutes is stored as 45, snapped up to the next bucket. | AC-10 |
| T-EST-06 | A user-entered override of 20 minutes is stored as 30, snapped up. | AC-10 |
| T-EST-07 | An output below the floor is clamped to 15 minutes and an output above the ceiling to 8 hours, with the raw and clamped values both logged. | AC-10, AC-08 |
| T-EST-08 | The sweeper retries a stale pending estimate, and the HTTP sweep endpoint and the in-process loop invoke the same callable. | AC-07 |
| T-EST-09 | Running the sweep twice over the same stale task does not double-count attempts or double-bill. | AC-07 |
| T-EST-10 | Re-creating a task with identical normalized text serves the cached estimate without a second API call. | AC-07 |
| T-EST-11 (live, tagged) | Against the real API, a known task phrase returns a valid 15-minute bucket inside the clamp range. | AC-10 |

**Capacity (T-CAP)**

| ID | Must prove | AC |
|---|---|---|
| T-CAP-01 | Capacity base equals focus-block minutes minus overlapping busy minutes against a hand-computed fixture. | AC-06 |
| T-CAP-02 | A busy interval partially overlapping a focus block subtracts only the overlapping minutes. | AC-06 |
| T-CAP-03 | A busy interval entirely outside focus blocks subtracts nothing. | AC-06 |
| T-CAP-04 | Overlapping busy intervals are merged before subtraction and are not double-counted. | AC-06 |
| T-CAP-05 | Blocks not tagged work or personal project are excluded from the base. | AC-06 |
| T-CAP-06 | The threshold equals the configured ratio times the base, defaulting to 0.5. | AC-06 |
| T-CAP-07 | Committed minutes above the threshold set the at-risk flag; exactly equal does not. | AC-06 |
| T-CAP-08 | A day with no focus blocks is marked indeterminate and the base is not the full day span. | AC-16 |
| T-CAP-09 | Unestimated primaries are excluded from committed minutes and the day reads indeterminate. | AC-17 |
| T-CAP-10 | With the calendar connection revoked, the base is raw focus-block minutes and the day is marked computed without calendar data. | AC-15 |

**Calendar (T-CAL)**

| ID | Must prove | AC |
|---|---|---|
| T-CAL-01 | Only busy start and end values are persisted; no title, description, attendee, or location field exists on the stored rows. | AC-18 |
| T-CAL-02 | The Calendar client calls `freebusy.query` only, and no code path requests `events.list` or any endpoint returning event content. | AC-18 |
| T-CAL-03 | A freebusy query is scoped to the logical day's window against the primary calendar, and the returned intervals are merged before subtraction. | AC-06 |
| T-CAL-06 | Busy intervals are clipped to the day's window, so an event starting before the day began subtracts only the part inside it. | AC-06 |
| T-CAL-04 | With the Calendar API unavailable, the last snapshot is used and the day is flagged stale when the snapshot predates day start. | AC-15 |
| T-CAL-05 | A calendar sync failure never fails the dashboard request. | AC-15 |

**Scoring (T-SCORE)**

| ID | Must prove | AC |
|---|---|---|
| T-SCORE-01 | 4 primaries with 3 completions scores success. | AC-05 |
| T-SCORE-02 | 4 primaries with 2 completions scores failure. | AC-05 |
| T-SCORE-03 | 3 primaries with 3 completions scores success; with 2 it scores failure. | AC-05 |
| T-SCORE-04 | 2 primaries with 2 completions scores success; with 1 it scores failure. | AC-05 |
| T-SCORE-05 | 1 primary scores neutral whether completed or not, and is excluded from streak and rate calculations. | AC-05 |
| T-SCORE-06 | 0 scheduled tasks produces an unscheduled day with no verdict and no color. | AC-05 |
| T-SCORE-07 | Non-primary completions never change the verdict. | AC-05 |
| T-SCORE-08 | A verdict recomputed from the event log matches the stored verdict. | AC-08 |

**Heatmap (T-HEAT)**

| ID | Must prove | AC |
|---|---|---|
| T-HEAT-01 | View 1 counts primary and non-primary completions together. | AC-01 |
| T-HEAT-02 | View 1 renders no color for a day with zero completions. | AC-01 |
| T-HEAT-03 | View 2 renders green for success, red for failure, and no color for neutral or unscheduled days. | AC-05 |
| T-HEAT-04 | An at-risk day renders orange in both views. | AC-06 |
| T-HEAT-05 | Cells are keyed by anchor date, so a 03:00 completion appears on the prior cell. | AC-01 |

**Events and metrics (T-EVT)**

| ID | Must prove | AC |
|---|---|---|
| T-EVT-01 | Each transition in the Must metrics list emits exactly one event row, verified transition by transition. | AC-08 |
| T-EVT-02 | The event log exposes no update or delete path, and a direct attempt fails. | AC-08 |
| T-EVT-03 | Per-day aggregate rows match values derived independently from the event log. | AC-08 |
| T-EVT-04 | Replaying the event log for a user reproduces the stored verdicts for every closed day. | AC-08 |

### 11.4 Edge Cases to Handle

**Day boundary and time.** Completion exactly at the day start and exactly at the day end. A day shape of 24 hours. A day shape changed while a day is open. Both DST directions inside a logical day. An account timezone that differs from the server timezone. A heatmap spanning a DST boundary, where two adjacent anchor dates have different wall-clock lengths.

**Close and carry-forward.** The app unopened for a week, leaving several unclosed days. Two browser tabs or two devices triggering close simultaneously. A task carried forward into a day that already holds pre-assigned primaries, where carried tasks take precedence and the excess demotes. The boundary case of exactly 4 carried plus 1 pre-assigned, and of 4 carried plus 4 pre-assigned. A task carried forward many times, where the counter must keep incrementing without resetting.

**Contract rules.** A 5th primary attempted through the API directly rather than through the UI. Deleting a completed task through a bulk operation or a cascade from its parent day. Reversing a completion in the second before and the second after day close. Promoting a non-primary into a full primary slot.

**Degraded modes.** Calendar consent revoked between day open and day close. Calendar API returning a 429 mid-sync. A stale snapshot older than the current day start. No focus blocks defined. Every primary unestimated. An estimate that never resolves across all three retries. The Anthropic API returning a malformed or non-numeric estimate.

**Data integrity.** Two users with identical task text, where the estimate cache must not leak across users. A user whose account timezone changes. A verdict recomputed from the event log after a manual database edit, which must surface the divergence rather than silently agreeing.
