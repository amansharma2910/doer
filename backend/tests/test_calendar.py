"""Calendar availability and degraded modes.

Google is mocked at the HTTP boundary with respx, so these exercise the real
httpx path rather than a stubbed function.
"""

from datetime import UTC, date, datetime, timedelta

import httpx
import pytest
import respx
from sqlalchemy import select

from doer.crypto import encrypt
from doer.models import Event, OAuthToken
from doer.services import calendar, day_service, task_service
from doer.services.calendar import FREEBUSY_ENDPOINT

ANCHOR = date(2026, 3, 10)
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"


@pytest.fixture
async def day(session, user_with_focus):
    d = await day_service.open_day(session, user_with_focus, ANCHOR)
    await session.commit()
    return d


@pytest.fixture
async def connected(session, user_with_focus):
    """A user with a live grant whose access token is still valid."""
    session.add(
        OAuthToken(
            user_id=user_with_focus.id,
            refresh_token_encrypted=encrypt("refresh-value"),
            access_token_encrypted=encrypt("access-value"),
            access_token_expires_at=datetime.now(UTC) + timedelta(hours=1),
            scopes="https://www.googleapis.com/auth/calendar.freebusy",
            status="active",
        )
    )
    await session.commit()
    return user_with_focus


def busy_payload(*slots):
    return {
        "calendars": {
            "primary": {"busy": [{"start": s.isoformat(), "end": e.isoformat()} for s, e in slots]}
        }
    }


def at(hour, minute=0, day_offset=0):
    from zoneinfo import ZoneInfo

    base = datetime(2026, 3, 10, hour, minute, tzinfo=ZoneInfo("Asia/Kolkata"))
    return (base + timedelta(days=day_offset)).astimezone(UTC)


class TestFreebusy:
    @respx.mock
    async def test_busy_time_inside_a_focus_block_reduces_capacity(self, session, connected, day):
        """T-CAL-03 / AC-06, through the real HTTP path."""
        respx.post(FREEBUSY_ENDPOINT).mock(
            return_value=httpx.Response(200, json=busy_payload((at(16), at(17))))
        )
        await calendar.sync_day(session, connected, day)
        await session.commit()

        assert day.calendar_state == "connected"
        assert day.busy_minutes_subtracted == 60
        assert day.capacity_base_minutes == 240

    @respx.mock
    async def test_busy_time_outside_focus_blocks_changes_nothing(self, session, connected, day):
        respx.post(FREEBUSY_ENDPOINT).mock(
            return_value=httpx.Response(200, json=busy_payload((at(19), at(20))))
        )
        await calendar.sync_day(session, connected, day)
        await session.commit()
        assert day.busy_minutes_subtracted == 0
        assert day.capacity_base_minutes == 300

    @respx.mock
    async def test_an_event_starting_before_the_day_is_clipped(self, session, connected, day):
        """T-CAL-06. Only the part inside the window counts."""
        respx.post(FREEBUSY_ENDPOINT).mock(
            return_value=httpx.Response(
                200,
                json=busy_payload((at(10), at(16))),  # 10:00 is before the 14:00 start
            )
        )
        await calendar.sync_day(session, connected, day)
        await session.commit()
        # Only 15:00-16:00 overlaps the deep work block.
        assert day.busy_minutes_subtracted == 60

    @respx.mock
    async def test_overlapping_busy_blocks_are_merged(self, session, connected, day):
        respx.post(FREEBUSY_ENDPOINT).mock(
            return_value=httpx.Response(
                200, json=busy_payload((at(16), at(17)), (at(16, 30), at(17, 30)))
            )
        )
        await calendar.sync_day(session, connected, day)
        await session.commit()
        assert day.busy_minutes_subtracted == 90

    @respx.mock
    async def test_only_start_and_end_are_persisted(self, session, connected, day):
        """T-CAL-01 and T-CAL-02 / AC-18.

        freebusy never returns titles, so there is nothing to discard. This asserts
        we did not invent a place to put them anyway.
        """
        respx.post(FREEBUSY_ENDPOINT).mock(
            return_value=httpx.Response(
                200,
                json={
                    "calendars": {
                        "primary": {
                            "busy": [
                                {
                                    "start": at(16).isoformat(),
                                    "end": at(17).isoformat(),
                                    "summary": "Board meeting about the layoffs",
                                }
                            ]
                        }
                    }
                },
            )
        )
        await calendar.sync_day(session, connected, day)
        await session.commit()

        assert "layoffs" not in str(day.busy_snapshot)
        assert len(day.busy_snapshot[0]) == 2, "an interval is a pair, with nowhere for a title"
        all_events = (await session.scalars(select(Event))).all()
        assert "layoffs" not in str([e.properties for e in all_events])

    @respx.mock
    async def test_the_request_only_ever_hits_freebusy(self, session, connected, day):
        """No code path may reach events.list, which would need a broader scope."""
        route = respx.post(FREEBUSY_ENDPOINT).mock(
            return_value=httpx.Response(200, json=busy_payload())
        )
        await calendar.sync_day(session, connected, day)
        assert route.called
        for call in respx.calls:
            assert "freeBusy" in str(call.request.url)
            assert "events" not in str(call.request.url)

    @respx.mock
    async def test_the_query_window_matches_the_logical_day(self, session, connected, day):
        import json

        route = respx.post(FREEBUSY_ENDPOINT).mock(
            return_value=httpx.Response(200, json=busy_payload())
        )
        await calendar.sync_day(session, connected, day)

        body = json.loads(route.calls[0].request.content)
        assert body["timeMin"] == day.start_at.isoformat()
        assert body["timeMax"] == day.end_at.isoformat()


