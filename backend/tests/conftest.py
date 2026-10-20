"""Test fixtures.

Integration tests run against a real Postgres, not a mock. The constraints this
application depends on (uniqueness on (user, anchor_date), the append-only trigger,
transactional carry-forward) exist in the database, and a mocked session cannot
prove any of them.
"""

import os
from datetime import time

os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://doer:doer@localhost:5432/doer_test"
)
os.environ.setdefault("FERNET_KEY", "Q2hhbmdlTWVDaGFuZ2VNZUNoYW5nZU1lQ2hhbmdlTWU=")

import pytest  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from doer.models import Base, User  # noqa: E402

TEST_URL = os.environ["DATABASE_URL"]


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="session")
async def engine():
    engine = create_async_engine(TEST_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
        # The migration installs this trigger; mirror it so integration tests
        # exercise the same guarantee the real database enforces.
        await conn.exec_driver_sql("""
            CREATE OR REPLACE FUNCTION events_are_append_only()
            RETURNS TRIGGER AS $$
            BEGIN
                RAISE EXCEPTION 'events is append-only: % is not permitted', TG_OP;
            END;
            $$ LANGUAGE plpgsql;
        """)
        await conn.exec_driver_sql("DROP TRIGGER IF EXISTS events_no_update_or_delete ON events;")
        await conn.exec_driver_sql("""
            CREATE TRIGGER events_no_update_or_delete
            BEFORE UPDATE OR DELETE ON events
            FOR EACH ROW EXECUTE FUNCTION events_are_append_only();
        """)
    yield engine
    await engine.dispose()


@pytest.fixture
async def clean_db(engine):
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
