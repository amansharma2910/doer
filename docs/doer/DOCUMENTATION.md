# Doer: Project Documentation

Last updated 2026-10-24, after a product website was added at `site/index.html`.
Earlier the same day, after a full documentation sweep that reconciled every
document in `docs/` plus `README.md` against the code. Earlier the same day,
after the fix for a repeat sign-in showing the Google account picker twice.
Before that, 2026-10-23, after the interface overhaul (all four delivery
phases); earlier the same day, after the timeline-window-drag feature and the
24-hour clock field fix. Before that, 2026-10-21, after milestones M1 to M7 and
the pnpm store history rewrite.

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

3. **Calendar busy time is un-subtracted by any task mutation.** Nine of the twelve
   `recompute_capacity` call sites pass no `busy`, so `capacity.compute` subtracts
   zero and `busy_minutes_subtracted` is wiped. `calendar.sync_day` only re-applies
   it when the snapshot is stale, so a calendar-connected user's threshold reads
   high from the next task write until the following day. Found while fixing
   `docs/fixes/fix_plan_stale-block-snapshot.md` and deliberately left alone there;
   it needs its own fix plan.

4. **A pre-2026-10-21 clone still has roughly 122 MB at `frontend/.pnpm-store` on
   disk.** The history rewrite removed it from git and `.gitignore` now matches it
   at any depth, which means it no longer appears in `git status` either. It is
   inert but it is not small, and nothing will prompt you about it. Delete it by
   hand: `rm -rf frontend/.pnpm-store`.

5. **No `.dockerignore` exists, so the build context carries ignored artifacts.**
   `Dockerfile:27` does `COPY frontend/ ./` wholesale, and the `.` context picks
   up `frontend/node_modules` (131 MB) and `backend/.venv` (133 MB) among others,
   roughly 264 MB in total. Removing the pnpm store cut this down from roughly
   386 MB but did not fix it. The sharper half of the problem is correctness, not
   size: line 27 copies the host's darwin-arm64 `node_modules` over the linux
   install from line 26. Unverified, since no build was run to confirm the effect.
   Needs its own fix plan.

6. **The `calendar_connected` event series is not comparable across 2026-10-24.**
   Until that date the callback fired it on every sign-in rather than only when a
   grant was established, so counts before the fix are inflated by roughly one per
   repeat sign-in. A residual gap remains in the other direction: re-consenting
   over an already-usable grant writes a refresh token and emits nothing, because
   the gate is "a previously-unusable grant became usable" rather than "a token was
   written". That case is reachable only by calling
   `/auth/google/login?force_consent=true` by hand. See
   `docs/fixes/fix_plan_repeat-signin-shows-account-picker-twice.md`.

7. **`POST /tasks` accepts an `anchor_date` it silently ignores.**
   `TaskCreate.anchor_date` is declared in `schemas/task.py` and therefore appears
   in the published OpenAPI schema, but the handler never reads it: the day always
   comes from `_resolve_day`. A client posting it to backdate a task gets a 201 and
   the task lands on today. Either the field is wired up or it is removed; leaving a
   documented parameter that does nothing is the worst of the three. Found
   2026-10-24, needs its own fix plan.

8. **The production-parity image calls an absolute `localhost:8787`.**
   `lib/api.ts` falls back to `http://localhost:8787` when `VITE_API_BASE` is
   unset, and the `web-build` stage of the Dockerfile sets no such variable.
   `VITE_API_BASE` appears only on the compose `web` service and is absent from
   `.env.example`. Since `main.py` serves the built SPA same-origin under
   `SERVE_STATIC=1`, the runtime bundle would call a different origin than the one
   it is served from. The runtime image is built and smoke-tested at every
   milestone, so this has not bitten yet, but it makes the deferred deployment
   slightly more than configuration. Found 2026-10-24, needs its own fix plan.

