"""Google OAuth 2.0 authorization code flow, handled directly.

ADR 0001 rejected brokering this through Supabase: the plan needs one consent flow
that yields a durable refresh token for `calendar.freebusy`, and a broker makes
holding on to that token harder, not easier.

Two details that are easy to get wrong and expensive to debug later:

- `access_type=offline` is required or no refresh token is ever issued.
- A refresh token is returned only on the FIRST consent. A later sign-in by an
  already-consented account returns an access token alone. That is survivable, not
  an error: the stored refresh token is still good. So `exchange_code` takes
  `allow_missing_refresh` and lets the caller decide, rather than raising and
  sending the user back through a second `prompt=consent` authorization, which is
  a second account picker. See
  docs/fixes/fix_plan_repeat-signin-shows-account-picker-twice.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from urllib.parse import urlencode

import httpx

from doer.config import get_settings
from doer.daytime import utcnow

AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo"


class OAuthError(RuntimeError):
    """Raised when Google rejects an exchange or refresh."""

    def __init__(self, message: str, *, error_code: str | None = None) -> None:
        super().__init__(message)
        self.error_code = error_code


@dataclass
class TokenBundle:
    access_token: str
    refresh_token: str | None
    expires_in: int
    scope: str

    @property
    def expires_at(self):
        return utcnow() + timedelta(seconds=self.expires_in)


def authorize_url(
    state: str,
    *,
    force_consent: bool = False,
    login_hint: str | None = None,
) -> str:
    settings = get_settings()
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": settings.google_scopes,
        "access_type": "offline",
        "include_granted_scopes": "true",
        "state": state,
    }
    if force_consent:
        params["prompt"] = "consent"
    if login_hint:
        # Only ever set on the re-consent leg, where the callback has just read the
        # address from userinfo. The first leg runs with no session and so has no
        # identity to hint with.
        params["login_hint"] = login_hint
    return f"{AUTH_ENDPOINT}?{urlencode(params)}"


async def exchange_code(code: str, *, allow_missing_refresh: bool = False) -> TokenBundle:
    settings = get_settings()
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            TOKEN_ENDPOINT,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
    return _parse_token_response(response, allow_missing_refresh=allow_missing_refresh)


async def refresh_access_token(refresh_token: str) -> TokenBundle:
    settings = get_settings()
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            TOKEN_ENDPOINT,
            data={
                "refresh_token": refresh_token,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "grant_type": "refresh_token",
            },
        )
    return _parse_token_response(response, allow_missing_refresh=True)


def _parse_token_response(response: httpx.Response, *, allow_missing_refresh: bool = False):
    if response.status_code != 200:
        payload = _safe_json(response)
        code = payload.get("error")
        raise OAuthError(f"token endpoint returned {response.status_code}: {code}", error_code=code)
    data = response.json()
    refresh = data.get("refresh_token")
    if refresh is None and not allow_missing_refresh:
        raise OAuthError(
            "no refresh token returned; the account has consented before, so the "
            "authorization URL needs prompt=consent",
            error_code="missing_refresh_token",
        )
    return TokenBundle(
        access_token=data["access_token"],
        refresh_token=refresh,
        expires_in=int(data.get("expires_in", 3600)),
        scope=data.get("scope", ""),
    )


async def fetch_userinfo(access_token: str) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            USERINFO_ENDPOINT, headers={"Authorization": f"Bearer {access_token}"}
        )
    if response.status_code != 200:
        raise OAuthError(f"userinfo returned {response.status_code}")
    return response.json()


def _safe_json(response: httpx.Response) -> dict:
    try:
        return response.json()
    except Exception:
        return {}
