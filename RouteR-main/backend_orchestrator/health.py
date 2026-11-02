"""
Antigravity AI — Health & Observability
System health aggregation for /api/health endpoint.
"""

import os
import time
from orchestrator.circuit_breaker import BREAKERS
from orchestrator.bulkheads import BULKHEADS
from orchestrator.cache_manager import _L1
from orchestrator.metrics import get_metrics_summary


def get_full_health(APP_STATE: dict) -> dict:
    """
    Returns full system health — exposed via GET /api/health.
    Aggregates: graph status, circuit breakers, cache stats, bulkheads, metrics.
    """
    G = APP_STATE.get("graph")

    # Graph health
    graph_health = {"status": "not_loaded"}
    if G:
        total_edges = G.number_of_edges()
        enriched = sum(1 for _, _, d in G.edges(data=True) if "energy_kwh" in d)
        graph_health = {
            "status": "ready" if enriched == total_edges else "partial",
            "nodes": G.number_of_nodes(),
            "edges": total_edges,
            "enriched_edges": enriched,
            "coverage_pct": round(enriched / total_edges * 100, 1) if total_edges else 0,
        }

    return {
        "timestamp": time.time(),
        "status": "ready" if graph_health.get("status") == "ready" else "degraded",
        "graph": graph_health,
        "circuit_breakers": {name: cb.status_dict() for name, cb in BREAKERS.items()},
        "bulkheads": {name: bh.status() for name, bh in BULKHEADS.items()},
        "cache": {
            "l1_memory_keys": len(_L1._store),
            "l2_disk_files": len(os.listdir("cache/")) if os.path.exists("cache/") else 0,
        },
        "metrics": get_metrics_summary(),
    }
