---
type: fix_plan
issue: tests-wipe-production-database
severity: critical
status: verified
related_feature: daily-task-planner
linear_issue: null
created: 2026-10-21
updated: 2026-10-21
---

# Fix plan: the test suite drops the production schema

Severity is critical because the defect already destroyed all of the user's data,
irrecoverably, and every remaining invocation of the suite would do it again.

## 1. Issue

`backend/tests/conftest.py:17` declares a test database with
`os.environ.setdefault("DATABASE_URL", ".../doer_test")`. `setdefault` yields to
any inherited value. Line 31 then reads the variable back, and the session-scoped
autouse fixture at lines 35-53 runs `DROP SCHEMA public CASCADE; CREATE SCHEMA
public;` against whatever it names.

`docker-compose.yml:28` sets `DATABASE_URL` to the production database on the
`api` service, and `Dockerfile:13-16` installs the dev dependency group into that
same image, so the container is a fully equipped test runner permanently aimed at
production. Every `docker compose exec api python -m pytest` therefore drops the
production schema and rebuilds it empty.

This occurred on 2026-10-21. The assistant ran the suite in that container
several times while verifying unrelated fixes. Confirmed in the live database
afterwards: a `test@example.com` user and its two fixture `preference_blocks`,
created 00:17:20 UTC, and the real user's row recreated at 00:23:37 UTC when they
signed back in to an empty application.

Two further paths carry the same defect:

- The host path. `.env:4` was retargeted to `localhost:5432/doer`, which reaches
  the same cluster through the published port at `docker-compose.yml:9-10`.
  `README.md:38-39` instructs the reader to export that file into their shell,
  and `README.md:52` tells them to run the suite twelve lines later. In that
  shell `setdefault` is again a no-op. A fresh shell is safe.
- `alembic downgrade`. `alembic/env.py:19-20` resolves the URL with no
  validation and every migration implements a real `downgrade()`, so
  `docker compose exec api alembic downgrade base` repeats the incident by
  another route. `docs/user_testing_documentation.md:13` has already established
  `docker compose exec api <tool>` as the normal way to run backend commands.

The fixture is `autouse=True` at session scope, so there is no safe subset: a
pure unit file such as `test_crypto.py` or `test_daytime.py` triggers the drop
before its first test runs.

## 2. Business Impact

All application data was destroyed: tasks, preference blocks, logical days,
completion history, OAuth tokens and sessions. The user was signed out, signed
back in, and received a fresh account with default settings.

The `events` table is the application's append-only audit log, and the trigger
that makes it unfalsifiable is itself inside the dropped schema, so the guarantee
is defeated one level above where it is enforced. The `daily_metrics` rows that
feed the north star went with it, as did `estimate_cache`, which means previously
paid-for model estimates will be re-billed.

Recovery is impossible from anything in the repository: `archive_mode` is off,
`wal_level` is replica, there is no dump, no backup service, and no snapshot.
`DROP SCHEMA` is a logical operation inside the live cluster, so the named volume
holds only the post-drop state.

## 3. Root Cause

Three independent conditions, all required:

1. `setdefault` is the wrong primitive for a value the harness must control
   (`conftest.py:17`). The file uses it for `FERNET_KEY` and the two feature
   flags as well, where an override is harmless. For the database URL an override
   is destructive.
2. Nothing validates the target between reading the URL and dropping the schema.
   No name check, no comparison against the application's own URL, no
   confirmation. A single assertion would have turned a data-loss event into a
   collection error.
3. Compose puts the production URL on the one container that also ships the test
   runner, and nothing marks that container as unsafe for tests.

Documentation is a fourth, contributing cause, because it asserts the safety
property as established fact and so removes the reason to look for a guard:
`docs/plans/implementation_plan_daily-task-planner_1.md:279` claims the suite
"creates and migrates its own `doer_test` database and never touches the
development one", and `docs/doer/DOCUMENTATION.md:179-182` repeats it. Neither is
true: nothing creates that database and nothing confines the suite to it.

Nothing in the repository would have caught this. There is no CI, no Makefile, no
task runner, no sanctioned command wrapper, and no assertion anywhere.

## 4. Chosen Strategy and Rationale

Four changes, chosen together:

1. **Force the URL** (`conftest.py`). Stop honouring `DATABASE_URL` entirely.
   Read an override only from `DOER_TEST_DATABASE_URL`, a name that nothing in
   compose or `.env` sets, and assign rather than default.
2. **Guard the target** (`conftest.py`). At import time, before any connection is
   opened, refuse to proceed unless the resolved database name ends in `_test`.
   This closes the escape hatch in change 1 and survives anyone later "fixing"
   the harness to make in-container runs work again.
3. **Guard `alembic downgrade`** (`alembic/env.py`), scoped to downgrade only.
   Upgrade must stay open: `docker-compose.yml:29-30` runs `alembic upgrade head`
   on every container start, and both `README.md` and the user-testing doc
   instruct humans to run upgrades by hand.
4. **A test service in compose**, behind a `test` profile, carrying
   `DOER_TEST_DATABASE_URL` and deliberately not inheriting `env_file: .env`, so
   there is a supported in-container way to run the suite.

