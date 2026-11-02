"""
Antigravity AI — Event Bus
Lightweight in-process async event system for decoupled coordination.
"""

import asyncio
from collections import defaultdict
from typing import Callable


class EventBus:
    """
    In-process async event bus for prefetch triggers, metrics, cache invalidation.
    NOT a message queue — runs in the same process.
    """

    def __init__(self):
        self._handlers: dict[str, list[Callable]] = defaultdict(list)

    def on(self, event: str, handler: Callable = None):
        """Subscribe to an event. Can be used as decorator."""
        if handler:
            self._handlers[event].append(handler)
            return handler

        def decorator(fn):
            self._handlers[event].append(fn)
            return fn
        return decorator

    async def emit(self, event: str, data: dict = None):
        """Fire event to all subscribers (non-blocking)."""
        if data is None:
            data = {}
        for handler in self._handlers.get(event, []):
            asyncio.create_task(handler(data))


# Global bus instance
bus = EventBus()

# Event catalog
EVENTS = {
    "route.request.received": "Origin + destination known. Trigger early station fetch.",
    "route.computed": "Route node list available. Trigger SOC trace pre-compute.",
    "stations.fetched": "Station data available. Decision engine can proceed.",
    "route.response.sent": "Full response delivered. Emit metrics.",
    "graph.enrichment.complete": "All edges have energy_kwh. Server is ready.",
    "circuit.opened": "A circuit breaker tripped. Alert monitoring.",
    "cache.miss": "Cache miss on key. Track for prefetch optimization.",
}
