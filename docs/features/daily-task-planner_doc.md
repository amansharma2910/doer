# Feature: Daily Task Planner

The whole of Doer v1. Plan `implementation_plan_daily-task-planner_1.md`,
ADR 0001, tracking plan `daily-task-planner_tracking_plan.md`.

Last updated 2026-10-24. The interface this feature was built against was
replaced on 2026-10-23: the surfaces now live in
`docs/features/interface-overhaul_doc.md`, and the backend described here is
unchanged by it apart from the `anchor` parameter noted in section 4.

## 1. What It Does

You commit to at most four primary tasks for a day. The day is scored a success if
you complete at least 75% of them. Fewer than two primaries makes the day neutral
and unscoreable, which stops a one-task day from counting as either a win or a loss.

Your day is whatever you say it is. A day running 14:00 to 05:00 is a single day,
so a task finished at 03:00 counts toward the day that began the previous
afternoon.

Doer estimates each task in 15-minute buckets, sums the open primaries, and
compares that against the time you actually have (focus blocks minus calendar busy
time, times a configurable ratio). Over the line, the day turns orange. That is the
entire warning.

## 2. Implementation Detail

### Sign-in and consent

Google issues a refresh token only on the **first** consent for an account. Every
sign-in after that returns an access token alone unless `prompt=consent` is sent.
The invariant the callback is built on: that is normal, not an error. The stored
refresh token survives sign-out (`destroy_session` deletes the `AuthSession` row
and nothing else), so a returning user is signed in on the grant already held, in
a single authorization leg. One account picker, no consent screen.

Consent is forced again only when there is genuinely nothing to reuse: no token
row, a row marked revoked, or the empty-bytes placeholder the row is created with
before a grant is first stored. Those three conditions are deliberately the same
ones `token_store.access_token_for` enforces, and the two must be changed
together. That branch is also the only route back from a grant revoked at Google,
which is why it was narrowed rather than removed.

A forced leg that *still* returns no refresh token fails with a 502 rather than
redirecting again. Without that guard the callback redirects to itself until the
browser gives up.

Treating the missing refresh token as fatal is what used to send every returning
user through a second authorization leg, which rendered the account picker twice.
See `docs/fixes/fix_plan_repeat-signin-shows-account-picker-twice.md`.

`calendar_connected` fires when a previously-unusable grant becomes usable, not
whenever a refresh token is written. A repeat sign-in connects nothing and records
nothing.

### The logical day

`logical_days` rows, not derivations. Each carries `anchor_date`, resolved
`start_at`/`end_at`, real `duration_minutes`, and a `shape_snapshot` taken at open.

The snapshot has two halves and they do not behave the same way. The day shape
(start time, duration, timezone, capacity ratio) is frozen: editing it applies from
the next logical day, so a day that has been scored cannot be rewritten (AC-13).
The preference blocks are refreshed in place when they are edited, by
`day_service.refresh_blocks` called from the settings write path, which then
recomputes capacity. Adding a first focus block has to clear the "set up a work
block" nudge on the day the user is looking at rather than the next one
(`docs/fixes/fix_plan_stale-block-snapshot.md`). Closed days are never refreshed,
and a settings edit never materializes a day that has not been opened yet.

Duration is wall-clock, so `day_bounds` localizes both the naive start and the
naive end and takes the real difference. A 15-hour day spanning a spring-forward
transition is 14 real hours, and capacity follows, because the user really does
have one less hour.

Preference blocks are stored as minute offsets from day start rather than clock
times, which is why a block at 23:00 to 00:30 inside a 14:00 day needs no special
case anywhere: it is offsets 540 to 630.

`resolve_anchor_date` checks yesterday's day before today's, since a day that began
yesterday may still be running. It returns `None` when the instant falls in the gap
between days, and callers surface that rather than guessing.

### Capacity and the risk flag

Base is the real minutes inside focus blocks (deep work and personal project) minus
the overlap with merged calendar busy intervals. Threshold is `ratio * base`,
defaulting to 0.5. At risk is `committed > threshold`, strictly: a day committed
exactly to its threshold is not flagged.

