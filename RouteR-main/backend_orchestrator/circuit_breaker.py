"""
Antigravity AI — Circuit Breaker Pattern
Per-service circuit breaker with Closed → Open → Half-Open states.
"""

import time
import asyncio
from enum import Enum
from dataclasses import dataclass
from typing import Callable, Any, Optional
from config import CB_OCM_FAIL_MAX, CB_OCM_RESET_TIMEOUT_S, CB_ELEVATION_FAIL_MAX, CB_ELEVATION_RESET_TIMEOUT_S


class CBState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


@dataclass
class CircuitBreakerConfig:
    name: str
    fail_max: int = 3
    reset_timeout: float = 60.0
    success_threshold: int = 2


class CircuitBreaker:
    """Per-service circuit breaker with async support."""

    def __init__(self, config: CircuitBreakerConfig):
        self.cfg = config
        self.state = CBState.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.last_failure = 0.0
        self._lock = asyncio.Lock()

    async def call(self, fn: Callable, *args, fallback: Callable = None, **kwargs) -> Any:
        async with self._lock:
            if self.state == CBState.OPEN:
                if time.time() - self.last_failure >= self.cfg.reset_timeout:
                    self.state = CBState.HALF_OPEN
                    print(f"[CB:{self.cfg.name}] → HALF_OPEN (probing)")
                else:
                    if fallback:
                        return await fallback(*args, **kwargs) if asyncio.iscoroutinefunction(fallback) else fallback(*args, **kwargs)
                    raise CircuitBreakerOpenError(
                        f"Circuit {self.cfg.name} is OPEN. "
                        f"Retry in {self.cfg.reset_timeout - (time.time() - self.last_failure):.0f}s"
                    )

        try:
            if asyncio.iscoroutinefunction(fn):
                result = await fn(*args, **kwargs)
            else:
                result = fn(*args, **kwargs)
            await self._on_success()
            return result
        except Exception as e:
            await self._on_failure(e)
            if fallback:
                return await fallback(*args, **kwargs) if asyncio.iscoroutinefunction(fallback) else fallback(*args, **kwargs)
            raise

    async def _on_success(self):
        async with self._lock:
            if self.state == CBState.HALF_OPEN:
                self.success_count += 1
                if self.success_count >= self.cfg.success_threshold:
                    self.state = CBState.CLOSED
                    self.failure_count = 0
                    self.success_count = 0
                    print(f"[CB:{self.cfg.name}] → CLOSED (recovered)")
            elif self.state == CBState.CLOSED:
                self.failure_count = 0

    async def _on_failure(self, exc: Exception):
        async with self._lock:
            self.failure_count += 1
            self.last_failure = time.time()
            print(f"[CB:{self.cfg.name}] Failure {self.failure_count}/{self.cfg.fail_max}: {exc}")
            if self.failure_count >= self.cfg.fail_max or self.state == CBState.HALF_OPEN:
                self.state = CBState.OPEN
                print(f"[CB:{self.cfg.name}] → OPEN (tripped)")

    @property
    def is_open(self) -> bool:
        return self.state == CBState.OPEN

    def status_dict(self) -> dict:
        return {
            "name": self.cfg.name,
            "state": self.state.value,
            "failures": self.failure_count,
            "last_failure": self.last_failure,
        }


class CircuitBreakerOpenError(Exception):
    pass


# ── Circuit breaker registry
BREAKERS = {
    "ocm_api": CircuitBreaker(CircuitBreakerConfig(
        name="ocm_api", fail_max=CB_OCM_FAIL_MAX, reset_timeout=CB_OCM_RESET_TIMEOUT_S
    )),
    "gpxz_elevation": CircuitBreaker(CircuitBreakerConfig(
        name="gpxz_elevation", fail_max=CB_ELEVATION_FAIL_MAX, reset_timeout=CB_ELEVATION_RESET_TIMEOUT_S
    )),
}