class TestDegradedModes:
    async def test_no_grant_at_all_leaves_the_app_usable(self, session, user_with_focus, day):
        """T-CAP-10 / AC-15. Capacity falls back to raw focus-block minutes."""
        await calendar.sync_day(session, user_with_focus, day)
        await session.commit()

        assert day.calendar_state == "revoked"
        assert day.capacity_base_minutes == 300
        assert day.busy_minutes_subtracted == 0

    @respx.mock
    async def test_a_revoked_grant_is_recorded_and_degrades(self, session, connected, day):
        """T-AUTH-04. invalid_grant marks the grant revoked, it does not 500."""
        token = await session.scalar(select(OAuthToken))
        token.access_token_expires_at = datetime.now(UTC) - timedelta(hours=1)
        await session.commit()

        respx.post(TOKEN_ENDPOINT).mock(
            return_value=httpx.Response(400, json={"error": "invalid_grant"})
        )

        await calendar.sync_day(session, connected, day)
        await session.commit()

        await session.refresh(token)
        assert token.status == "revoked"
        assert token.revoked_reason == "invalid_grant"
        assert day.calendar_state == "revoked"
        assert day.capacity_base_minutes == 300, "still usable, just without busy time"

        recorded = await session.scalar(select(Event).where(Event.name == "calendar_revoked"))
        assert recorded is not None

    @respx.mock
    async def test_an_api_failure_reuses_the_last_snapshot_and_marks_it_stale(
        self, session, connected, day
    ):
        """T-CAL-04. Degrade to stale data, never to silence."""
        respx.post(FREEBUSY_ENDPOINT).mock(
            return_value=httpx.Response(200, json=busy_payload((at(16), at(17))))
        )
        await calendar.sync_day(session, connected, day)
        await session.commit()
        assert day.busy_minutes_subtracted == 60

        respx.post(FREEBUSY_ENDPOINT).mock(return_value=httpx.Response(429))
        await calendar.sync_day(session, connected, day, force=True)
        await session.commit()

        assert day.calendar_state == "stale"
        assert day.busy_minutes_subtracted == 60, "the last good snapshot still applies"

    @respx.mock
    async def test_a_sync_failure_is_logged(self, session, connected, day):
        """T-CAL-05. It never raises to the caller, so the event is the only trace."""
        respx.post(FREEBUSY_ENDPOINT).mock(return_value=httpx.Response(503))
        await calendar.sync_day(session, connected, day)
        await session.commit()

        failure = await session.scalar(select(Event).where(Event.name == "calendar_query_failed"))
        assert failure is not None
        assert failure.properties["fell_back_to"] == "none"


