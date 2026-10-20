"""Google sign-in routes."""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from doer import events
from doer.api.deps import create_session, current_user, destroy_session
from doer.config import get_settings
from doer.crypto import encrypt
from doer.db import get_session
from doer.models import OAuthToken, User
from doer.services import google_oauth

router = APIRouter(prefix="/auth", tags=["auth"])

STATE_COOKIE = "doer_oauth_state"


@router.get("/google/login")
async def login(response: Response, force_consent: bool = False) -> RedirectResponse:
    state = secrets.token_urlsafe(24)
    url = google_oauth.authorize_url(state, force_consent=force_consent)
    redirect = RedirectResponse(url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)
    redirect.set_cookie(STATE_COOKIE, state, httponly=True, samesite="lax", max_age=600, path="/")
    return redirect


@router.get("/google/callback")
async def callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    session: AsyncSession = Depends(get_session),
) -> RedirectResponse:
    settings = get_settings()

    if error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"google returned: {error}")
    if not code or not state or state != request.cookies.get(STATE_COOKIE):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid oauth state")

    try:
        bundle = await google_oauth.exchange_code(code)
    except google_oauth.OAuthError as exc:
        if exc.error_code == "missing_refresh_token":
            # Already consented, so Google withheld the refresh token. Re-ask with
            # prompt=consent rather than proceeding with an hour of access.
            return RedirectResponse(
                "/auth/google/login?force_consent=true",
                status_code=status.HTTP_307_TEMPORARY_REDIRECT,
            )
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    profile = await google_oauth.fetch_userinfo(bundle.access_token)
    google_sub = profile["sub"]

    result = await session.execute(select(User).where(User.google_sub == google_sub))
    user = result.scalar_one_or_none()
    is_first = user is None

    if user is None:
        user = User(
            google_sub=google_sub,
            email=profile.get("email", ""),
            name=profile.get("name"),
        )
        session.add(user)
        await session.flush()
    else:
        user.email = profile.get("email", user.email)
        user.name = profile.get("name", user.name)

    token_result = await session.execute(select(OAuthToken).where(OAuthToken.user_id == user.id))
    token = token_result.scalar_one_or_none()
    if token is None:
        token = OAuthToken(user_id=user.id, refresh_token_encrypted=b"")
        session.add(token)

    if bundle.refresh_token:
        token.refresh_token_encrypted = encrypt(bundle.refresh_token)
    token.access_token_encrypted = encrypt(bundle.access_token)
    token.access_token_expires_at = bundle.expires_at
    token.scopes = bundle.scope or settings.google_scopes
    token.status = "active"
    token.revoked_at = None
    token.revoked_reason = None

    events.record(
        session,
        user_id=user.id,
        name="user_signed_in",
        properties={"method": "google", "is_first_sign_in": is_first},
    )
    if bundle.refresh_token:
        events.record(
            session,
            user_id=user.id,
            name="calendar_connected",
            properties={"scope": token.scopes, "granted_at": bundle.expires_at},
        )

    redirect = RedirectResponse(
        settings.frontend_origin, status_code=status.HTTP_307_TEMPORARY_REDIRECT
    )
    await create_session(session, user, redirect)
    redirect.delete_cookie(STATE_COOKIE, path="/")
    return redirect


@router.post("/logout")
async def logout(
    request: Request, response: Response, session: AsyncSession = Depends(get_session)
) -> dict:
    await destroy_session(session, request, response)
    return {"ok": True}


@router.get("/me")
async def me(user: User = Depends(current_user)) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "timezone": user.timezone,
        "day_start_time": user.day_start_time.isoformat(),
        "day_duration_minutes": user.day_duration_minutes,
        "capacity_ratio": float(user.capacity_ratio),
    }
