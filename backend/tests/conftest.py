"""Test fixtures.

Integration tests run against a real Postgres, migrated with Alembic rather than
built from model metadata. That distinction matters: the triggers enforcing
append-only events and completed-task immutability live in migrations, so a schema
built from `create_all` would silently omit the very guarantees under test.
"""

import asyncio
import os
import subprocess
from datetime import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Assigned, never defaulted. `setdefault` yields to an inherited value, and the
# api container sets DATABASE_URL to the production database while also shipping
# the test runner, so this file's DROP SCHEMA landed on real data. Overrides come
# from a test-only name that nothing in compose or .env sets.
# See docs/fixes/fix_plan_tests-wipe-production-database.md.
DEFAULT_TEST_URL = "postgresql+asyncpg://doer:doer@localhost:5432/doer_test"
_inherited = os.environ.get("DATABASE_URL")
_override = os.environ.get("DOER_TEST_DATABASE_URL")
os.environ["DATABASE_URL"] = _override or DEFAULT_TEST_URL

# Ignoring the inherited value silently would be safe but unreadable: inside the
# api container the fallback cannot reach `localhost` and the run dies on a bare
# connection error. Say what happened instead.
if _inherited and not _override and not _inherited.rsplit("/", 1)[-1].endswith("_test"):
    raise RuntimeError(
        f"refusing to run: DATABASE_URL names {_inherited.rsplit('/', 1)[-1]!r}, which is "
        f"not a test database, and this suite drops the schema it is pointed at. "
        f"Run `docker compose --profile test run --rm tests`, or set "
        f"DOER_TEST_DATABASE_URL, or unset DATABASE_URL in this shell."
    )
os.environ.setdefault("FERNET_KEY", "Q2hhbmdlTWVDaGFuZ2VNZUNoYW5nZU1lQ2hhbmdlTWU=")
# A fire-and-forget estimation task outlives the fixtures that own its rows and
# fails during teardown, which showed up as an intermittent error. Tests drive
# estimation explicitly instead.
os.environ.setdefault("BACKGROUND_ESTIMATION_ENABLED", "false")
os.environ.setdefault("SWEEPER_ENABLED", "false")

import asyncpg  # noqa: E402
import pytest  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from doer.models import PreferenceBlock, User  # noqa: E402

TEST_URL = os.environ["DATABASE_URL"]
_url = make_url(TEST_URL)

# The last line of defence, and the one that survives someone "fixing" the
# override above to make in-container runs work again. Raised at import time, so
# collection fails before any connection is opened.
if not (_url.database or "").endswith("_test"):
    raise RuntimeError(
        f"refusing to run: the suite drops and re-migrates the schema of the database "
        f"it is pointed at, and {_url.database!r} is not a test database. Set "
        f"DOER_TEST_DATABASE_URL to a database whose name ends in '_test'."
    )

RAW_URL = _url.set(drivername="postgresql").render_as_string(hide_password=False)


@pytest.fixture(scope="session", autouse=True)
def migrated_database():
    """Reset the test schema and run every migration against it, once per session."""

    async def wipe():
        conn = await asyncpg.connect(RAW_URL)
        try:
            await conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        finally:
            await conn.close()

    asyncio.run(wipe())
    subprocess.run(
        ["uv", "run", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env={**os.environ, "DATABASE_URL": TEST_URL},
        check=True,
        capture_output=True,
    )


@pytest.fixture(scope="session")
async def engine(migrated_database):
    engine = create_async_engine(TEST_URL)
    yield engine
    await engine.dispose()


@pytest.fixture
async def clean_db(engine):
    # TRUNCATE is a statement-level operation and does not fire the row-level
    # append-only trigger, which is what makes per-test cleanup possible at all.
    async with engine.begin() as conn:
        await conn.exec_driver_sql("TRUNCATE users, events CASCADE;")
    yield


@pytest.fixture
async def session_factory(engine, clean_db):
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture
async def session(session_factory):
    async with session_factory() as s:
        yield s
        await s.rollback()


@pytest.fixture
async def user(session):
    """The canonical late-night user: day runs 14:00 to 05:00 in Asia/Kolkata."""
    u = User(
        google_sub="test-sub",
        email="test@example.com",
        name="Test",
        timezone="Asia/Kolkata",
        day_start_time=time(14, 0),
        day_duration_minutes=15 * 60,
        capacity_ratio=0.5,
    )
    session.add(u)
    await session.commit()
    return u


@pytest.fixture
async def user_with_focus(session, user):
    """Same user with five hours of focus blocks, so capacity is computable.

    Deep work at offsets 60-240 (15:00-18:00) and personal project at 420-540
    (21:00-23:00), giving a 300 minute base and a 150 minute threshold at 50%.
    """
    session.add_all(
        [
            PreferenceBlock(
                user_id=user.id,
                kind="deep_work",
                start_offset_minutes=60,
                end_offset_minutes=240,
            ),
            PreferenceBlock(
                user_id=user.id,
                kind="personal_project",
                start_offset_minutes=420,
                end_offset_minutes=540,
            ),
        ]
    )
    await session.commit()
    return user