Two refusals are load-bearing. No focus blocks means indeterminate, never a
fallback to the full day span. Any unestimated primary means indeterminate too.
Unknown capacity must never read as headroom.

`is_at_risk` is the live flag and clears as work completes. `ever_at_risk` latches,
and is what the over-commitment metric reads, because otherwise most flagged days
would record `false` at close.

### Close, scoring, carry-forward

`close_day` takes a row lock, scores, carries forward, then stamps `closed_at`, all
in one transaction. `close_elapsed_days` re-queries each pass rather than taking the
pending list once, because closing a day creates the next one through
carry-forward and that one may have elapsed too.

Carry-forward precedence: carried primaries claim slots ahead of tasks pre-assigned
to tomorrow, and the excess pre-assigned tasks demote to non-primary with
`carry_forward_demoted` set. An unfinished commitment outranks an intention made in
advance.

### Estimation

`claude-haiku-4-5`, no `thinking` parameter and no `output_config.effort`: Haiku 4.5
predates adaptive thinking and rejects the effort parameter, and bucket estimation
needs no reasoning. Output snaps up to the next 15-minute bucket and clamps to
15 minutes to 8 hours, with the raw value preserved so prompt quality stays
measurable.

An attempt runs inline on creation (fire-and-forget, gated by
`BACKGROUND_ESTIMATION_ENABLED`), and the in-process sweeper retries what is due
with backoff `(30, 120, 600)` up to three attempts. Results are cached per user on
normalized title.

### Assistant

`claude-opus-5` parses a message into a `Proposal` via structured output. It commits
nothing: the user confirms or edits, and `edited_count` is logged because a rising
edit share is how prompt drift first appears.

## 3. Key Files and Entry Points

| Concern | File |
|---|---|
| Day arithmetic, DST, anchor resolution | `backend/doer/daytime.py` |
| Capacity, merging, overlap | `backend/doer/services/capacity.py` |
| Opening and snapshotting days | `backend/doer/services/day_service.py` |
| Scoring, carry-forward, precedence | `backend/doer/services/close_service.py` |
| Contract rules, the capacity funnel | `backend/doer/services/task_service.py` |
| Availability and degraded modes | `backend/doer/services/calendar.py` |
| Sign-in routes, the consent decision | `backend/doer/api/auth.py` |
| The Google OAuth calls themselves | `backend/doer/services/google_oauth.py` |
| Reading and refreshing the stored grant | `backend/doer/services/token_store.py` |
| Buckets, retries, the sweeper | `backend/doer/services/estimation.py` |
| Aggregates, cost, replay | `backend/doer/services/metrics.py` |
| The one event writer | `backend/doer/events.py` |
| Triggers | `backend/alembic/versions/*_initial_schema.py`, `*_tasks.py` |
| Heatmap cell colour rules | `frontend/src/lib/heatmap.ts` (`colorFor`, `View`) |
| Heatmap grid markup, the two views | `frontend/src/components/Heatmap.tsx` |
| Heatmap grid dates | `backend/doer/daytime.py` (`local_date`, `grid_days`) |
| Drag reorder (tasks, dnd-kit) | `frontend/src/components/TaskList.tsx` |
| Drag and resize (settings timeline, native pointer) | `frontend/src/components/DayTimeline.tsx`, `frontend/src/lib/daytime.ts`, and `docs/features/timeline-window-drag_doc.md` |

## 4. Interfaces and Contracts

All routes except `/health` and the auth entry points require the `doer_session`
cookie and return **401** without it, with one exception worth naming:
`POST /auth/logout` carries no auth dependency at all, so it succeeds with no
cookie. That is deliberate (sign-out is idempotent) but it is not what the
sentence above would lead you to expect.

