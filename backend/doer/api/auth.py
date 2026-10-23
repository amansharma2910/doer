"""Google sign-in routes."""

from __future__ import annotations

import secrets
from urllib.parse import urlencode

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

# Prefixed onto the state of a forced-consent leg so the callback can tell which
# leg it is on. The state is echoed back by Google and compared against the
# httponly state cookie, so the marker cannot be forged without also matching a
# cookie the forger cannot read. A separate cookie would work too; this needs no
# extra round trip.
FORCED_CONSENT_STATE = "c:"


@router.get("/google/login")
async def login(
    response: Response, force_consent: bool = False, login_hint: str | None = None
) -> RedirectResponse:
    state = (FORCED_CONSENT_STATE if force_consent else "") + secrets.token_urlsafe(24)
    url = google_oauth.authorize_url(state, force_consent=force_consent, login_hint=login_hint)
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
        # A missing refresh token is normal on every sign-in after the first, so it
        # is not an error here. Whether it matters depends on the stored grant,
        # which is not known until userinfo identifies the account below.
        bundle = await google_oauth.exchange_code(code, allow_missing_refresh=True)
    except google_oauth.OAuthError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    profile = await google_oauth.fetch_userinfo(bundle.access_token)
    google_sub = profile["sub"]

    result = await session.execute(select(User).where(User.google_sub == google_sub))
    user = result.scalar_one_or_none()
    is_first = user is None

    token = None
    if user is not None:
        token_result = await session.execute(
            select(OAuthToken).where(OAuthToken.user_id == user.id)
        )
        token = token_result.scalar_one_or_none()

    # Read before anything below mutates it: the write block unconditionally sets
    # status to active, so checking afterwards would read the value it is about to
    # overwrite. The test mirrors token_store.access_token_for, the only other
    # consumer of these rows, including its refusal of the b"" placeholder.
    had_usable_grant = (
        token is not None and token.status == "active" and bool(token.refresh_token_encrypted)
    )

    if bundle.refresh_token is None and not had_usable_grant:
        # Nothing usable is stored, so consent genuinely has to be asked for again.
        # This is also the only route back for a grant the user revoked at Google.
        if state.startswith(FORCED_CONSENT_STATE):
            # Already asked with prompt=consent and still nothing. Redirecting again
            # would loop until the browser gives up.
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                "google returned no refresh token even with prompt=consent",
            )
        params = {"force_consent": "true"}
        if profile.get("email"):
            params["login_hint"] = profile["email"]
        return RedirectResponse(
            f"/auth/google/login?{urlencode(params)}",
            status_code=status.HTTP_307_TEMPORARY_REDIRECT,
        )

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
    if bundle.refresh_token and not had_usable_grant:
        # A repeat sign-in reusing an existing grant connects nothing. Firing here
        # unconditionally inflated this series once per sign-in.
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