9. **"No component holds a literal" is not true, and the test does not enforce
   it.** Five sites still carry arbitrary-value sizes: `max-w-[12ch]` in `Nav`,
   `h-[7px] w-[7px]` in `DayHeader`, and `gap-[3px]` twice plus `h-[11px] w-[11px]`
   in `Heatmap`. `tokens.test.ts` forbids four patterns, all of them colour
   (`[var(--color-`, `black/[0.`, `white/[0.`, `bg-[color-mix(`), and none of them
   a size. The colour half of the claim is enforced and true. Separately,
   `--shadow-raised` and `--spacing-field` are declared and asserted but consumed
   by no component, because the token tests check declaration rather than adoption
   for everything that is not a colour. This is the same failure mode the overhaul
   recorded against its own test titles.

10. **Calendar freshness has no TTL, and one route skips close.**
   `calendar.is_stale` returns true only when the snapshot predates `day.start_at`,
   so after the first successful sync of a day nothing re-syncs automatically; only
   `POST /days/current/refresh-calendar` will. That same route does not call
   `close_elapsed_days` first, unlike `GET /days/current`, so it can materialize
   today while yesterday sits unclosed. Both are plausibly intended; neither is
   written down anywhere. Found 2026-10-24.

Closed on 2026-10-24: `.env.example` omitted five settings that `config.py`
reads, and described itself as complete. All five are now present. Because
`Settings` is configured `extra="ignore"`, a misspelled variable is still dropped
silently rather than rejected.

11. **`site/index.html` duplicates the design tokens with nothing enforcing the
    copy.** The product website hard-codes the colour, radius, shadow and type
    values from `frontend/src/index.css` so the two surfaces match. Every value
    agrees today, verified pair by pair. Nothing keeps them agreeing:
    `tokens.test.ts` imports `../index.css?raw` and has no reach outside
    `frontend/`, and `tsconfig.json` includes only `src`, so the page is covered
    by no lint, no type check, no test and no build. The values carrying contrast
    obligations are the ones to watch, since `muted` owes 4.5:1 and `risk-mark`
    owes 3:1 and a copy that drifts fails silently on a public page. Changing a
    token means changing it twice.

Closed on 2026-10-21: carry-forward demotions are now surfaced in the task list;
a frontend test suite exists; and migrations run on container start.

Open as of 2026-10-23, from `timeline-window-drag`: the pointer and keyboard
gestures on the settings timeline have no automated coverage, and Flow 16 of
`docs/user_testing_documentation.md` is the agreed gate. A failed step there
blocks exactly as a failed test does. The geometry beneath the gestures is
covered exhaustively as pure functions.

The *reason* for that gap changed later the same day. ADR 0002 declined a DOM
test harness; ADR 0003 withdrew the deferral on the condition ADR 0002 set for
itself, and a harness now exists. The timeline gestures are still uncovered, but
that is now an unfinished job rather than a decision: the harness arrived with
the interface overhaul and was pointed at routing, the day header, the task
rows, the history screens and, since 2026-10-24, settings block editing. The
same change of status applies to the `ClockInput` keystroke gap behind Flow 17.

## 1. Project Structure

```
doer/
├── Dockerfile              four stages: base, dev, web-build, runtime
├── docker-compose.yml      db, api (8787→8000), web (5173), backup (hourly dumps), tests (profile)
│                        volumes: doer-pgdata, doer-web-modules, doer-web-store
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
├── frontend/src/
│   ├── main.tsx            ReactDOM root, and the only place the global query
│   │                       defaults live: retry 1, refetchOnWindowFocus true
│   ├── index.css           the design token layer: every colour, type step,
│   │                       spacing step, radius and shadow, in both schemes
│   ├── App.tsx             auth gate and router: offline, loading, sign-in,
│   │                       outage; exports AppRoutes separately so a test can
│   │                       mount the tree in a MemoryRouter
│   ├── lib/                api client, typed hooks, wire types; daytime.ts holds
│   │                       day/offset arithmetic, clock parsing and formatting,
│   │                       timeline placement geometry and anchor-date display;
│   │                       stats.ts (history figures), heatmap.ts (cell colour),
│   │                       elapsed.ts (time since a start), useMediaQuery.ts
│   ├── pages/              SignIn, Today, History, DayDetail, Settings
│   └── components/         AppShell (frame, breakpoint), Nav (both navigations),
│                           DayHeader (four-slot contract), TaskList (dnd-kit
│                           reorder, icon controls, in-progress), TaskEntry (the
│                           two entry paths), AddTask, Chat, Heatmap, DayTimeline
│                           (drag and resize), ClockInput (24-hour time entry),
│                           states (loading, empty, error), icons (hand-drawn)
└── site/
    └── index.html          the product website: one static file, no build, no
                            network request, hosted anywhere. Not part of the
                            application and in no image layer
```

