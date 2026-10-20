"""FastAPI application entrypoint."""

from __future__ import annotations

import asyncio
import contextlib
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from doer.api import assistant_routes, auth, days, settings_routes, tasks
from doer.config import get_settings
from doer.services import estimation


async def _sweeper() -> None:
    """Retry due estimates on a loop.

    Running locally there is always a process alive, so this is the simplest
    durable retry available: no Redis, no second deployed process. On a host that
    scales to zero this loop stops being reliable, which is why the same callable
    is also an HTTP endpoint a scheduler can drive (ADR 0001).
    """
    interval = get_settings().sweeper_interval_seconds
    while True:
        await asyncio.sleep(interval)
        with contextlib.suppress(Exception):
            await estimation.sweep()


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = None
    if get_settings().sweeper_enabled:
        task = asyncio.create_task(_sweeper())
    try:
        yield
    finally:
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Doer", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth.router)
    app.include_router(settings_routes.router)
    app.include_router(days.router)
    app.include_router(tasks.router)
    app.include_router(assistant_routes.router)

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok"}

    _mount_spa(app)
    return app


def _mount_spa(app: FastAPI) -> None:
    """Serve the built SPA from the same container as the API.

    Only active in the `runtime` image. ADR 0001 requires this path stay working
    from the first milestone rather than being added at deploy time, because the
    entire deferred-deployment bet is that moving to a host is configuration
    rather than a rewrite. In development the Vite dev server serves the frontend
    and this does nothing.
    """
    if os.getenv("SERVE_STATIC") != "1":
        return

    static_dir = Path(__file__).resolve().parent.parent / "static"
    if not static_dir.is_dir():
        return

    app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")
    index = static_dir / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str) -> FileResponse:
        # Client-side routing: any unmatched path returns the shell, and the
        # router decides. API routes are registered first, so they win.
        return FileResponse(index)


app = create_app()
