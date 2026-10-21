# Doer: Project Documentation

Last updated 2026-10-21, after milestones M1 to M7.

## Drift Notes

Known gaps between what the documents promise and what the code does.

1. **`actual_minutes` is populated only for tasks that were explicitly started.**
   `POST /tasks/{id}/start` exists but nothing requires it, so the estimation-error
   leading indicator is computed over a subset that may stay small. If that subset
   is thin at review time, it is the first number to distrust.

2. **A user row cannot be deleted once they have events.** The append-only trigger
   refuses the cascade from `users` into `events`, so account deletion fails. Correct
   for an immutable log and irrelevant at one user, but it means "delete my account"
   needs a deliberate carve-out before Doer has anyone else on it. Removing a test
   user currently requires disabling the trigger for the statement.

3. **Calendar busy time is un-subtracted by any task mutation.** Nine of the eleven
   `recompute_capacity` call sites pass no `busy`, so `capacity.compute` subtracts
   zero and `busy_minutes_subtracted` is wiped. `calendar.sync_day` only re-applies
   it when the snapshot is stale, so a calendar-connected user's threshold reads
   high from the next task write until the following day. Found while fixing
   `docs/fixes/fix_plan_stale-block-snapshot.md` and deliberately left alone there;
   it needs its own fix plan.

Closed on 2026-10-21: carry-forward demotions are now surfaced in the task list;
a frontend test suite exists (Vitest, 72 tests covering the heatmap colour rules
and contract-refusal decoding); and migrations run on container start.

## 1. Project Structure

```
doer/
├── Dockerfile              four stages: base, dev, web-build, runtime
├── docker-compose.yml      db (postgres:17), api (8787→8000), web (5173)
├── .env.example            every setting, no values
├── backend/
│   ├── pyproject.toml      deps, ruff, pytest config
│   ├── alembic/versions/   six migrations, including two triggers
│   └── doer/
│       ├── main.py         app factory, CORS, routers, SPA mount, sweeper loop
│       ├── config.py       Settings (pydantic-settings), lru_cached
│       ├── db.py           engine, SessionLocal, request-scoped get_session
│       ├── daytime.py      logical day arithmetic, DST, anchor resolution
│       ├── events.py       the single event writer
│       ├── crypto.py       Fernet envelope for refresh tokens
│       ├── logging.py      structlog configuration
│       ├── models/         user, day, task, event, cache, metrics
│       ├── schemas/        request and response shapes
│       ├── api/            auth, days, tasks, settings, assistant, deps
│       └── services/       day, task, close, capacity, calendar, estimation,
│                           assistant, metrics, google_oauth, token_store, llm
└── frontend/src/
    ├── App.tsx             auth gate and router
    ├── lib/                api client, typed hooks, wire types
    ├── pages/              SignIn, Dashboard, Settings
    └── components/         TaskList (dnd), AddTask, Chat, Heatmap
```

Roughly 5,000 lines of application code and 2,400 of tests.

## 2. Third-Party Dependencies

### Backend runtime

| Package | Constraint | Why it is here |
|---|---|---|
| fastapi | >=0.115.0 | HTTP framework, dependency injection |
| uvicorn[standard] | >=0.32.0 | ASGI server |
| sqlalchemy[asyncio] | >=2.0.36 | Typed async ORM, `ON CONFLICT` upserts |
| asyncpg | >=0.30.0 | Postgres driver |
| alembic | >=1.14.0 | Migrations, including the two triggers |
| pydantic | >=2.9.0 | Schemas, and the structured-output models the LLM fills |
| pydantic-settings | >=2.6.0 | Settings from `.env` |
| cryptography | >=43.0.0 | Fernet envelope around refresh tokens |
| httpx | >=0.27.0 | Google OAuth and FreeBusy calls |
| anthropic | >=0.40.0 | `AsyncAnthropic.messages.parse` structured output |
| structlog | >=24.4.0 | Logging on the paths that deliberately swallow exceptions |

Google's own client libraries are deliberately absent. Three OAuth endpoints and
one FreeBusy call are clearer as direct `httpx` calls than as library machinery,
and the library would not have made the scope limits any more visible.

### Backend dev

`pytest >=8.3.0`, `pytest-asyncio >=0.24.0`, `respx >=0.21.1` (mocks Google's HTTP
calls), `ruff >=0.7.0`.

Anthropic is not mocked with respx. It is replaced with a scripted double, because
what needs testing is our handling of the response, not the SDK's transport.

### Frontend

Runtime: `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`,
`@dnd-kit/{core,sortable,utilities}`.
Dev: `typescript`, `vite`, `@vitejs/plugin-react`, `tailwindcss` + `@tailwindcss/vite`,
React type packages. Tailwind v4 has no config file; the theme lives in
`src/index.css` under `@theme`.

Pinned toolchain: `postgres:17`, `python:3.13-slim`, `node:23-slim`, `uv 0.9.5`,
`pnpm@10.33.2`.

## 3. Cross-Module Dependency Map

Most depended-upon first:

