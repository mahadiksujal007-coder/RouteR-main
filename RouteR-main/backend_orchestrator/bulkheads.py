"""
Antigravity AI — Bulkhead Isolation
Separate concurrency pools per service to prevent resource starvation.
"""

import asyncio
from typing import Callable, Any
from config import BULKHEAD_ROUTING_MAX, BULKHEAD_OCM_MAX, BULKHEAD_ELEVATION_MAX


class Bulkhead:
    """Limits concurrent executions of a service."""

    def __init__(self, name: str, max_concurrent: int):
        self.name = name
        self._sem = asyncio.Semaphore(max_concurrent)
        self._max = max_concurrent
        self._active = 0
        self._rejected = 0

    async def execute(self, fn: Callable, *args, **kwargs) -> Any:
        if self._sem._value == 0:
            self._rejected += 1
            raise BulkheadFullError(
                f"Bulkhead '{self.name}' at capacity ({self._max}). "
                f"Rejected: {self._rejected}"
            )

        async with self._sem:
            self._active += 1
            try:
                if asyncio.iscoroutinefunction(fn):
                    return await fn(*args, **kwargs)
                return fn(*args, **kwargs)
            finally:
                self._active -= 1

    def status(self) -> dict:
        return {
            "name": self.name,
            "active": self._active,
            "capacity": self._max,
            "rejected": self._rejected,
        }


class BulkheadFullError(Exception):
    pass


BULKHEADS = {
    "routing": Bulkhead("routing", max_concurrent=BULKHEAD_ROUTING_MAX),
    "ocm_api": Bulkhead("ocm_api", max_concurrent=BULKHEAD_OCM_MAX),
    "elevation_api": Bulkhead("elevation_api", max_concurrent=BULKHEAD_ELEVATION_MAX),
    "battery_compute": Bulkhead("battery_compute", max_concurrent=50),
}