| Method | Path | Notes |
|---|---|---|
| GET | `/auth/google/login` | 307 to Google. `?force_consent=true` adds `prompt=consent` and marks the state so the callback can tell which leg it is on; `?login_hint=<email>` pre-selects an account. Neither is set by any user-facing surface: the callback's own recovery redirect is the only thing that sends them |
| GET | `/auth/google/callback` | **307** to the frontend with the session cookie on success. **307** back to `/auth/google/login?force_consent=true` (no cookie, no database write) when the grant is unusable. **400** on a Google `error` or a state mismatch, **502** on a failed exchange or on a forced leg that still returns no refresh token |
| POST | `/auth/logout` | 200 `{"ok": true}`. Destroys only the calling session, so other browsers stay signed in. Idempotent: 200 with no cookie |
| GET | `/auth/me` | |
| PATCH | `/settings/day-shape` | **409** if an existing block would fall outside the new duration |
| GET POST | `/settings/blocks` | **409** overlap, **422** past the end of the day |
| DELETE | `/settings/blocks/{id}` | **404** for another user's block |
| GET | `/days/current` | **409** when outside the defined day |
| POST | `/days/current/refresh-calendar` | Calendar failures degrade, never surface |
| GET | `/days/heatmap?weeks=` | The grid dates and the cells for both views |
| GET | `/days/{anchor}` | |
| GET POST | `/tasks` | **409** `primary_cap_reached` on the fifth primary. GET takes an optional `anchor` (ISO date) to read a past day: it returns that day's tasks, **404**s when no logical day exists on that anchor, and **422**s on a malformed date. The two cases do not share a code path, because the "now" path closes elapsed days, materializes the current one and emits events, all of which are wrong for reading history |
| PATCH DELETE | `/tasks/{id}` | **409** on a completed task |
| POST | `/tasks/{id}/start` | Populates `actual_minutes` on completion. Reachable from the interface since 2026-10-23: every pending row carries a start control, which is what stopped the estimation-error indicator reading over a subset that was empty by construction |
| POST DELETE | `/tasks/{id}/complete` | DELETE reverses; **409** `day_closed` after close |
| POST | `/tasks/{id}/primary` | |
| POST | `/tasks/{id}/reorder` | Scoped within a preference block |
| POST | `/assistant/chat` | Returns a proposal; persists nothing. **503** if the model is down |
| POST | `/assistant/confirm` | Commits the proposal |
| POST | `/assistant/sweep` | Retries due estimates. Global, not per-user |

**Contract refusals carry a remedy.** The six raised through `rule_error` return a
`detail` object, not a string. Five are in `api/tasks.py` and one in
`api/assistant_routes.py`:

```json
{"message": "This day already holds 4 primary tasks",
 "code": "primary_cap_reached",
 "remedy": "Demote an existing primary, or add this one as an extra"}
```

That is the literal text `task_service` emits. Earlier versions of this document
paraphrased it in lower case and said "add this one as non-primary", which is not
the string a client would match on or a user would read.

Not every 409 takes this shape. `PATCH /tasks/{id}` on a completed task raises a
plain string detail rather than going through `rule_error`, so a client reading
`detail.code` finds nothing there.

Codes: `primary_cap_reached`, `completed_immutable`, `day_closed`. The frontend
reads this through `ApiError.detail`; reading `.message` alone yields only the
message string.

### Database constraints that are contracts

- `logical_days UNIQUE (user_id, anchor_date)` makes lazy close idempotent.
- `events` trigger refuses UPDATE and DELETE. TRUNCATE still works, which is how
  tests clean up.
- `tasks` trigger refuses deletion of any row with `completed_at` set, including
  via cascade from `logical_days`.
- `tasks CHECK estimate_minutes % 15 = 0` enforces buckets below the service layer.
- The four-primary cap is deliberately **not** a database constraint, because
  carry-forward precedence has to demote within the same transaction.

## 5. For Someone Reading the Source

Start at `daytime.py`. Nothing else makes sense until the anchor-date model does.

Then `task_service.recompute_capacity`: every write path funnels through it, and it
is the only place the risk-flag events fire. A new write path that skips it
produces a day whose capacity quietly stops tracking its tasks.

Then `close_service.close_day`, reading top to bottom. The order is load-bearing:
tasks are captured, then carried, then the captured list is handed to `roll_up`.
Re-querying there would under-report scheduled primaries on exactly the failed days.

`events.py` is four lines of logic and the backbone of the tracking plan. Anything
that changes state and does not call it is invisible to every metric.

Two traps worth knowing before you change things: `metrics` imports
`close_service.verdict_for` inside a function to break a cycle, and
`api/assistant_routes.py` imports three helpers from `api/tasks.py` across a router
boundary.
