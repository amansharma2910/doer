# Doer

A daily planner built on one rule: pick at most **4 tasks**, and the day counts
as kept if you finish at least **75% of them**. Four tasks means three, three
means three, two means both. One task is not enough to score at all, so a
single-task day is neither a win nor a loss, and a day with nothing on it is
simply unscheduled.

Two things make it different from a task list:

- **Your day is not the calendar's day.** You define when it starts and how long
  it runs. A day from 14:00 to 05:00 is one day, so a task finished at 03:00
  counts toward the day that began yesterday afternoon, not toward tomorrow.
- **Over-commitment is shown, not shouted.** Doer estimates how long each task
  takes and compares the total against the time you actually have. Too much, and
  the day turns orange. That is the entire warning: no modal, no notification.

Google Calendar is read for availability only, through the `freebusy` scope.
Event titles never reach the server.

## Running it

Requires Docker. Google credentials are only needed for sign-in and calendar.

```bash
cp .env.example .env
# Generate the key that encrypts stored refresh tokens. Keep it stable.
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# Fill in FERNET_KEY, plus the Google and Anthropic values.
# See docs/setup/gcp_setup.md for the Google side; section 0 matters most.

docker compose up
```

- App: http://localhost:5173
- API: http://localhost:8787

Apply migrations on first run:

```bash
cd backend && uv sync --group dev
(set -a && . ../.env && set +a && uv run alembic upgrade head)
```

The subshell matters. Exporting `.env` into your own shell leaves `DATABASE_URL`
pointing at the production database for everything you run afterwards, including
the test suite. The parentheses confine it to this one command.

The `api` container already runs `alembic upgrade head` on start, so this is a
host convenience rather than a prerequisite.

The local `psql` client is older than the Postgres 17 server, so reach the
database through the container rather than the host:

```bash
docker compose exec db psql -U doer -d doer
```

## Tests

```bash
cd backend && uv run pytest          # 220 tests, deterministic, offline, free
cd backend && uv run pytest -m live  # 7 more that call the real model; costs money
docker compose --profile test run --rm tests   # the same backend suite, in a container

cd frontend && pnpm test             # 324 tests across 14 files, offline
```

Counts are as of 2026-10-24. Treat any count in a document as the date it
carries rather than as current.

The suite drops and re-migrates the schema of the database it is pointed at, so
it refuses to start against anything whose name does not end in `_test`. It
targets `doer_test`, which you create once with
`docker compose exec db psql -U doer -d postgres -c "create database doer_test"`.
Point it elsewhere with `DOER_TEST_DATABASE_URL`; it never uses `DATABASE_URL` as the
target, because the api container sets that to the production database. If your
shell has one set to a non-test database, the suite refuses to start rather than
quietly redirecting.

Do not run the suite with `docker compose exec api pytest`. It is refused now,
but it is refused by one assertion, not by the shape of the system.

Integration tests run against a real Postgres migrated with Alembic, not against
model metadata. The guarantees that matter most (append-only events,
completed-task immutability, the uniqueness constraint behind idempotent day
close) live in triggers and constraints, and a schema built from `create_all`
would omit exactly those.

## How it is put together

A FastAPI service and a Vite SPA, with Postgres. In development they run as
compose services, alongside an hourly database dump; a profile-gated `tests`
service runs the suite against its own database. A second Docker target builds the single container in which
FastAPI serves the built SPA; it is kept working from the first milestone so that
deploying later is configuration rather than a rewrite.

Deployment is deliberately deferred. See `docs/adr/0001-local-first-fastapi-monolith.md`
for why, and what changes when it happens.

## Where the thinking is written down

Start at `docs/doer/DOCUMENTATION.md`. It describes the system as a whole and
carries the Drift Notes, the standing list of places where a document and the
code still disagree.

| Document | What it holds |
|---|---|
| `docs/doer/DOCUMENTATION.md` | Structure, dependencies, setup, architecture, and the drift notes |
| `docs/roadmap.md` | Milestone status, the standing backlog, and every correction made to an earlier document |
| `docs/releases/CHANGELOG.md` | What changed. Everything sits under `[Unreleased]`, because there is nowhere to deploy yet |
| `docs/user_testing_documentation.md` | Manual test flows for a human, 24 of them |
| `docs/metrics/daily-task-planner_tracking_plan.md` | What is measured, and the guardrails against gaming it |
| `docs/setup/gcp_setup.md` | Google Cloud setup, including the traps |

**Plans** (`docs/plans/`): requirements and acceptance criteria, one file per feature.

| Plan | What it holds |
|---|---|
| `implementation_plan_daily-task-planner_1.md` | Doer v1: 21 acceptance criteria, 76 test definitions |
| `implementation_plan_timeline-window-drag_1.md` | Dragging the block window on the day timeline |
| `implementation_plan_interface-overhaul_1.md` | The three-screen rebuild: 27 acceptance criteria, 44 test definitions |
| `implementation_plan_provisional-day-signal_1.md` | A live on-track signal for the day in progress. Draft, not built |

**Decisions** (`docs/adr/`):

| ADR | What it settles |
|---|---|
| `0001-local-first-fastapi-monolith.md` | Stack and deferred deployment, and five rejected alternatives |
| `0002-magnetic-timeline-window-drag.md` | Snapping, the overlay layer, geometry as pure functions |
| `0003-platform-primitives-and-phased-delivery.md` | The design token layer, the DOM test harness, four-phase delivery |

**Defects** (`docs/fixes/`): one plan per defect, with root cause, blast radius and
the least-impact fix. Eight so far, including the test run that destroyed the
development database and the 122 MB pnpm store that reached git history.

**Features** (`docs/features/`): what each built feature does and where its code
lives. The planner itself, the timeline drag, the 24-hour clock field, and the
interface overhaul.
