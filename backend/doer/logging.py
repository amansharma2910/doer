"""Structured logging.

Deliberately small. The reason it exists at all is that several paths swallow
exceptions on purpose (a calendar failure must not fail the dashboard, a sweeper
error must not kill the loop), and a swallowed exception with no log is an
operational dead end.
"""

from __future__ import annotations

import logging

import structlog


def configure(level: int = logging.INFO) -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.StackInfoRenderer(),
            structlog.dev.ConsoleRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str):
    return structlog.get_logger(name)