**`site/` is not the application.** It is a marketing page that happens to live
in the repository, and nothing builds, serves or tests it. `Dockerfile` copies
`backend/` and `frontend/` by name and never selects it, `docker-compose.yml`
mounts neither, and the `runtime` stage serves `/web/dist` from the Vite build.
Note that there are now two files called `index.html` with unrelated roles:
`frontend/index.html` is the Vite entry point, `site/index.html` is the website.
See `docs/features/product-website_doc.md`.

Two unrelated drag surfaces, worth not confusing. Task reordering uses
`@dnd-kit`; the settings timeline uses native pointer capture against a custom
constraint solver in `daytime.ts`, and `@dnd-kit` is not involved in it.

**Times are entered through `ClockInput`, never `<input type="time">`.** The
native control picks 12-hour or 24-hour from the browser's locale and cannot be
constrained: Firefox ignores the `lang` attribute for it, and release Chromium
discards it behind a flag that ships disabled. Every time surface in the app is
24-hour, so the native control was the only one disagreeing with the rest. See
`docs/fixes/fix_plan_time-inputs-show-12-hour-clock.md`.

The line counts previously given here (roughly 5,000 application, 2,400 test) are
stale as of 2026-10-23 and are removed rather than re-estimated, since the method
used to produce them was never recorded.

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

`pyproject.toml` declares floors and `uv.lock` pins 52 packages, but **neither
Docker target installs from the lockfile**: `Dockerfile:15` and `Dockerfile:34`
both run `uv pip install --system --no-cache -r pyproject.toml`, which re-resolves
from the floors at build time. The locked versions therefore describe `uv run` on
a host, not what the images contain. Two builds a month apart can differ.

Google's own client libraries are deliberately absent. Three OAuth endpoints and
one FreeBusy call are clearer as direct `httpx` calls than as library machinery,
and the library would not have made the scope limits any more visible.

### Backend dev

`pytest >=8.3.0`, `pytest-asyncio >=0.24.0`, `respx >=0.21.1` (mocks Google's HTTP
calls), `ruff >=0.7.0`.

Anthropic is not mocked with respx. It is replaced with a scripted double, because
what needs testing is our handling of the response, not the SDK's transport. There
is a mechanical reason as well, found on 2026-10-24: `anthropic` resolves to 1.16.0,
which depends on `httpx2` rather than `httpx`. respx patches `httpx`, so it
structurally cannot intercept Anthropic traffic. The image carries two independent
HTTP client stacks for this reason.

### Frontend

Runtime: `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`,
`@dnd-kit/{core,sortable,utilities}`. All three `@dnd-kit` packages are used in
exactly one file, `components/TaskList.tsx`.
Dev: `typescript`, `vite`, `vitest`, `@vitejs/plugin-react`, `tailwindcss` +
`@tailwindcss/vite`, React type packages, and as of 2026-10-23 `jsdom`,
`@testing-library/react` and `@testing-library/user-event`.

Nothing in either manifest is unimported, and nothing imported is missing from a
manifest. On the backend `uvicorn`, `asyncpg` and `alembic` are imported by no
source file and are all required anyway: the first two are a command and a driver
loaded through the URL, the third is a CLI.

**The runtime manifest is still unchanged**, which is the property the
no-new-dependency posture actually protects. Earlier documents say
"`package.json` is unchanged" without that qualifier; after 2026-10-23 only the
runtime half of it is. The three additions are development-only and ship in no
bundle. ADR 0003 records why they were taken: the suite ran in Vitest's node
environment with no DOM, so the coverage the overhaul committed to was not
expressible without one.