class TestTokenRefresh:
    @respx.mock
    async def test_an_expired_access_token_is_refreshed_and_persisted(
        self, session, connected, day
    ):
        """T-AUTH-03. The refresh happens silently; the user never reconnects."""
        token = await session.scalar(select(OAuthToken))
        token.access_token_expires_at = datetime.now(UTC) - timedelta(hours=1)
        await session.commit()
        stale_ciphertext = token.access_token_encrypted

        respx.post(TOKEN_ENDPOINT).mock(
            return_value=httpx.Response(
                200,
                json={"access_token": "fresh-access", "expires_in": 3600, "scope": "x"},
            )
        )
        respx.post(FREEBUSY_ENDPOINT).mock(
            return_value=httpx.Response(200, json=busy_payload((at(16), at(17))))
        )

        await calendar.sync_day(session, connected, day)
        await session.commit()
        await session.refresh(token)

        assert token.status == "active"
        assert token.access_token_encrypted != stale_ciphertext
        assert token.access_token_expires_at > datetime.now(UTC)
        assert day.calendar_state == "connected"

    @respx.mock
    async def test_a_refresh_response_without_a_refresh_token_is_accepted(
        self, session, connected, day
    ):
        """Google omits refresh_token on refresh. Treating that as a failure would
        revoke a perfectly good grant on its first token expiry."""
        token = await session.scalar(select(OAuthToken))
        original_refresh = token.refresh_token_encrypted
        token.access_token_expires_at = datetime.now(UTC) - timedelta(hours=1)
        await session.commit()

        respx.post(TOKEN_ENDPOINT).mock(
            return_value=httpx.Response(
                200, json={"access_token": "fresh", "expires_in": 3600}
            )
        )
        respx.post(FREEBUSY_ENDPOINT).mock(
            return_value=httpx.Response(200, json=busy_payload())
        )
        await calendar.sync_day(session, connected, day)
        await session.commit()
        await session.refresh(token)

        assert token.status == "active"
        assert token.refresh_token_encrypted == original_refresh


class TestStaleness:
    async def test_a_never_synced_day_reads_stale(self, session, user_with_focus, day):
        assert calendar.is_stale(day) is True

    @respx.mock
    async def test_a_just_synced_day_is_not_stale(self, session, connected, day):
        respx.post(FREEBUSY_ENDPOINT).mock(return_value=httpx.Response(200, json=busy_payload()))
        await calendar.sync_day(session, connected, day)
        assert calendar.is_stale(day) is False

    async def test_a_snapshot_older_than_the_day_start_is_stale(
        self, session, user_with_focus, day
    ):
        day.calendar_synced_at = day.start_at - timedelta(hours=2)
        assert calendar.is_stale(day) is True


class TestRiskWithCalendar:
    @respx.mock
    async def test_busy_time_can_push_a_day_into_at_risk(self, session, connected, day):
        """The capacity chain end to end: busy time shrinks the base, which lowers
        the threshold, which can flip a day that previously looked fine."""
        respx.post(FREEBUSY_ENDPOINT).mock(return_value=httpx.Response(200, json=busy_payload()))
        for i in range(2):
            t = await task_service.create_task(
                session, connected, day, title=f"t{i}", is_primary=True
            )
            await task_service.set_estimate(session, connected, t, day, minutes=80, source="model")
        await calendar.sync_day(session, connected, day)
        await session.commit()
        assert day.threshold_minutes == 150
        assert day.is_at_risk is True, "160 committed against a 150 threshold"

        respx.post(FREEBUSY_ENDPOINT).mock(
            return_value=httpx.Response(200, json=busy_payload((at(15), at(18))))
        )
        await calendar.sync_day(session, connected, day, force=True)
        await session.commit()
        assert day.capacity_base_minutes == 120
        assert day.threshold_minutes == 60