Changes 1 and 2 are the fix. Change 4 on its own would have been the most likely
way to close this incident while leaving it live, because adding a safe path does
not remove the unsafe one: after change 4 alone, `docker compose exec api pytest`
still works exactly as it did tonight.

Separately, and independent of the above: **an hourly `pg_dump` sidecar** writing
timestamped dumps to a host directory, so the next event of this class is
annoying rather than permanent. Nothing in the repository could have restored
this loss and nothing would have restored the next one.

Considered and deferred: a separate Postgres role with no rights on the `doer`
database. It is the only option that makes the defect impossible rather than
detected, holding even against a malformed URL or a future rewrite of the
harness. It touches the shared credentials in compose, both env files, and two
documents, so it is recorded as a follow-up rather than blocking this fix.

Deliberately not included: auto-creating `doer_test`. The database already
exists, the prerequisite is documented, and creating databases from a test
harness is not needed to close this defect.

## 5. Affected Files

- `backend/tests/conftest.py`: force the URL, add the name guard, and parse with
  `make_url` instead of string-replacing the driver out.
- `backend/alembic/env.py`: refuse `downgrade` unless explicitly overridden.
- `docker-compose.yml`: a `tests` service behind the `test` profile; a `backup`
  service running hourly dumps.
- `.gitignore`: the backups directory.
- `README.md`: stop leaving `DATABASE_URL` exported in the reader's shell, and
  name the database the suite requires. `README.md` falls outside every mode's
  ownership row in the tpm-os router, so this edit is made outside the mode
  system deliberately rather than by oversight. (The router is injected by the
  plugin at session start; this repository has no `CLAUDE.md` file.)
- `docs/doer/DOCUMENTATION.md`: correct the false claim about `doer_test`.
- `docs/plans/implementation_plan_daily-task-planner_1.md:279` carries the same
  false claim but is owned by interview-mode, so it is not edited here. The
  correction is recorded as item 7 of the roadmap's Scope and Document
  Corrections by the roadmap-mode pass that follows this fix.

## 6. Regression Risk

1. **In-container runs begin failing.** After change 1, `docker compose exec api
   pytest` is refused outright. The first implementation let it die on an
   unreachable `localhost:5432`, which was safe but unreadable, so the harness
   now inspects the inherited `DATABASE_URL` and raises a message naming the
   `test` profile. "Stop honouring `DATABASE_URL`" in section 4 is therefore
   precise about the outcome and loose about the mechanism: the variable is
   never used as the target, but it is read, and its content decides whether the
   run is refused. Nothing in the repository
   depends on `DATABASE_URL` being inherited by the test process: the harness
   already overrides it explicitly when it shells out to Alembic
   (`conftest.py:50`), which is precisely what line 17 should have done.
2. **The name guard rejects a production database named with a test suffix.**
   Accepted; no such database exists here.
3. **The downgrade guard must not catch upgrade.** Verified by running the normal
   container start path after the change.
4. **The backup sidecar writes to a host directory** on an hourly loop, retaining
   48 dumps. Disk cost is small at this data volume and bounded by the retention.

## 7. Test Plan

The suite cannot be used to verify a fix to the suite's own safety, so these are
checked directly:

- `DOER_TEST_DATABASE_URL` unset and `DATABASE_URL` set to the production URL:
  the harness targets `doer_test` regardless, and the production database is
  untouched. Verified by row counts before and after.
- `DOER_TEST_DATABASE_URL` pointed at a non-test name: collection fails with the
  guard's message and no connection is opened.
- `alembic downgrade` in the container: refused. `alembic upgrade head`: allowed,
  and the normal container start path still works.
- The `test` profile runs the full suite green against `doer_test`.
- The backup service produces a dump file, and that dump restores into a scratch
  database.

Acceptance: the production database's row counts are identical before and after a
full suite run, and the suite passes against `doer_test`.

Result on 2026-10-21, each item checked directly rather than through the suite:

- Production row counts before and after a full run through the `test` profile
  are identical: users 2, tasks 1, preference_blocks 2, logical_days 3, events
  18. `doer_test` is the database that was dropped and rebuilt.
- 205 passed, 7 deselected, via `docker compose --profile test run --rm tests`.
- `docker compose exec api python -m pytest tests/test_crypto.py`, the shape of
  the command that caused the loss, now fails at conftest import with the
  inherited-URL message, before any connection is opened.
- `DOER_TEST_DATABASE_URL` pointed at `doer` fails at import with the name-guard
  message.
- `alembic downgrade -1` in the container is refused; `alembic upgrade head`
  still succeeds, so container start is unaffected.
- The backup sidecar wrote `doer-20261021-090957.dump`, which restored into a
  scratch database with 2 users and 18 events. The scratch database was dropped.

One correction during implementation: the `tests` service first ran bare
`pytest` and failed with `ModuleNotFoundError: No module named 'doer'`. The app
package is bind-mounted rather than installed, so it is importable only when the
working directory is on `sys.path`. The service runs `python -m pytest`.

## 8. Rollback Plan

Every change is additive or a one-line substitution, and reverting the commit
restores the previous behaviour, including the defect. The backup sidecar can be
stopped independently with `docker compose stop backup` without affecting the
guards. No schema change and no migration, so there is nothing to undo in the
database itself.