Tailwind v4 has no config file; the theme lives in `src/index.css` under
`@theme`, and since the interface overhaul that block is the single source for
every colour in the application. For sizes the claim is weaker than earlier
documents state: see Drift Note 9. It is plain `@theme`,
**never `@theme inline`**: plain `@theme` emits utilities that reference the
custom property, so the dark-scheme `:root` override reaches them at run time,
where `@theme inline` resolves the value at build time and would break it.
Verified against Tailwind 4.3.3 and guarded by a test.

Pinned toolchain: `postgres:17`, `python:3.13-slim`, `node:23-slim`, `uv 0.9.5`,
`pnpm@10.33.2`.

## 3. Cross-Module Dependency Map

Most depended-upon first:

Derived from the import graph on 2026-10-24, over `backend/doer` and
`backend/alembic`. Five rows of the previous version of this table were wrong and
are corrected here.

| Module | Count | Depended on by |
|---|---|---|
| `doer.models` | 13 | all five routers, `api.deps`, and services `assistant`, `calendar`, `close_service`, `day_service`, `estimation`, `metrics`, `task_service`, `token_store`. Also alembic and every test |
| `doer.config` | 12 | `alembic.env`, `api.auth`, `api.deps`, `api.tasks`, `crypto`, `db`, `main`, and services `assistant`, `estimation`, `google_oauth`, `llm`, `metrics` |
| `doer.daytime` | 11 | `api.days`, `api.deps`, and services `assistant`, `calendar`, `capacity`, `close_service`, `day_service`, `estimation`, `google_oauth`, `task_service`, `token_store` |
| `doer.events` | 8 | `api.auth`, and services `assistant`, `calendar`, `close_service`, `day_service`, `estimation`, `task_service`, `token_store` |
| `doer.db` | 7 | all five routers, `api.deps`, `services.estimation` (its own session for detached work) |
| `services.task_service` | 6 | `api.assistant_routes`, `api.settings_routes`, `api.tasks`, and services `calendar`, `close_service`, `estimation` |
| `api.deps` | 5 | all five routers |
| `services.day_service` | 4 | `api.days`, `api.settings_routes`, `api.tasks`, `services.close_service` |
| `services.calendar` | 3 | `api.days`, `api.settings_routes`, `api.tasks` |
| `services.close_service` | 3 | `api.days`, `api.tasks`, `services.metrics` (deferred import) |
| `services.capacity` | 3 | `services.calendar`, `services.day_service`, `services.task_service` |
| `services.llm` | 3 | `api.assistant_routes`, `services.assistant`, `services.estimation` |
| `doer.crypto`, `services.google_oauth` | 2 each | `api.auth`, `services.token_store` |
| `services.token_store` | 1 | `services.calendar` only |
| `services.metrics` | 1 | `services.close_service` only |

Frontend, most depended-upon first:

| Module | Depended on by |
|---|---|
| `lib/types` | every page, every component that renders data, hooks, api |
| `lib/hooks` | App, Nav, Today, History, DayDetail, Settings, TaskList, AddTask, Chat, Heatmap, DayHeader |
| `lib/api` | App, Today, DayDetail, Settings, TaskList, AddTask, hooks |
| `lib/daytime` | Settings, DayHeader, DayDetail, DayTimeline, ClockInput, `lib/stats` (the only lib-to-lib edge besides hooks to api to types) |
| `components/states` | App, Today, History, DayDetail, Settings |
| `components/icons` | TaskList, TaskEntry |
| `lib/stats` | History |
| `lib/heatmap` | Heatmap |
| `lib/elapsed` | TaskList |
| `lib/useMediaQuery` | AppShell |

