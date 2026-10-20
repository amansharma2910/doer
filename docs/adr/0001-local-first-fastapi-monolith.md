---
type: adr
id: 0001
status: accepted
supersedes: null
related_feature: daily-task-planner
created: 2026-10-20
---

# ADR 0001: Local-First FastAPI Monolith for Doer v1

## 1. Context

Doer v1 (plan `daily-task-planner` v1) is a single-user daily task planner. The user declares at most 4 primary tasks per user-defined logical day, an LLM estimates each task in 15-minute buckets, the day scores pass or fail at 75% primary completion, read-only Google Calendar supplies busy time for capacity math, and a GitHub-style heatmap shows history.

A repository survey plus shell verification established the starting conditions:

- The repository contains no application source of any kind. It is not a git repository and has no `.gitignore`. Every dependency and every piece of tooling is new.
- Available locally and verified: Python 3.13.7, Node 23.11.0, pnpm 10.33.2, uv 0.9.5, Docker 27.5.1 with the daemon running, gcloud 588 authenticated, Supabase CLI 2.117.0. The `psql` client is 14.13 and no local Postgres server is running.
- Not installed: flyctl, railway, vercel, and render CLIs.
- Two sibling projects offer conflicting precedent. `ID8` is Next.js 15 plus React 19 plus FastAPI plus SQLAlchemy 2 async plus Alembic plus arq and Redis plus a full CI matrix. `moku_editz` is Vite 5 plus React 18 plus Tailwind 4 plus SQLModel, deployed to Google Cloud Run in `asia-south1` via Workload Identity Federation. The plan at §5 explicitly deferred the Next.js versus Vite choice to this ADR.
- The only deployment automation anywhere in the user's project tree targets Google Cloud Run. There is no Fly, Railway, or Render footprint, despite plan Open Question 1 enumerating exactly those.
- No usable in-house precedent exists for Google Calendar integration, encrypted refresh-token storage, drag-and-drop reordering, or a calendar heatmap.

Two constraints are settled by the plan itself and are not open to choice in this ADR:

1. **Logical days are materialized rows.** The plan requires the day shape, capacity base, and threshold to be snapshotted at day open and never recomputed retroactively (§8), a uniqueness constraint on (user, anchor date) to make lazy day close idempotent (§8), and every scheduling, attribution, carry-forward, scoring, and heatmap read to resolve through the anchor date rather than a raw timestamp (§4). Deriving the logical day on the fly from a timestamp satisfies none of these.
2. **All timestamps are `timestamptz` in UTC, with a fixed IANA timezone stored on the account.** Day boundaries resolve through the logical day snapshot, never through client-side date math.

One further fact reframes the hosting question. Google OAuth client credentials and Google Calendar API enablement live in a Google Cloud project, so a GCP project is required regardless of where the application runs. Plan Open Question 1 was written without that in view. The real question was never "which host" but "whether to add a second vendor on top of a GCP project that is mandatory anyway."

## 2. Options Considered

### Option A: Lean monolith on Cloud Run

A single container running FastAPI, serving both the REST API and a built Vite single-page application as static files, deployed to Cloud Run with scale-to-zero. Postgres on a Supabase or Neon free tier.

- Blast radius: greenfield, one deployable unit.
- Complexity: low. One Dockerfile, one service, one database.
- New third-party dependencies: the full backend and frontend sets listed in the Decision below, plus a hosting account.
- Build versus buy: authentication bought directly from Google rather than brokered through Supabase, because routing Google through Supabase auth complicates retaining the Calendar refresh token.
- Cost: approximately zero. Cloud Run scales to zero and both Postgres candidates have usable free tiers. Inference is one Claude call per task creation plus one per chat turn, cents per day at this volume.
- Risks: cold starts of several seconds after idle. Scale-to-zero provides no always-on process, so asynchronous estimation retries need an external trigger (Cloud Scheduler pinging a sweep endpoint) to satisfy acceptance criterion 10.

### Option B: ID8-pattern split

Next.js on Vercel, FastAPI on Cloud Run, Cloud SQL Postgres, an arq plus Redis worker, Sentry, and a full CI matrix.

- Blast radius: four deployed components across three vendors.
- Complexity: highest. Most of it buys horizontal scale that a single-user application does not need.
- Cost: Cloud SQL is roughly $10 to $50 per month at minimum instance size, plus Redis.
- Risks: infrastructure work displaces product validation. Next.js server-side capabilities are largely wasted when a separate FastAPI service owns the backend, producing two backends to reason about.

### Option C: Local-first Docker Compose, deployment deferred (chosen)

The same code shape as Option A, running only on the developer machine through Docker Compose, with Postgres in a container and no hosting. Google OAuth works against a localhost redirect URI.

