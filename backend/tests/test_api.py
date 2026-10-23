"""HTTP-level tests.

The service-level suites prove the rules. These prove the rules survive the trip
through FastAPI: status codes, error body shapes, and authorization boundaries.
"""

import hashlib
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest
import respx
from sqlalchemy import select, update

from doer.api.auth import STATE_COOKIE
from doer.api.deps import COOKIE_NAME
from doer.config import get_settings
from doer.crypto import decrypt, encrypt
from doer.db import get_session
from doer.main import create_app
from doer.models import AuthSession, Event, OAuthToken, PreferenceBlock, User
from doer.services.google_oauth import TOKEN_ENDPOINT, USERINFO_ENDPOINT


async def _make_user(session, *, sub: str, email: str, tz: str = "UTC") -> tuple[User, str]:
    user = User(
        google_sub=sub,
        email=email,
        timezone=tz,
        day_start_time=time(0, 0),
        day_duration_minutes=24 * 60,
        capacity_ratio=0.5,
    )
    session.add(user)
    await session.flush()
    session.add_all(
        [
            PreferenceBlock(
                user_id=user.id, kind="deep_work", start_offset_minutes=60, end_offset_minutes=360
            )
        ]
    )
    token = f"token-{sub}"
    session.add(
        AuthSession(
            user_id=user.id,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            expires_at=datetime.now(UTC) + timedelta(days=1),
        )
    )
    await session.commit()
    return user, token


@pytest.fixture
async def client(session_factory):
    app = create_app()

    async def override():
        async with session_factory() as s:
            try:
                yield s
                await s.commit()
            except Exception:
                await s.rollback()
                raise

    app.dependency_overrides[get_session] = override
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def alice(session):
    return await _make_user(session, sub="alice", email="alice@example.com")


@pytest.fixture
async def bob(session):
    return await _make_user(session, sub="bob", email="bob@example.com")


def auth(token: str) -> dict:
    return {"Cookie": f"{COOKIE_NAME}={token}"}