Four structural facts worth knowing before changing anything:

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
- **`api.auth` and `services.token_store` share a definition of a usable grant
  without importing each other.** The sign-in callback decides whether it can reuse
  a stored grant (`auth.py`, `had_usable_grant`) using the same three conditions
  `token_store.access_token_for` enforces before issuing an access token: a row
  exists, `status` is active, and `refresh_token_encrypted` is non-empty. Only a
  comment links them. If they diverge, the callback either forces consent the user
  does not need, or commits a row that fails later at calendar-read time with an
  unhandled error rather than the designed degradation. The two placeholder and
  revoked cases in `TestGoogleSignIn` are the only things that would notice.

Frontend: everything network goes through `lib/api.ts`, and everything stateful
through `lib/hooks.ts`. `useTaskMutation` invalidates tasks, day, and heatmap
together, because any task change can move capacity. Since the interface
overhaul it invalidates by bare prefix (`["tasks"]`, `["day"]`), so a mutation
on Today also refreshes an open `/history/:anchor` view.

No component imports another page, and no `lib/` module imports a component.

**Four components cannot be rendered outside a router**, not one as this document
previously said: `AppShell` (`Outlet`), `Nav` (`NavLink`), `DayHeader` (`Link`)
and `Heatmap` (`Link`). This is why the DOM tests wrap in a `MemoryRouter`.

**A third cache rule, and the easiest of the three to break silently.**
`useDay` decides whether to poll by reading the *tasks* cache by key, so the two
queries are coupled through `keys.tasks`. When that key gained an `anchor`
segment for the day-detail screen, a lookup left on the old flat key would have
returned `undefined` and the day would have quietly stopped following the
estimate cadence, with nothing failing and no test noticing. Both sides change
together; `history.test.tsx` now covers the coupling.

**Invalidation is not uniform, and the narrative above describes only the common
case.** There are four distinct refresh behaviours, which is the thing most likely
to mislead a reader of this section:

- **`useTaskMutation`**, used by every task mutation, invalidates the bare
  prefixes `["tasks"]`, `["day"]` and `["heatmap"]` on `onSettled`.
- **Preference block add and remove do not go through `lib/hooks.ts` at all.**
  They are `useMutation` calls inside `BlocksEditor` that call `api()` directly
  and hand-invalidate through their own `refreshAfterBlockChange`. This mirrors a
  server-side effect, since the backend recomputes the open day's capacity on
  every block write, and nothing in the type system connects the two.
- **`useRefreshCalendar` invalidates the exact tuple `keys.day`**, not the prefix,
  so its reach is narrower than every other mutation's.
- **`DayShapeForm.save` invalidates only `keys.me`, and on `onSuccess` rather than
  `onSettled`**, so it is the one mutation that does not reconcile after a
  failure. That is defensible given the screen says changes apply from the next
  day, but it is a deliberate exception rather than the pattern.

`Settings.tsx` is therefore a second data-access pattern living alongside the
hooks: three of its mutations bypass them. ADR 0003 flagged this and asked for it
to be resolved or deliberately kept during phase 4; it was neither, and the
block-edit fix extended it. See roadmap correction 9(c).

Two cache rules that are load-bearing and easy to get wrong:

- **Tearing the cache down uses `resetQueries`, never `clear()`.** `clear()`
  destroys the query objects but leaves mounted observers attached to the dead
  ones, still reporting their last success, so React is never notified and the
  page freezes on stale data. Nothing sequenced after a `clear()` can reach those
  observers. `hooks.ts` exports `signOutTeardown(queryClient)` for this, as a
  plain function rather than a hook so it is testable without a DOM. The
  reasoning is specific to `@tanstack/react-query` 5.104.5, which the lockfile
  resolves from a `^5.59.0` range. See
  `docs/fixes/fix_plan_signout-leaves-page-frozen.md`.
- **The global query defaults live in `main.tsx`**: `retry: 1` and
  `refetchOnWindowFocus: true`. They decide the request burst on sign-out, and
  the focus refetch is part of why the `clear()` defect could not self-heal.

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

### Named volumes

Three, all declared at the foot of `docker-compose.yml`:

