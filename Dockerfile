# Two targets, one context (the repo root).
#
# `dev` is what compose runs day to day. `runtime` is the single container in which
# FastAPI serves the built SPA. ADR 0001 requires that second target be kept working
# from M1 onward, not built at the end: the whole deferred-deploy bet rests on it
# not rotting, so it is built as part of every milestone check.

FROM python:3.13-slim AS base
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY --from=ghcr.io/astral-sh/uv:0.9.5 /uv /usr/local/bin/uv
WORKDIR /app

FROM base AS dev
COPY backend/pyproject.toml ./
RUN uv pip install --system --no-cache -r pyproject.toml --group dev
COPY backend/ .
CMD ["uvicorn", "doer.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

FROM node:23-slim AS web-build
WORKDIR /web
# Installed directly rather than through corepack: the corepack shim in this image
# downloads pnpm and then fails to resolve it, and pinning the version here keeps
# the container and the developer machine on the same pnpm.
RUN npm install -g pnpm@10.33.2
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM base AS runtime
COPY backend/pyproject.toml ./
RUN uv pip install --system --no-cache -r pyproject.toml
COPY backend/ .
COPY --from=web-build /web/dist ./static
ENV SERVE_STATIC=1
CMD ["uvicorn", "doer.main:app", "--host", "0.0.0.0", "--port", "8000"]