| Module | Depended on by |
|---|---|
| `doer.models` | every service, every router, alembic, every test |
| `doer.daytime` | day, close, task, calendar, estimation, assistant, token_store, deps |
| `doer.events` | task, day, close, calendar, token_store, estimation, assistant, auth |
| `doer.config` | db, crypto, main, four services, two routers, alembic env |
| `doer.db` | all five routers, estimation (its own session for detached work) |
| `services.task_service` | close, calendar, tasks router, assistant router |
| `services.capacity` | day_service, task_service, calendar |
| `api.deps` | all five routers |

Three structural facts worth knowing before changing anything:

- **`task_service.recompute_capacity` is the single funnel.** Every write path
  (task CRUD, chat confirm, carry-forward, calendar sync) updates
  `committed_minutes`, `threshold_minutes`, and `is_at_risk` through it, and it is
  the only place the risk-flag events can fire. Adding a write path that skips it
  produces a day whose capacity silently stops tracking its tasks.
- **`close_service` imports `metrics` at module level; `metrics` imports
  `close_service.verdict_for` inside a function.** That deferred import is what
  breaks the cycle. Hoisting it to the top will fail at import time.
- **Close must hand `roll_up` the pre-carry task list.** `close_day` captures the
  day's tasks, carries incomplete ones to tomorrow, then passes the captured list
  explicitly. Re-querying inside `roll_up` counts only what remained, which
  under-reports scheduled primaries on exactly the days that failed.

Frontend: everything network goes through `lib/api.ts`, and everything stateful
through `lib/hooks.ts`. `useTaskMutation` invalidates tasks, day, and heatmap
together, because any task change can move capacity.

## 4. Setup and Run

```bash
cp .env.example .env            # fill in Google, Anthropic, and FERNET_KEY
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

docker compose up -d        # migrations run on container start
```

App at http://localhost:5173, API at http://localhost:8787. The API container
listens on 8000 internally; 8787 is the published port, chosen because 8000 is
commonly occupied.

Google OAuth needs the redirect URI `http://localhost:8787/auth/google/callback`
and the JavaScript origin `http://localhost:5173` registered in the Cloud console.
See `docs/setup/gcp_setup.md`; section 0 is the part that bites.

A deployed environment should run migrations as a separate step rather than on
start, where a failed migration must not take the service down with it.

Database access goes through the container, because the host `psql` client is
older than the Postgres 17 server:

```bash
docker compose exec db psql -U doer -d doer
```

### Tests

```bash
cd backend && uv sync --group dev
createdb doer_test   # once, or: docker compose exec db createdb -U doer doer_test
uv run pytest             # 190 tests, deterministic and offline
uv run pytest -m live     # 7 more that call the real model and cost money
```

```bash
cd frontend && pnpm test  # 72 tests: heatmap colour rules, error decoding
```

The suite runs on the host against the Postgres compose publishes on 5432, in its
own `doer_test` database, which it drops and re-migrates each session. It migrates
with Alembic rather than `create_all` on purpose: the append-only and immutability
guarantees live in triggers that only migrations create.

### Production-parity image

```bash
docker build --target runtime -t doer:local .
```

This is the single container in which FastAPI serves the built SPA. It is built at
every milestone boundary rather than at deploy time, so the deferred deployment
stays a configuration change.

## 5. Architectural Overview

Doer is a FastAPI service and a Vite SPA over Postgres, running locally by
decision rather than by accident (`docs/adr/0001-local-first-fastapi-monolith.md`).

**Dates are resolved server-side.** Anchor dates are computed in the user's
configured timezone, so the heatmap endpoint returns the grid's dates along with
its cells rather than letting the browser derive them from its own clock
(`docs/fixes/fix_plan_heatmap-utc-date-shift.md`).

**The logical day is the spine.** Every task, completion, score, and heatmap cell
resolves through a materialized `logical_days` row keyed on `(user_id, anchor_date)`
rather than through a timestamp. The row freezes the day shape at open, so changing
it tomorrow cannot rewrite what today was measured against. Preference block edits
are the deliberate exception: they refresh onto the open day and recompute capacity,
because the dashboard asks a user with no focus blocks to go and define one. A day's real duration is computed by wall-clock arithmetic in the
user's timezone, which makes a DST day genuinely 14 or 16 hours rather than 15.

**Three guarantees are enforced in the database, not in code.** A unique constraint
on `(user_id, anchor_date)` makes lazy day close idempotent under concurrency. A
trigger refuses UPDATE and DELETE on `events`. A second trigger refuses deletion of
any task with a `completed_at`, closing the cascade and bulk paths that a service
check cannot reach.

**Events are written inside the transaction that changes state.** Not an
after-request hook, not a publisher. A rollback takes its events with it, which is
what makes "exactly one event per transition" provable.

**Close is lazy.** Nothing runs on a timer. The next authenticated read closes every
elapsed day in order, scoring and carrying forward as it goes, which is what makes
the app correct after a week of not being opened.

**Degradation is designed, not incidental.** A revoked calendar grant falls back to
raw focus-block capacity and marks the day as computed without calendar data. An API
failure keeps the last snapshot and marks it stale. Missing focus blocks or
unestimated primaries make a day *indeterminate* rather than safe, because unknown
capacity must never read as headroom.

**Estimation is durable without a worker.** State lives on the task row, an attempt
runs inline, and an in-process sweeper retries what is due. The sweep logic sits
behind one callable that is also an HTTP endpoint, so a scheduler can drive it on a
host that scales to zero.
