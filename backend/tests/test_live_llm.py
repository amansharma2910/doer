"""Live model checks. Excluded from the default run.

    pytest -m live

These assert loose properties rather than exact values: the point is to catch
prompt drift and API changes, not to pin a model's judgement. They cost real money
and need ANTHROPIC_API_KEY set.
"""

import os

import pytest

from doer.config import get_settings
from doer.models.task import BUCKET_MINUTES, MAX_ESTIMATE_MINUTES, MIN_ESTIMATE_MINUTES
from doer.services import assistant, estimation

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(not os.getenv("ANTHROPIC_API_KEY"), reason="ANTHROPIC_API_KEY not set"),
]


class TestEstimationIsSane:
    async def test_a_short_errand_estimates_small(self):
        minutes, _, _ = await estimation._call_model("call the bank", None, "personal")
        assert MIN_ESTIMATE_MINUTES <= minutes <= 90

    async def test_a_substantial_task_estimates_larger(self):
        minutes, _, _ = await estimation._call_model(
            "write the quarterly investor update from scratch", None, "deep_work"
        )
        assert minutes >= 45

    async def test_the_result_is_always_within_the_clamp_range(self):
        minutes, _, _ = await estimation._call_model(
            "reorganize the entire garage", None, "personal"
        )
        assert MIN_ESTIMATE_MINUTES <= minutes <= MAX_ESTIMATE_MINUTES

    async def test_the_model_returns_bucket_values(self):
        """T-EST-11."""
        # Not load-bearing, since we snap anyway, but drift here means the
        # prompt has stopped landing.
        minutes, _, _ = await estimation._call_model("review two pull requests", None, "deep_work")
        assert minutes % BUCKET_MINUTES == 0

    def test_the_configured_model_is_haiku(self):
        assert get_settings().estimation_model == "claude-haiku-4-5"


class TestChatParsing:
    async def test_three_statements_become_three_tasks(self):
        response = await assistant.llm.client().messages.parse(
            model=get_settings().chat_model,
            max_tokens=2048,
            system=assistant.SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": (
                        "Today I want to finish the investor update, review two pull "
                        "requests, and call the bank."
                    ),
                }
            ],
            output_format=assistant.Proposal,
        )
        assert len(response.parsed_output.tasks) == 3

    async def test_a_non_task_message_produces_no_tasks(self):
        """A spurious task from "how am I doing" is a failure, not a quirk."""
        response = await assistant.llm.client().messages.parse(
            model=get_settings().chat_model,
            max_tokens=2048,
            system=assistant.SYSTEM_PROMPT,
            messages=[{"role": "user", "content": "how am I doing this week?"}],
            output_format=assistant.Proposal,
        )
        assert response.parsed_output.tasks == []