| Volume | Mount | Why it exists |
|---|---|---|
| `doer-pgdata` | `db:/var/lib/postgresql/data` | Database durability across restarts |
| `doer-web-modules` | `web:/web/node_modules` | Keeps the container's linux install from colliding with the host's darwin one over the `./frontend:/web` bind mount |
| `doer-web-store` | `web:/web/.pnpm-store` | Keeps pnpm's package store off the host bind mount |

`doer-web-store` is load-bearing rather than an optimization. pnpm cannot
hardlink from the bind-mounted project root into its home store, so it falls back
to `<projectRoot>/.pnpm-store`, which resolves to `frontend/.pnpm-store` on the
host. Without the volume that directory accumulates on the host and gets
committed, which is what happened in M5: see
`docs/fixes/fix_plan_pnpm-store-committed-to-history.md`.

Two consequences worth knowing. The first `docker compose up` after pulling this
change refetches the package store into an empty volume, so that one run is slow;
later runs reuse it and are faster than before. And `docker compose down -v`
discards the package cache along with the database, so the next `up` pays the
refetch again.

### If you have a clone from before 2026-10-21

`main` was rewritten with `git filter-repo` on 2026-10-21 to remove the committed
pnpm store, so 17 of the 22 commits up to that point have new SHAs. The five
commits before M5 kept theirs. Re-clone, or:

```bash
git fetch origin && git reset --hard origin/main
```

Do not `git pull`: it will try to merge the old history and reintroduce the
removed objects.

### Tests

```bash
docker compose --profile test run --rm tests   # 220 tests, in a container

cd backend && uv sync --group dev              # or on the host
docker compose exec db psql -U doer -d postgres -c "create database doer_test"
uv run pytest             # 220 tests, deterministic and offline
uv run pytest -m live     # 7 more that call the real model and cost money
```

```bash
cd frontend && pnpm test  # 324 tests across 14 files, measured 2026-10-24.
                          # Pre-existing: day/offset arithmetic, clock stepping
                          # and timeline placement (114), heatmap rules (12),
                          # clock field markup (11), timeline markup (10),
                          # sign-out teardown (7), error decoding (4). Added by
                          # the interface overhaul: design tokens and contrast
                          # (50), the Today screen (29), routing and the auth
                          # gates (17), history statistics (17), settings and
                          # polish (18), anchor-date display (15), history and
                          # day detail (13). Added by the block-edit fix:
                          # settings block editing (7).
```

The suite drops and re-migrates the schema of the database it is pointed at, so
it refuses to start unless that database's name ends in `_test`. It ignores
`DATABASE_URL` as a target, because the `api` container sets that to the
production database; the only accepted override is `DOER_TEST_DATABASE_URL`. An
inherited non-test `DATABASE_URL`, which is what a shell that has sourced `.env`
carries, is a hard refusal rather than a silent redirect.

The separation is **guarded, not isolated**: `doer` and `doer_test` share a
cluster, a role and a password, and two assertions in `backend/tests/conftest.py`
are what keep them apart. A role with no rights on `doer` is the stronger version
and is recorded as a follow-up.

It migrates with Alembic rather than `create_all` on purpose: the append-only and
immutability guarantees live in triggers that only migrations create. For the
same reason `alembic downgrade` is refused unless
`DOER_ALLOW_DESTRUCTIVE_MIGRATION=1` is set, since every migration here drops
tables. `alembic upgrade` is unguarded, because the container runs it on start.

All of this exists because the suite destroyed the development database on
2026-10-21: `docs/fixes/fix_plan_tests-wipe-production-database.md`.

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
because the Today screen asks a user with no focus blocks to go and define one. A day's real duration is computed by wall-clock arithmetic in the
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
capacity must never read as headroom. The client degrades deliberately too: a
paused fetch renders "Offline. Waiting for a connection." rather than the
API-outage message, so the application never blames the server for the browser's
connection.

Recovery from a revoked grant runs through sign-in, not through the app. The
"Reconnect" control re-queries the calendar with the grant it has; it cannot
re-consent. The only route back is signing out and in again, which hits the
narrowed forced-consent branch in the auth callback. Since 2026-10-24 that branch
fires only when nothing usable is stored, which is also what keeps an ordinary
repeat sign-in down to a single account picker. Revocation at Google is now
detected at calendar-read time rather than at sign-in, so a grant revoked
out-of-band surfaces as the degraded state first and re-consents on the following
sign-in.