- Blast radius: greenfield, nothing deployed.
- Complexity: lowest. No hosting account, no deploy pipeline, no secret manager.
- Cost: zero infrastructure cost. Inference cost unchanged.
- Risks: no access from a phone or second device, which is in tension with a product premise about checking off tasks at 03:00. Deployment work is deferred, not eliminated.

### Rejected: on-the-fly logical day derivation

Computing the logical day from the user's current day shape and a raw timestamp at query time, with no materialized row. Rejected because a day-shape change would retroactively rewrite closed days, lazy day close would have no uniqueness constraint to make it idempotent, and every read path would independently re-derive boundary logic. The plan forbids all three.

### Rejected: Google Calendar push notifications

Watch channels delivering change events by webhook. Rejected for v1 because it requires a publicly reachable HTTPS endpoint, which a local-first deployment does not have, and channel renewal every seven days adds operational surface disproportionate to a single user.

### Rejected: Supabase-brokered authentication

Using Supabase auth for Google sign-in, matching the ID8 precedent. Rejected because the plan requires a single consent flow yielding a durable calendar refresh token, and obtaining and retaining that token through Supabase's broker is materially more awkward than handling the authorization code flow directly.

### Rejected: SQLModel

Matching the `moku_editz` precedent. Rejected in favor of SQLAlchemy 2.0 typed async models, because the append-only event tables and per-day aggregate reads are shaped differently from the request and response schemas, and SQLModel's coupling of the two is a liability rather than a saving here. This also matches the stronger `ID8` precedent. Note that `moku_editz` is not a Postgres precedent at all, since its compose file points at SQLite.

## 3. Decision

Adopt **Option C**, a local-first FastAPI monolith, with the production-shaped container target maintained from day one so that deploying later is configuration rather than a rewrite.

**Runtime shape.** Docker Compose on the developer machine, with a `db` service (Postgres 17, named volume), an `api` service (uvicorn with reload), and a `web` service (Vite dev server) for development. A second build target produces the single container in which FastAPI serves the built SPA from a static mount. That target is built and smoke-tested from the first milestone onward so that it never rots.

**Frontend.** Vite plus React plus TypeScript, React Router, Tailwind, TanStack Query, and `@dnd-kit` for drag reordering against a persisted sort index. Date arithmetic is hand-written: the heatmap and the settings clock conversions are the only date logic, and both are short enough that a library would add a dependency without removing code. Next.js is rejected because a separate FastAPI service owns the backend, leaving Next's server-side capabilities unused while adding a second runtime. The heatmap is a hand-built CSS grid, not a library, because no off-the-shelf component supports two views plus an orange at-risk state keyed to anchor dates rather than calendar dates.

**Backend.** Python 3.13 managed by uv, FastAPI, SQLAlchemy 2.0 async with asyncpg, Alembic for migrations, pydantic-settings, the Anthropic Python SDK for estimation and chat parsing, `cryptography` for a Fernet envelope around stored refresh tokens, `httpx` for Google's OAuth and FreeBusy endpoints, and `structlog`. Google's own client libraries are not used: the three OAuth calls and the single FreeBusy call are small enough that a direct `httpx` call is clearer than the library's machinery, and retry backoff is a three-element tuple rather than a dependency. Testing uses pytest, pytest-asyncio, and `respx` for mocking Google's HTTP calls; Anthropic is replaced with a scripted double, since the value under test is our handling rather than the SDK's transport. Time-dependent tests pass explicit instants rather than freezing a global clock.

**Database.** Postgres 17 in a container with a named volume. The local `psql` client is 14 and will refuse to dump from a 17 server, so database access goes through `docker compose exec db psql` and `pg_dump` runs inside the container.

**Authentication.** The OAuth 2.0 authorization code flow is handled directly by FastAPI, requesting `openid`, `email`, `profile`, and `calendar.freebusy` with offline access in a single consent screen. The redirect URI is `http://localhost:8787/auth/google/callback`. The session is an HttpOnly, SameSite=Lax cookie. Refresh tokens are stored encrypted under a Fernet key held in the environment, never in the database.

**Calendar reads.** On-demand `freebusy.query` calls scoped to the logical day's window, triggered on the first read after the snapshot goes stale and by an explicit refresh action, with the last successful snapshot reused when a call fails. Day open itself does not call Google: opening a day happens inside write paths where a network call would be a poor trade. `freebusy.query` returns availability intervals only, so event titles and descriptions never reach the server rather than being received and discarded. Intervals returned for the primary calendar are merged before capacity subtraction. `calendar.freebusy` cannot enumerate a user's calendar list, so reading more than the primary calendar would mean letting the user name them. There is no sync token, which costs nothing here because this ADR already chose on-demand pulls over push notifications.

