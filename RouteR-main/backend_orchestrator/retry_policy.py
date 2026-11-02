"""
Antigravity AI — Retry Policy Registry
Exponential backoff with jitter for external HTTP calls.
"""

import asyncio
import random
from typing import Callable, Any


RETRY_POLICIES = {
    "ocm_api": {
        "max_attempts": 3,
        "base_delay_s": 1.0,
        "max_delay_s": 8.0,
        "backoff": "exponential_jitter",
        "retry_on": [ConnectionError, TimeoutError],
        "no_retry_on": [ValueError],
    },
    "google_elevation": {
        "max_attempts": 2,
        "base_delay_s": 2.0,
        "max_delay_s": 10.0,
        "backoff": "linear",
        "retry_on": [ConnectionError, TimeoutError],
        "no_retry_on": [],
    },
    "default": {
        "max_attempts": 2,
        "base_delay_s": 0.5,
        "max_delay_s": 4.0,
        "backoff": "exponential_jitter",
        "retry_on": [Exception],
        "no_retry_on": [],
    },
}


async def with_retry(fn: Callable, *args, policy_name: str = "default", **kwargs) -> Any:
    """Execute fn with retry logic per named policy."""
    policy = RETRY_POLICIES.get(policy_name, RETRY_POLICIES["default"])
    attempt = 0

    while attempt < policy["max_attempts"]:
        try:
            if asyncio.iscoroutinefunction(fn):
                return await fn(*args, **kwargs)
            return fn(*args, **kwargs)
        except tuple(policy.get("no_retry_on", [])):
            raise
        except tuple(policy["retry_on"]) as e:
            attempt += 1
            if attempt >= policy["max_attempts"]:
                raise

            if policy["backoff"] == "exponential_jitter":
                delay = min(policy["base_delay_s"] * (2 ** (attempt - 1)), policy["max_delay_s"])
                delay = random.uniform(0, delay)
            else:
                delay = policy["base_delay_s"] * attempt

            print(f"[Retry] Attempt {attempt}/{policy['max_attempts']} for {fn.__name__}. Waiting {delay:.1f}s...")
            await asyncio.sleep(delay)
