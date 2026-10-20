"""Anthropic client.

Model assignment follows the tracking plan: Haiku 4.5 estimates, Opus 5 parses
chat. The split matters beyond cost. Haiku 4.5 predates the adaptive-thinking API,
so `output_config.effort` is rejected on it and thinking would need the older
`budget_tokens` form. Bucket estimation needs no reasoning at all, so the
`thinking` parameter is simply omitted, which also keeps output tokens close to
the size of the answer.
"""

from __future__ import annotations

from functools import lru_cache

from anthropic import AsyncAnthropic

from doer.config import get_settings


@lru_cache
def client() -> AsyncAnthropic:
    return AsyncAnthropic(api_key=get_settings().anthropic_api_key)


class LLMUnavailable(RuntimeError):
    """The model could not be reached or returned something unusable."""
