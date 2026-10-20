"""Request dependencies: session cookie to authenticated user."""

from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from doer.config import get_settings
from doer.daytime import utcnow
from doer.db import get_session
from doer.models import AuthSession, User

COOKIE_NAME = "doer_session"


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def create_session(session: AsyncSession, user: User, response: Response) -> str:
    settings = get_settings()
    raw = secrets.token_urlsafe(32)
    session.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_token(raw),
            expires_at=utcnow() + timedelta(days=settings.session_ttl_days),
        )
    )
    response.set_cookie(
        COOKIE_NAME,
        raw,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=settings.session_ttl_days * 86400,
        path="/",
    )
    return raw


async def destroy_session(session: AsyncSession, request: Request, response: Response) -> None:
    raw = request.cookies.get(COOKIE_NAME)
    if raw:
        await session.execute(delete(AuthSession).where(AuthSession.token_hash == hash_token(raw)))
    response.delete_cookie(COOKIE_NAME, path="/")


async def current_user(request: Request, session: AsyncSession = Depends(get_session)) -> User:
    raw = request.cookies.get(COOKIE_NAME)
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not signed in")

    result = await session.execute(
        select(User)
        .join(AuthSession, AuthSession.user_id == User.id)
        .where(AuthSession.token_hash == hash_token(raw), AuthSession.expires_at > utcnow())
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session expired")
    return user
