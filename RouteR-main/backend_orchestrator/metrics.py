"""
Antigravity AI — Metrics Recording
Service call duration, cache hit, and status tracking.
"""

import time
from typing import Optional

_metrics_log = []


def record_service_call(
    service: str,
    function: str,
    duration_ms: float,
    cache_hit: bool,
    status: str,
    error: Optional[str] = None,
):
    entry = {
        "ts": time.time(),
        "service": service,
        "function": function,
        "duration_ms": round(duration_ms, 2),
        "cache_hit": cache_hit,
        "status": status,
        "error": error,
    }
    _metrics_log.append(entry)

    status_icon = "✓" if status == "success" else ("⚡" if status == "fallback" else "✗")
    cache_icon = "[C]" if cache_hit else "[ ]"
    print(f"  {status_icon} {cache_icon} {service}.{function} → {duration_ms:.0f}ms")


def record_event(event_name: str, data: dict = None):
    _metrics_log.append({
        "ts": time.time(),
        "event": event_name,
        "data": data or {},
    })


def get_metrics_summary() -> dict:
    """Return metrics summary for health endpoint."""
    if not _metrics_log:
        return {"total_calls": 0}

    service_calls = [m for m in _metrics_log if "service" in m]
    return {
        "total_calls": len(service_calls),
        "cache_hit_rate": (
            sum(1 for m in service_calls if m.get("cache_hit")) / len(service_calls)
            if service_calls else 0
        ),
        "avg_duration_ms": (
            sum(m.get("duration_ms", 0) for m in service_calls) / len(service_calls)
            if service_calls else 0
        ),
    }
