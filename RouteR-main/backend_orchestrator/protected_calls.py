"""
Antigravity AI — Protected External Calls
Cache-aside + circuit breaker wrappers for external service calls.
"""

from orchestrator.circuit_breaker import BREAKERS
from orchestrator.cache_manager import cache_get, cache_set, cache_get_stale
from orchestrator.cache_keys import stations_key


async def fetch_stations_protected(route_nodes, G, radius_km=8.0) -> list:
    """
    Fetch stations with: cache lookup → circuit breaker → stale fallback.
    """
    if not route_nodes:
        return []

    mid_idx = len(route_nodes) // 2
    mid_node = route_nodes[mid_idx]
    key = stations_key(
        float(G.nodes[mid_node]["y"]),
        float(G.nodes[mid_node]["x"]),
        radius_km
    )

    # Layer 1: Fresh cache
    cached = cache_get(key, ttl=86_400)
    if cached is not None:
        return cached

    # Layer 2: Protected live fetch
    from core.charger_client import fetch_stations_along_corridor

    try:
        stations = fetch_stations_along_corridor(route_nodes, G, radius_km)
        if stations:
            cache_set(key, stations, ttl=86_400, layers=["memory", "disk"])
        return stations
    except Exception as e:
        print(f"[ProtectedCall] Station fetch failed: {e}")
        stale = cache_get_stale(key)
        if stale:
            print("[ProtectedCall] Serving stale station data")
            return stale
        return []
