"""Reading and refreshing the stored Google token, with revocation handling."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from doer import events
from doer.crypto import decrypt, encrypt
from doer.daytime import utcnow
from doer.models import OAuthToken, User
from doer.services import google_oauth


class CalendarUnavailable(RuntimeError):
    """The stored grant can no longer produce an access token, or the API refused.

    `http_status` is set when the failure came from an HTTP response, so the
    tracking plan's calendar_query_failed event can record it.
    """

    http_status: int | None = None


async def get_token(session: AsyncSession, user: User) -> OAuthToken | None:
    result = await session.execute(select(OAuthToken).where(OAuthToken.user_id == user.id))
    return result.scalar_one_or_none()


async def access_token_for(session: AsyncSession, user: User) -> str:
    """Return a usable access token, refreshing if needed.

    A terminal refresh failure marks the grant revoked and raises. Callers degrade
    (capacity falls back to raw focus-block minutes) rather than failing the request:
    plan §8 requires the app stay fully usable with the calendar disconnected.
    """
    token = await get_token(session, user)
    if token is None or token.status != "active":
        raise CalendarUnavailable("no active calendar grant")

    if (
        token.access_token_encrypted
        and token.access_token_expires_at
        and token.access_token_expires_at > utcnow()
    ):
        return decrypt(token.access_token_encrypted)

    try:
        bundle = await google_oauth.refresh_access_token(decrypt(token.refresh_token_encrypted))
    except google_oauth.OAuthError as exc:
        token.status = "revoked"
        token.revoked_at = utcnow()
        token.revoked_reason = exc.error_code or "refresh_failed"
        events.record(
            session,
            user_id=user.id,
            name="calendar_revoked",
            properties={
                "detected_at": utcnow(),
                "reason": token.revoked_reason,
            },
        )
        raise CalendarUnavailable(str(exc)) from exc

    token.access_token_encrypted = encrypt(bundle.access_token)
    token.access_token_expires_at = bundle.expires_at
    return bundle.access_token
