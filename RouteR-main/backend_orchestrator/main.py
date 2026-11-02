"""
Antigravity AI — Route Orchestrator (Main)
Master coordinator implementing cache-aside, early fetch, circuit breakers,
saga, bulkhead, and graceful degradation patterns.
"""

import time
import asyncio
import osmnx as ox
from core.battery import BatteryState, simulate_soc_trace
from core.router import find_route, compute_route_stats, route_to_geojson
from core.decision_engine import _insert_charging_stops
from orchestrator.cache_manager import cache_get, cache_set
from orchestrator.cache_keys import route_key, decision_key
from orchestrator.bulkheads import BULKHEADS
from orchestrator.prefetch import prefetch_stations_for_route
from orchestrator.protected_calls import fetch_stations_protected
from orchestrator.event_bus import bus
from orchestrator.metrics import record_service_call


class RouteOrchestrator:
    """
    Master coordinator for the Antigravity AI route computation pipeline.
    Implements: cache-aside, early fetch, circuit breakers, saga, bulkhead, graceful degradation.
    """

    def __init__(self, G, app_state: dict):
        self.G = G
        self.app_state = app_state

    async def handle_route_request(self, request, ev_profile: dict) -> dict:
        """
        Entry point for POST /api/route.
        Coordinates the full pipeline with all distributed system patterns.
        """
        t_start = time.time()

        # ── Emit event: trigger background station prefetch
        await bus.emit("route.request.received", {
            "origin_lat": request.origin.lat,
            "origin_lon": request.origin.lon,
            "dest_lat": request.destination.lat,
            "dest_lon": request.destination.lon,
            "G": self.G,
        })

        # ── Build battery state
        battery = BatteryState(
            capacity_kwh=ev_profile["battery_capacity_kwh"],
            soc=ev_profile["soc_current"],
            soh=ev_profile.get("soh", 1.0),
            soc_reserve=ev_profile.get("soc_min_reserve", 0.10),
        )
        max_charge_rate = ev_profile.get("max_charge_rate_kw", 50.0)

        # ── Check full decision cache (skip pipeline on hit)
        d_key = decision_key([], battery.soc, battery.soh, battery.capacity_kwh)
        cached_decision = cache_get(d_key, ttl=120)
        if cached_decision:
            record_service_call("orchestrator", "handle_route_request",
                                (time.time() - t_start) * 1000, True, "success")
            return cached_decision

        # ── Step 1: Resolve coordinates → graph nodes
        t1 = time.time()
        try:
            orig_node = ox.nearest_nodes(self.G, X=request.origin.lon, Y=request.origin.lat)
            dest_node = ox.nearest_nodes(self.G, X=request.destination.lon, Y=request.destination.lat)
        except Exception as e:
            return {"feasible": False, "error": f"Could not resolve coordinates: {e}"}
        record_service_call("router", "nearest_nodes", (time.time() - t1) * 1000, False, "success")

        # ── Step 2: Route computation (cache-aside)
        t2 = time.time()
        r_key = route_key(orig_node, dest_node, ev_profile.get("vehicle_class", "default_bev"))
        route_nodes = cache_get(r_key, ttl=300)
        cache_hit = route_nodes is not None

        if not cache_hit:
            try:
                route_nodes = find_route(self.G, orig_node, dest_node)
            except Exception as e:
                return {"feasible": False, "error": f"Routing failed: {e}"}

            if route_nodes is None:
                return {"feasible": False, "error": "No driveable path between origin and destination."}
            cache_set(r_key, route_nodes, ttl=300, layers=["memory"])

        record_service_call("router", "find_route", (time.time() - t2) * 1000, cache_hit, "success")

        # ── Step 3: Route statistics
        stats = compute_route_stats(route_nodes, self.G)

        # ── Step 4: Feasibility gate
        if battery.is_feasible(stats["total_energy_kwh"]):
            soc_trace, _ = simulate_soc_trace(route_nodes, self.G, battery)
            response = self._build_success_response(route_nodes, stats, soc_trace, [], battery)
        else:
            # ── Needs charging
            t3 = time.time()
            stations = await fetch_stations_protected(route_nodes, self.G)
            record_service_call("charger_client", "fetch_stations",
                                (time.time() - t3) * 1000, False, "success")

            if not stations:
                return {
                    "feasible": False,
                    "error": (f"Route needs {stats['total_energy_kwh']:.2f} kWh but only "
                              f"{battery.usable_energy:.2f} kWh available. "
                              f"No compatible charging stations found."),
                    "deficit_kwh": round(battery.deficit_kwh(stats["total_energy_kwh"]), 2),
                    "route": {
                        "geometry": route_to_geojson(route_nodes, self.G),
                        "total_distance_km": stats["total_distance_km"],
                        "total_energy_kwh": stats["total_energy_kwh"],
                        "estimated_time_min": stats["total_time_min"],
                    },
                }

            response = _insert_charging_stops(
                self.G, route_nodes, battery, stations, max_charge_rate
            )

        # ── Cache final decision
        cache_set(d_key, response, ttl=120, layers=["memory"])

        # ── Emit completion event
        await bus.emit("route.response.sent", {
            "duration_ms": (time.time() - t_start) * 1000,
            "feasible": response.get("feasible"),
        })

        record_service_call("orchestrator", "handle_route_request",
                            (time.time() - t_start) * 1000, False, "success")
        return response

    def _build_success_response(self, route_nodes, stats, soc_trace, charging_stops, battery) -> dict:
        return {
            "feasible": True,
            "charging_needed": len(charging_stops) > 0,
            "route": {
                "node_ids": [int(n) for n in route_nodes],
                "geometry": route_to_geojson(route_nodes, self.G),
                "total_distance_km": stats["total_distance_km"],
                "total_energy_kwh": stats["total_energy_kwh"],
                "estimated_time_min": stats["total_time_min"],
            },
            "charging_stops": charging_stops,
            "soc_trace": soc_trace,
            "arrival_soc": soc_trace[-1]["soc"] if soc_trace else battery.soc,
        }