**Estimation is durable without a worker.** State lives on the task row, an attempt
runs inline, and an in-process sweeper retries what is due. The sweep logic sits
behind one callable that is also an HTTP endpoint, so a scheduler can drive it on a
host that scales to zero.

## 6. Data Model and API Surface

Added 2026-10-24. Neither contract was described anywhere in this document, and
they are the two most exposed to drift.

### The nine tables

Column lists live in `backend/doer/models/`; this is the map, not the schema.

| Table | Holds | The part that is a contract |
|---|---|---|
| `users` | Identity and the day-shape preferences: timezone, start time, duration, capacity ratio | Checks on duration (60 to 1440) and ratio |
| `auth_sessions` | Opaque sessions. 32 bytes of `token_urlsafe`, stored as a SHA-256 hex digest | `token_hash` unique. The raw cookie value is never stored |
| `oauth_tokens` | The Google grant, Fernet-encrypted | One row per user (`user_id` unique). `status` is `active` or `revoked`. `refresh_token_encrypted` is created as empty bytes before a grant is first stored, which is one of the three conditions meaning "nothing usable" |
| `preference_blocks` | Focus and rest blocks, as minute offsets from day start rather than clock times | Checks on kind, non-negative start, and start before end |
| `logical_days` | The spine. One materialized row per user per anchor date, with the day shape frozen at open | `UNIQUE (user_id, anchor_date)`, which is what makes lazy close idempotent under concurrency. `duration_minutes` is real elapsed time, so it differs from the configured duration on a DST day |
| `tasks` | The work, its estimate, its estimation state machine, and its carry-forward history | `CHECK estimate_minutes % 15 = 0`. A trigger refuses deletion of any row with `completed_at` set, including via cascade. The four-primary cap is deliberately **not** a constraint, because carry-forward must demote within the same transaction |
| `events` | The append-only analytics log, 31 event names | A trigger refuses UPDATE and DELETE. TRUNCATE still works, which is how tests clean up. `logical_day_id` is `SET NULL`, not cascade |
| `estimate_cache` | Model estimates keyed on a normalized title | `UNIQUE (user_id, normalized_title)`, so the cache is per user and never global |
| `daily_metrics` | One aggregate row per closed day, including token counts and a cost rollup | `UNIQUE (user_id, anchor_date)` |

`logical_days` declares no ORM relationship to `users` or `tasks`. Every join to
it is written explicitly.

Migrations are a linear Alembic chain of six, ending at `5093a6d0e446`. Two of
them install the triggers above, which is the whole reason the test suite
migrates rather than calling `create_all`.

### The route surface

24 routes across five routers (auth 4, settings 4, days 4, tasks 9, assistant 3),
plus two registered on the app itself: `GET /health`, and the SPA catch-all that
exists only when `SERVE_STATIC=1` and is excluded from the schema. 26 in total. The per-route table, with status codes and
refusal semantics, is in `docs/features/daily-task-planner_doc.md` §4 and is not
duplicated here.

Three facts about it that belong with the structure rather than the feature:

- **Route order in `api/days.py` is load-bearing.** `/heatmap` and `/current` are
  registered before `/{anchor}`, so the literal paths win over date parsing.
- **Five response models are declared outside `doer/schemas/`**: `HeatmapCell` and
  `HeatmapGrid` in `api/days.py`, the three chat models in `api/assistant_routes.py`,
  and `ProposedTask`/`Proposal` in `services/assistant.py`. Two endpoints,
  `GET /auth/me` and `PATCH /settings/day-shape`, return a bare `dict` and so carry
  no typed schema in the OpenAPI document at all.
- **There is no update endpoint for a preference block**, only create and delete.
  `_reject_overlap` carries a `skip_id` parameter that no caller passes, which is
  the residue of an update path that was never built.
