"""
Antigravity AI — Prefetch Pipeline
Startup + early fetch patterns for warming caches.
"""

import asyncio
from orchestrator.cache_manager import cache_set, cache_get
from orchestrator.cache_keys import stations_key


async def run_startup_prefetch(G, region: str, vehicle_class: str = "default_bev") -> dict:
    """
    Startup prefetch sequence. Called once before server accepts requests.
    Graph and energy enrichment are handled by server lifespan.
    This handles station data prefetch.
    """
    status = {"stations": {"status": "pending"}}

    # Background prefetch station data for region centroid
    asyncio.create_task(_prefetch_stations_background(G, region))
    status["stations"]["status"] = "prefetching (background)"

    return status


async def _prefetch_stations_background(G, region: str):
    """Warm station cache for region centroid."""
    try:
        nodes = list(G.nodes())
        if not nodes:
            return

        centroid_node = nodes[len(nodes) // 2]
        centroid_lat = float(G.nodes[centroid_node]["y"])
        centroid_lon = float(G.nodes[centroid_node]["x"])

        print(f"[Prefetch] Background: warming station cache for ({centroid_lat:.3f}, {centroid_lon:.3f})")

        from core.charger_client import fetch_charging_stations
        stations = fetch_charging_stations(centroid_lat, centroid_lon, radius_km=15.0)
        print(f"[Prefetch] Station cache warm: {len(stations)} stations loaded")
    except Exception as e:
        print(f"[Prefetch] Background station prefetch failed: {e}")


async def prefetch_stations_for_route(
    origin_lat: float, origin_lon: float,
    dest_lat: float, dest_lon: float,
    G,
    radius_km: float = 10.0,
):
    """
    Early fetch: triggered when origin + destination are known, BEFORE route is computed.
    """
    key = stations_key(
        (origin_lat + dest_lat) / 2,
        (origin_lon + dest_lon) / 2,
        radius_km,
    )
    if cache_get(key, ttl=86_400) is not None:
        return  # Already cached

    try:
        from core.charger_client import fetch_charging_stations
        mid_lat = (origin_lat + dest_lat) / 2
        mid_lon = (origin_lon + dest_lon) / 2
        fetch_charging_stations(mid_lat, mid_lon, radius_km)
    except Exception as e:
        print(f"[EarlyFetch] Station prefetch failed silently: {e}")
