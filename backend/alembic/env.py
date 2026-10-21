"""Alembic environment, async engine aware."""

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from doer.config import get_settings
from doer.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _refuse_downgrade() -> None:
    """Every migration here implements a real `downgrade()` that drops tables.

    Upgrade stays open: the container runs `alembic upgrade head` on every start
    and the README tells humans to do the same. Downgrade has no routine use and
    is a second route to the data loss recorded in
    docs/fixes/fix_plan_tests-wipe-production-database.md.
    """
    cmd = getattr(config.cmd_opts, "cmd", None)
    name = getattr(cmd[0], "__name__", "") if cmd else ""
    if name == "downgrade" and os.environ.get("DOER_ALLOW_DESTRUCTIVE_MIGRATION") != "1":
        raise RuntimeError(
            "refusing to downgrade: every migration in this project drops tables, and "
            "this would destroy data in the database DATABASE_URL names. Re-run with "
            "DOER_ALLOW_DESTRUCTIVE_MIGRATION=1 if that is genuinely what you want."
        )


_refuse_downgrade()


def _url() -> str:
    return get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(
        url=_url(), target_metadata=target_metadata, literal_binds=True, compare_type=True
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_run(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(_url(), poolclass=None)
    async with engine.connect() as connection:
        await connection.run_sync(_do_run)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