class TestAuthentication:
    async def test_health_needs_no_session(self, client):
        response = await client.get("/health")
        assert response.status_code == 200

    async def test_a_request_without_a_cookie_is_rejected(self, client):
        """T-AUTH-05."""
        for path in ("/auth/me", "/tasks", "/days/current", "/settings/blocks"):
            response = await client.get(path)
            assert response.status_code == 401, path

    async def test_an_unknown_token_is_rejected(self, client):
        response = await client.get("/auth/me", headers=auth("not-a-real-token"))
        assert response.status_code == 401

    async def test_an_expired_session_is_rejected(self, client, session, alice):
        user, token = alice
        await session.execute(
            update(AuthSession)
            .where(AuthSession.user_id == user.id)
            .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        await session.commit()

        response = await client.get("/auth/me", headers=auth(token))
        assert response.status_code == 401

    async def test_a_valid_session_identifies_the_user(self, client, alice):
        _, token = alice
        response = await client.get("/auth/me", headers=auth(token))
        assert response.status_code == 200
        assert response.json()["email"] == "alice@example.com"


class TestGoogleSignIn:
    """The authorization-code callback, mocked at the Google HTTP boundary.

    The case that matters is the first one: Google issues a refresh token only on
    the first consent, and treating its absence as an error sent every returning
    user through a second authorization leg, which is a second account picker.
    See docs/fixes/fix_plan_repeat-signin-shows-account-picker-twice.md.
    """

    SCOPES = "openid email profile https://www.googleapis.com/auth/calendar.freebusy"

    @classmethod
    def mock_google(cls, *, refresh_token: str | None, sub: str, email: str) -> None:
        payload = {"access_token": "access-value", "expires_in": 3600, "scope": cls.SCOPES}
        if refresh_token is not None:
            payload["refresh_token"] = refresh_token
        respx.post(TOKEN_ENDPOINT).mock(return_value=httpx.Response(200, json=payload))
        respx.get(USERINFO_ENDPOINT).mock(
            return_value=httpx.Response(200, json={"sub": sub, "email": email, "name": "Returning"})
        )

    @staticmethod
    async def callback(client, state: str = "state-value"):
        return await client.get(
            "/auth/google/callback",
            params={"code": "auth-code", "state": state},
            headers={"Cookie": f"{STATE_COOKIE}={state}"},
        )

    @staticmethod
    def sets_session_cookie(response) -> bool:
        return any(h.startswith(f"{COOKIE_NAME}=") for h in response.headers.get_list("set-cookie"))

    @pytest.fixture
    async def returning(self, session):
        """A user who has consented before and then signed out.

        Signing out deletes the AuthSession row and nothing else, so the grant is
        exactly as the previous sign-in left it.
        """
        user = User(
            google_sub="returning-sub",
            email="returning@example.com",
            timezone="UTC",
            day_start_time=time(0, 0),
            day_duration_minutes=24 * 60,
            capacity_ratio=0.5,
        )
        session.add(user)
        await session.flush()
        session.add(
            OAuthToken(
                user_id=user.id,
                refresh_token_encrypted=encrypt("stored-refresh-value"),
                scopes=self.SCOPES,
                status="active",
            )
        )
        await session.commit()
        return user

    async def stored_token(self, session, user) -> OAuthToken:
        """Re-read from the database rather than from this session's identity map.

        The callback commits through a different session, so a plain query would
        hand back the copy loaded before the request. populate_existing refreshes
        it in place; expire_all would instead strand `user` mid-query.
        """
        return await session.scalar(
            select(OAuthToken)
            .where(OAuthToken.user_id == user.id)
            .execution_options(populate_existing=True)
        )

    @respx.mock
    async def test_a_repeat_signin_completes_in_one_leg(self, client, session, returning):
        """The regression test. Google returns no refresh token, which is normal for
        an already-consented account, and the stored one carries the sign-in."""
        before = (await self.stored_token(session, returning)).refresh_token_encrypted
        self.mock_google(refresh_token=None, sub="returning-sub", email="returning@example.com")

        response = await self.callback(client)

        assert response.status_code == 307
        assert response.headers["location"] == get_settings().frontend_origin, (
            "a second authorization leg here is the second account picker the user sees"
        )
        assert self.sets_session_cookie(response)
        assert (await self.stored_token(session, returning)).refresh_token_encrypted == before, (
            "the stored grant is reused, not rotated"
        )

    @respx.mock
    async def test_a_repeat_signin_does_not_claim_the_calendar_was_connected(
        self, client, session, returning
    ):
        self.mock_google(refresh_token=None, sub="returning-sub", email="returning@example.com")

        await self.callback(client)

        names = set((await session.scalars(select(Event.name))).all())
        assert "user_signed_in" in names
        assert "calendar_connected" not in names, "nothing was connected; the grant already existed"

    @respx.mock
    async def test_a_revoked_grant_still_asks_for_consent(self, client, session, returning):
        """The forced-consent redirect is the only route back from a revoked grant,
        so narrowing it must not close it."""
        await session.execute(
            update(OAuthToken).where(OAuthToken.user_id == returning.id).values(status="revoked")
        )
        await session.commit()
        self.mock_google(refresh_token=None, sub="returning-sub", email="returning@example.com")

        response = await self.callback(client)

        assert response.status_code == 307
        location = response.headers["location"]
        assert location.startswith("/auth/google/login?")
        assert "force_consent=true" in location
        assert "login_hint=returning%40example.com" in location, "skip the picker on the way back"

    @respx.mock
    async def test_a_placeholder_grant_still_asks_for_consent(self, client, session, returning):
        """The row is created with b"" before the conditional write, so its presence
        is not evidence of a usable grant."""
        await session.execute(
            update(OAuthToken)
            .where(OAuthToken.user_id == returning.id)
            .values(refresh_token_encrypted=b"")
        )
        await session.commit()
        self.mock_google(refresh_token=None, sub="returning-sub", email="returning@example.com")

        response = await self.callback(client)

        assert response.status_code == 307
        assert "force_consent=true" in response.headers["location"]

    @respx.mock
    async def test_a_first_signin_creates_the_user_and_the_grant(self, client, session):
        self.mock_google(
            refresh_token="fresh-refresh-value", sub="new-sub", email="new@example.com"
        )

        response = await self.callback(client)

        assert response.status_code == 307
        assert response.headers["location"] == get_settings().frontend_origin
        assert self.sets_session_cookie(response)

        user = await session.scalar(select(User).where(User.google_sub == "new-sub"))
        assert user is not None
        token = await self.stored_token(session, user)
        assert decrypt(token.refresh_token_encrypted) == "fresh-refresh-value"

        names = set((await session.scalars(select(Event.name))).all())
        assert {"user_signed_in", "calendar_connected"} <= names

    @respx.mock
    async def test_the_forced_leg_fails_rather_than_redirecting_again(self, client):
        """Without this, a prompt=consent leg that also returns no refresh token
        redirects to itself until the browser gives up."""
        self.mock_google(refresh_token=None, sub="new-sub", email="new@example.com")

        response = await self.callback(client, state="c:state-value")

        assert response.status_code == 502


class TestCrossUserIsolation:
    """AC-19 / T-AUTH-06. Authorization is enforced server-side, never by filtering
    in the client."""

    async def test_one_user_cannot_read_anothers_task(self, client, alice, bob):
        _, alice_token = alice
        _, bob_token = bob

        created = await client.post(
            "/tasks",
            headers=auth(alice_token),
            json={"title": "alice's private task", "is_primary": True},
        )
        assert created.status_code == 201
        task_id = created.json()["id"]

        response = await client.patch(
            f"/tasks/{task_id}", headers=auth(bob_token), json={"title": "hijacked"}
        )
        assert response.status_code == 404, "never confirm another user's task exists"

    async def test_one_user_cannot_complete_anothers_task(self, client, alice, bob):
        _, alice_token = alice
        _, bob_token = bob
        created = await client.post(
            "/tasks", headers=auth(alice_token), json={"title": "t", "is_primary": True}
        )
        task_id = created.json()["id"]

        response = await client.post(f"/tasks/{task_id}/complete", headers=auth(bob_token))
        assert response.status_code == 404

    async def test_one_user_cannot_delete_anothers_block(self, client, session, alice, bob):
        alice_user, _ = alice
        _, bob_token = bob
        block_id = await session.scalar(
            select(PreferenceBlock.id).where(PreferenceBlock.user_id == alice_user.id)
        )
        response = await client.delete(f"/settings/blocks/{block_id}", headers=auth(bob_token))
        assert response.status_code == 404

    async def test_each_user_sees_only_their_own_tasks(self, client, alice, bob):
        _, alice_token = alice
        _, bob_token = bob
        await client.post("/tasks", headers=auth(alice_token), json={"title": "alice task"})
        await client.post("/tasks", headers=auth(bob_token), json={"title": "bob task"})

        alice_titles = [
            t["title"] for t in (await client.get("/tasks", headers=auth(alice_token))).json()
        ]
        bob_titles = [
            t["title"] for t in (await client.get("/tasks", headers=auth(bob_token))).json()
        ]

        assert alice_titles == ["alice task"]
        assert bob_titles == ["bob task"]


class TestContractRefusalBodies:
    async def test_the_fifth_primary_returns_a_structured_remedy(self, client, alice):
        """The refusal body the interface reads.

        It carried a dict the client could not decode until the ApiError fix, so
        the user saw "[object Object]" instead of the offer to demote.
        """
        _, token = alice
        for i in range(4):
            response = await client.post(
                "/tasks", headers=auth(token), json={"title": f"p{i}", "is_primary": True}
            )
            assert response.status_code == 201

        response = await client.post(
            "/tasks", headers=auth(token), json={"title": "fifth", "is_primary": True}
        )
        assert response.status_code == 409
        detail = response.json()["detail"]
        assert detail["code"] == "primary_cap_reached"
        assert "demote" in detail["remedy"].lower()
        assert isinstance(detail["message"], str)

    async def test_deleting_a_completed_task_returns_the_immutability_code(self, client, alice):
        _, token = alice
        created = await client.post(
            "/tasks", headers=auth(token), json={"title": "t", "is_primary": True}
        )
        task_id = created.json()["id"]
        await client.post(f"/tasks/{task_id}/complete", headers=auth(token))

        response = await client.delete(f"/tasks/{task_id}", headers=auth(token))
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "completed_immutable"

    async def test_a_non_primary_task_above_four_is_accepted(self, client, alice):
        _, token = alice
        for i in range(6):
            response = await client.post(
                "/tasks", headers=auth(token), json={"title": f"n{i}", "is_primary": False}
            )
            assert response.status_code == 201


class TestTaskLifecycleOverHttp:
    async def test_start_then_complete_records_an_actual_duration(self, client, alice):
        """task_started is what makes actual_minutes measurable at all."""
        _, token = alice
        created = await client.post(
            "/tasks", headers=auth(token), json={"title": "t", "is_primary": True}
        )
        task_id = created.json()["id"]

        started = await client.post(f"/tasks/{task_id}/start", headers=auth(token))
        assert started.status_code == 200
        assert started.json()["started_at"] is not None

        done = await client.post(f"/tasks/{task_id}/complete", headers=auth(token))
        assert done.json()["actual_minutes"] is not None

    async def test_reversal_restores_the_pending_state(self, client, alice):
        _, token = alice
        created = await client.post(
            "/tasks", headers=auth(token), json={"title": "t", "is_primary": True}
        )
        task_id = created.json()["id"]
        await client.post(f"/tasks/{task_id}/complete", headers=auth(token))

        response = await client.delete(f"/tasks/{task_id}/complete", headers=auth(token))
        assert response.status_code == 200
        assert response.json()["is_complete"] is False

    async def test_editing_a_completed_task_is_refused(self, client, alice):
        _, token = alice
        created = await client.post(
            "/tasks", headers=auth(token), json={"title": "t", "is_primary": True}
        )
        task_id = created.json()["id"]
        await client.post(f"/tasks/{task_id}/complete", headers=auth(token))

        response = await client.patch(
            f"/tasks/{task_id}", headers=auth(token), json={"title": "changed"}
        )
        assert response.status_code == 409


class TestLogout:
    """The endpoint existed since M1 with no coverage and no way to reach it."""

    async def test_logout_ends_the_session(self, client, alice):
        _, token = alice
        assert (await client.get("/auth/me", headers=auth(token))).status_code == 200

        response = await client.post("/auth/logout", headers=auth(token))
        assert response.status_code == 200
        assert response.json() == {"ok": True}

        after = await client.get("/auth/me", headers=auth(token))
        assert after.status_code == 401, "the token must not survive its own session row"

    async def test_logout_removes_only_that_session(self, client, session, alice):
        """Signing out in one browser must not sign the user out everywhere."""
        user, token = alice
        other = "token-alice-second-browser"
        session.add(
            AuthSession(
                user_id=user.id,
                token_hash=hashlib.sha256(other.encode()).hexdigest(),
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        await session.commit()

        await client.post("/auth/logout", headers=auth(token))

        assert (await client.get("/auth/me", headers=auth(other))).status_code == 200

    async def test_logout_without_a_session_is_not_an_error(self, client):
        """The cookie can already be gone; the caller still wants to end up signed out."""
        assert (await client.post("/auth/logout")).status_code == 200


class TestSettingsOverHttp:
    async def test_a_first_block_clears_the_nudge_without_waiting_for_tomorrow(
        self, client, session
    ):
        """The default path for a new account: the dashboard opens the day before
        settings can be reached, so the day is snapshotted with no blocks."""
        user = User(
            google_sub="carol",
            email="carol@example.com",
            timezone="UTC",
            day_start_time=time(0, 0),
            day_duration_minutes=24 * 60,
            capacity_ratio=0.5,
        )
        session.add(user)
        await session.flush()
        token = "token-carol"
        session.add(
            AuthSession(
                user_id=user.id,
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        await session.commit()

        first = await client.get("/days/current", headers=auth(token))
        assert first.status_code == 200
        assert first.json()["is_indeterminate"] is True
        assert first.json()["indeterminate_reason"] == "no_focus_blocks"

        created = await client.post(
            "/settings/blocks",
            headers=auth(token),
            json={"kind": "deep_work", "start_offset_minutes": 60, "end_offset_minutes": 360},
        )
        assert created.status_code == 201

        second = await client.get("/days/current", headers=auth(token))
        assert second.status_code == 200
        body = second.json()
        assert body["is_indeterminate"] is False
        assert body["indeterminate_reason"] is None
        assert body["threshold_minutes"] == 150, "300 minutes of focus at a 50% ratio"


    async def test_overlapping_blocks_are_refused(self, client, alice):
        _, token = alice
        response = await client.post(
            "/settings/blocks",
            headers=auth(token),
            json={"kind": "personal", "start_offset_minutes": 120, "end_offset_minutes": 240},
        )
        assert response.status_code == 409

    async def test_a_block_past_the_end_of_the_day_is_refused(self, client, alice):
        _, token = alice
        shrink = await client.patch(
            "/settings/day-shape", headers=auth(token), json={"day_duration_minutes": 600}
        )
        assert shrink.status_code == 200, "the existing 60-360 block still fits in 600"

        response = await client.post(
            "/settings/blocks",
            headers=auth(token),
            json={"kind": "personal", "start_offset_minutes": 540, "end_offset_minutes": 660},
        )
        assert response.status_code == 422
        assert "day is only" in response.json()["detail"]

    async def test_shrinking_the_day_below_an_existing_block_is_refused(self, client, alice):
        """Otherwise a block would silently fall outside the day it belongs to."""
        _, token = alice
        response = await client.patch(
            "/settings/day-shape", headers=auth(token), json={"day_duration_minutes": 120}
        )
        assert response.status_code == 409


class TestHeatmapOverHttp:
    async def test_the_grid_carries_whole_weeks_and_a_cell_for_today(self, client, alice):
        _, token = alice
        await client.post("/tasks", headers=auth(token), json={"title": "t", "is_primary": True})

        response = await client.get("/days/heatmap?weeks=26", headers=auth(token))
        assert response.status_code == 200
        body = response.json()

        assert len(body["days"]) == 26 * 7
        assert body["days"] == sorted(body["days"])
        today = datetime.now(UTC).date().isoformat()
        assert today in body["days"]
        assert any(cell["anchor_date"] == today for cell in body["cells"])

    async def test_the_grid_is_built_in_the_users_timezone(self, client, session):
        """The defect this endpoint shape replaced: dates derived from a UTC
        instant put the whole grid a day out for any offset ahead of UTC.

        The rule itself is pinned deterministically in tests/test_daytime.py; this
        asserts the endpoint actually applies it to the configured timezone."""
        _, token = await _make_user(
            session, sub="kiritimati", email="kiri@example.com", tz="Pacific/Kiritimati"
        )

        body = (await client.get("/days/heatmap?weeks=4", headers=auth(token))).json()

        local_today = datetime.now(ZoneInfo("Pacific/Kiritimati")).date().isoformat()
        assert local_today in body["days"], "the grid must end on the user's own week"

    async def test_the_weeks_parameter_is_bounded(self, client, alice):
        _, token = alice
        assert (await client.get("/days/heatmap?weeks=0", headers=auth(token))).status_code == 422
        assert (await client.get("/days/heatmap?weeks=99", headers=auth(token))).status_code == 422

    async def test_the_heatmap_is_user_scoped(self, client, alice, bob):
        _, alice_token = alice
        _, bob_token = bob
        await client.post("/tasks", headers=auth(alice_token), json={"title": "t"})

        bob_body = (await client.get("/days/heatmap?weeks=4", headers=auth(bob_token))).json()
        assert all(cell["completed_total"] == 0 for cell in bob_body["cells"])


class TestEstimationBudgetOverHttp:
    """AC-07 / T-EST-01 and T-EST-02.

    The contract is that creation returns immediately with a pending estimate and
    the estimate lands separately. Background estimation is disabled in tests, so
    these assert the handoff rather than the model round trip; T-EST-11 in the live
    suite covers the model itself.
    """

    async def test_creation_returns_immediately_with_a_pending_estimate(
        self, client, alice
    ):
        """T-EST-01."""
        _, token = alice
        response = await client.post(
            "/tasks", headers=auth(token), json={"title": "t", "is_primary": True}
        )
        assert response.status_code == 201
        body = response.json()
        assert body["estimation_status"] == "pending"
        assert body["estimate_minutes"] is None

    async def test_creation_is_well_under_the_latency_budget(self, client, alice):
        """T-EST-02. The 5 second budget belongs to the estimate, not the request;
        the request itself must not wait for it."""
        import time

        _, token = alice
        started = time.monotonic()
        response = await client.post(
            "/tasks", headers=auth(token), json={"title": "t", "is_primary": True}
        )
        elapsed = time.monotonic() - started

        assert response.status_code == 201
        assert elapsed < 1.0, "task creation must not block on estimation"

    async def test_an_unestimated_primary_leaves_the_day_indeterminate(
        self, client, alice
    ):
        """AC-17 over HTTP: unknown capacity must not read as headroom."""
        _, token = alice
        await client.post("/tasks", headers=auth(token), json={"title": "t", "is_primary": True})

        day = (await client.get("/days/current", headers=auth(token))).json()
        assert day["is_indeterminate"] is True
        assert day["indeterminate_reason"] == "unestimated_primaries"
        assert day["is_at_risk"] is False


class TestHeatmapData:
    """The data half of the heatmap contract. The colour rules are frontend and
    are covered by the Vitest suite."""

    async def test_view_one_counts_primary_and_non_primary_together(
        self, client, alice
    ):
        """T-HEAT-01. The two views use different denominators on purpose."""
        _, token = alice
        ids = []
        for i in range(2):
            r = await client.post(
                "/tasks", headers=auth(token), json={"title": f"p{i}", "is_primary": True}
            )
            ids.append(r.json()["id"])
        for i in range(3):
            r = await client.post(
                "/tasks", headers=auth(token), json={"title": f"n{i}", "is_primary": False}
            )
            ids.append(r.json()["id"])
        for task_id in ids:
            await client.post(f"/tasks/{task_id}/complete", headers=auth(token))

        body = (await client.get("/days/heatmap?weeks=1", headers=auth(token))).json()
        cell = next(c for c in body["cells"] if c["completed_total"] > 0)
        assert cell["completed_total"] == 5, "counts everything finished"
        assert cell["completed_primary"] == 2, "view 2's denominator is primaries only"

    async def test_cells_are_keyed_by_anchor_date(self, client, session, alice):
        """T-HEAT-05. A completion paints the day that was running, not the
        calendar date it happened on."""
        from doer.services import day_service

        user, token = alice
        await client.post("/tasks", headers=auth(token), json={"title": "t"})

        day = await day_service.current_day(session, user)
        body = (await client.get("/days/heatmap?weeks=1", headers=auth(token))).json()
        assert any(c["anchor_date"] == day.anchor_date.isoformat() for c in body["cells"])


class TestStoredTimestamps:
    async def test_every_stored_instant_is_timezone_aware_utc(self, client, session, alice):
        """T-DAY-11. A naive timestamp anywhere would silently re-anchor a day."""
        from datetime import timezone

        from doer.models import LogicalDay, Task
        from doer.services import day_service

        user, token = alice
        await client.post("/tasks", headers=auth(token), json={"title": "t", "is_primary": True})
        day = await day_service.current_day(session, user)

        task = await session.scalar(select(Task).where(Task.user_id == user.id))
        stored = await session.scalar(select(LogicalDay).where(LogicalDay.id == day.id))

        for value in (stored.start_at, stored.end_at, stored.created_at, task.created_at):
            assert value.tzinfo is not None
            assert value.utcoffset() == timezone.utc.utcoffset(None)

    async def test_days_are_queried_by_anchor_date_not_by_timestamp(
        self, client, session, alice
    ):
        """The anchor date is the key, so a lookup by it must find the day even
        though the day's instants span two calendar dates."""
        from doer.services import day_service

        user, token = alice
        await client.get("/days/current", headers=auth(token))
        day = await day_service.current_day(session, user)

        response = await client.get(f"/days/{day.anchor_date.isoformat()}", headers=auth(token))
        assert response.status_code == 200
        assert response.json()["anchor_date"] == day.anchor_date.isoformat()
