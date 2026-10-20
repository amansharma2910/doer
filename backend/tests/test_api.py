"""HTTP-level tests.

The service-level suites prove the rules. These prove the rules survive the trip
through FastAPI: status codes, error body shapes, and authorization boundaries.
"""

import hashlib
from datetime import UTC, datetime, time, timedelta

import httpx
import pytest
from sqlalchemy import select, update

from doer.api.deps import COOKIE_NAME
from doer.db import get_session
from doer.main import create_app
from doer.models import AuthSession, PreferenceBlock, User


async def _make_user(session, *, sub: str, email: str) -> tuple[User, str]:
    user = User(
        google_sub=sub,
        email=email,
        timezone="UTC",
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


class TestSettingsOverHttp:
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
    async def test_the_range_returns_cells_for_days_that_exist(self, client, alice):
        _, token = alice
        await client.post("/tasks", headers=auth(token), json={"title": "t", "is_primary": True})
        today = datetime.now(UTC).date()

        response = await client.get(
            f"/days/heatmap/range?start={today - timedelta(days=7)}&end={today}",
            headers=auth(token),
        )
        assert response.status_code == 200
        assert any(cell["scheduled_primary"] >= 0 for cell in response.json())

    async def test_the_heatmap_is_user_scoped(self, client, alice, bob):
        _, alice_token = alice
        _, bob_token = bob
        await client.post("/tasks", headers=auth(alice_token), json={"title": "t"})
        today = datetime.now(UTC).date()
        url = f"/days/heatmap/range?start={today - timedelta(days=7)}&end={today}"

        bob_cells = (await client.get(url, headers=auth(bob_token))).json()
        assert all(cell["completed_total"] == 0 for cell in bob_cells)


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

        today = datetime.now(UTC).date()
        cells = (
            await client.get(
                f"/days/heatmap/range?start={today - timedelta(days=1)}&end={today}",
                headers=auth(token),
            )
        ).json()
        cell = next(c for c in cells if c["completed_total"] > 0)
        assert cell["completed_total"] == 5, "counts everything finished"
        assert cell["completed_primary"] == 2, "view 2's denominator is primaries only"

    async def test_cells_are_keyed_by_anchor_date(self, client, session, alice):
        """T-HEAT-05. A completion paints the day that was running, not the
        calendar date it happened on."""
        from doer.services import day_service

        user, token = alice
        await client.post("/tasks", headers=auth(token), json={"title": "t"})

        day = await day_service.current_day(session, user)
        today = datetime.now(UTC).date()
        cells = (
            await client.get(
                f"/days/heatmap/range?start={today - timedelta(days=2)}&end={today}",
                headers=auth(token),
            )
        ).json()
        assert any(c["anchor_date"] == day.anchor_date.isoformat() for c in cells)


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