**Asynchronous estimation.** Estimation state lives on the task row (status, attempt count, next attempt time). An estimate is attempted inline on creation, and an in-process asyncio sweeper retries anything stale with exponential backoff up to three attempts. The sweep logic sits behind a single callable that is also exposed as an authenticated HTTP endpoint, so that moving to a scheduler-triggered sweep after deployment is a configuration change rather than a rewrite. No Redis and no separate worker process in v1.

**Secrets.** A local `.env` file holding the Google client credentials, the Anthropic API key, the Fernet key, and the database URL. This file is never committed.

**Google Cloud.** A GCP project is still created now, solely to issue the OAuth client and enable the Calendar API. It must not remain in Testing publishing status: with an External user type, Google expires refresh tokens 7 days after consent, which would force a weekly reconnect in an app designed for daily use. Two acceptable configurations resolve plan Open Question 3 for v1: Internal user type if the project sits inside a Google Workspace organization (no verification, no warning, no expiry, org members only), or External published to production while unverified (a one-time warning screen at first consent, a permanent 100-user cap on the project, normal token lifetimes). Setup steps and the full set of traps are recorded in `docs/setup/gcp_setup.md`.

**Deferred to v2, in this order:** hosting (Cloud Run plus managed Postgres is the indicated path given GCP is already mandatory), CI, error reporting, push-based calendar sync, and a background worker if estimation volume ever justifies one.

## 4. Consequences

**Positive.** The fastest path to using the application daily, which is the point of v1: the 75% rule gets pressure-tested in days rather than after a deployment pipeline exists. Zero infrastructure cost and zero vendor lock-in. An always-on local process makes the estimation sweeper trivial, avoiding the Cloud Scheduler dependency that Option A would have required. All of the genuinely hard logic (logical-day resolution, idempotent lazy close, capacity math, calendar sync) is built at full fidelity and is unaffected by where it eventually runs.

**Negative.** No access from a phone or a second device. This is in real tension with a product premise about late-night task completion, and it is the main cost of this choice: a task finished at 03:00 away from the machine cannot be checked off until the user returns to it. Deployment work is deferred, not eliminated, and will be done without the CI habits that building it earlier would have established. All data lives in a single Docker volume on one machine, so a periodic `pg_dump` into a backed-up location is a real operational requirement, not a nicety.

**Coupling to the metrics prerequisite.** The event tables and per-day aggregate shapes implied by this decision are provisional until metrics-mode writes the tracking plan. The binding constraint is that metrics-mode must be able to define its event and property schema without requiring a migration of `logical_days` or of the task state machine. Those two structures are fixed by this ADR; the event payloads around them are not.

**Immediate hazard, outside this decision.** The project is not a git repository and has no `.gitignore`. The first scaffolding will create `.venv`, `node_modules`, and `.env`, and sibling repositories in the same tree already have `venv/` and `.next/` committed. Initializing git with a `.gitignore` must happen before any scaffolding exists to be caught by it. The `.env` file in particular carries the Fernet key and the Anthropic API key.

**Amendments, 2026-10-20 and 2026-10-21.** The original text of this ADR stated that the project would stay in Testing mode with the developer as the sole test user. That was factually wrong: Testing with an External user type expires refresh tokens 7 days after consent. The Decision section has been corrected in place rather than superseded, since the choice of approach is unaffected. A second correction, decided 2026-10-21: the Decision originally specified `calendar.readonly` with `events.list` and `syncToken`. Because this ADR chose on-demand pulls over push notifications, the sync token bought little, while `calendar.freebusy` with `freebusy.query` returns exactly the busy intervals the plan persists and nothing it must discard. `calendar.freebusy` was adopted and the Calendar paragraph amended in place. Both corrections predate any implementation, so no migration or re-consent is involved.

**Amendment, 2026-10-21 (implementation).** Status moved to `accepted`: every decision here is implemented across M1 to M6. Three corrections were made against reality while building. Google's client libraries, `tenacity`, `freezegun`, `zod`, and `date-fns` were listed but proved unnecessary, and have been removed from the manifests rather than left as aspiration. The calendar paragraph overstated multi-calendar support, which the chosen scope does not permit. Calendar sync is triggered by a stale read rather than by day open.

**Reversibility.** High. The container target that FastAPI uses to serve the built SPA is maintained from the first milestone, so the move to Cloud Run is a Dockerfile already in use, a managed Postgres URL, and a changed OAuth redirect URI. The decisions that would be expensive to reverse are the materialized logical-day model and direct Google OAuth, and both are forced by plan requirements rather than by this option.
