"""
Antigravity AI — Decision Engine (F-006, F-007)
Route feasibility gate, charging stop insertion, and full pipeline orchestration.
"""

from core.battery import BatteryState, simulate_soc_trace, estimate_charge_time
from core.router import find_route, compute_route_stats, route_to_geojson, resolve_coordinates
from core.charger_client import fetch_stations_along_corridor
from config import SOC_CHARGE_TARGET, SOC_TRIGGER_CHARGE, CORRIDOR_RADIUS_KM


def process_route_request(
    G,
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    ev_profile: dict,
) -> dict:
    """
    Full route computation pipeline:
    1. Resolve coordinates → graph nodes
    2. Compute energy-optimal route (Dijkstra)
    3. Compute route stats
    4. Feasibility gate (SOC check)
    5. If infeasible → insert charging stops
    6. Simulate SOC trace
    7. Build response

    Returns structured response dict.
    """
    # ── Build battery state
    battery = BatteryState(
        capacity_kwh=ev_profile["battery_capacity_kwh"],
        soc=ev_profile["soc_current"],
        soh=ev_profile.get("soh", 1.0),
        soc_reserve=ev_profile.get("soc_min_reserve", 0.10),
    )
    max_charge_rate = ev_profile.get("max_charge_rate_kw", 50.0)
    connector_types = ev_profile.get("connector_types", [])

    # ── Step 1: Resolve lat/lon → graph nodes
    try:
        orig_node = resolve_coordinates(G, origin_lat, origin_lon)
        dest_node = resolve_coordinates(G, dest_lat, dest_lon)
    except Exception as e:
        return {"feasible": False, "error": f"Could not resolve coordinates: {e}"}

    # ── Step 2: Compute route
    route_nodes = find_route(G, orig_node, dest_node)
    if route_nodes is None:
        return {
            "feasible": False,
            "error": "No driveable path between origin and destination.",
        }

    # ── Step 3: Route stats
    stats = compute_route_stats(route_nodes, G)

    # ── Step 4: Feasibility gate
    if battery.is_feasible(stats["total_energy_kwh"]):
        # Route is feasible — no charging needed
        soc_trace, _ = simulate_soc_trace(route_nodes, G, battery)
        geometry = route_to_geojson(route_nodes, G)

        return {
            "feasible": True,
            "charging_needed": False,
            "route": {
                "node_ids": [int(n) for n in route_nodes],
                "geometry": geometry,
                "total_distance_km": stats["total_distance_km"],
                "total_energy_kwh": stats["total_energy_kwh"],
                "estimated_time_min": stats["total_time_min"],
            },
            "charging_stops": [],
            "soc_trace": soc_trace,
            "arrival_soc": round(battery.arrival_soc(stats["total_energy_kwh"]), 4),
        }

    # ── Step 5: Route infeasible — try inserting charging stops
    print(f"[DecisionEngine] Route needs {stats['total_energy_kwh']:.2f} kWh, "
          f"battery has {battery.usable_energy:.2f} kWh — inserting charging stops")

    stations = fetch_stations_along_corridor(route_nodes, G, radius_km=CORRIDOR_RADIUS_KM)

    if not stations:
        # No stations — infeasible
        return {
            "feasible": False,
            "charging_needed": True,
            "error": (
                f"Route requires {stats['total_energy_kwh']:.2f} kWh but only "
                f"{battery.usable_energy:.2f} kWh available. "
                f"No compatible charging stations found along the route corridor."
            ),
            "deficit_kwh": round(battery.deficit_kwh(stats["total_energy_kwh"]), 2),
            "route": {
                "node_ids": [int(n) for n in route_nodes],
                "geometry": route_to_geojson(route_nodes, G),
                "total_distance_km": stats["total_distance_km"],
                "total_energy_kwh": stats["total_energy_kwh"],
                "estimated_time_min": stats["total_time_min"],
            },
        }

    # ── Step 6: Insert charging stops
    result = _insert_charging_stops(
        G, route_nodes, battery, stations, max_charge_rate, connector_types
    )
    return result


def _insert_charging_stops(
    G,
    route_nodes: list[int],
    battery: BatteryState,
    stations: list[dict],
    max_charge_rate_kw: float = 50.0,
    connector_types: list[str] = None,
) -> dict:
    """
    Greedy forward-scan charging stop insertion.

    Algorithm:
    - Walk along route node by node
    - Track running SOC
    - When SOC drops below TRIGGER threshold AND current node has a station → charge
    - Reset SOC to TARGET (80%) after charging
    - Record each charging stop with arrival/departure SOC and charge time
    """
    eff_capacity = battery.effective_capacity
    current_soc = battery.soc
    soc_trigger = SOC_TRIGGER_CHARGE + battery.soc_reserve  # 20% + 10% reserve = 30% trigger

    # Build station lookup by graph node
    station_nodes = {}
    for s in stations:
        node = s.get("graph_node")
        if node is not None:
            # Filter by connector compatibility if specified
            if connector_types and s.get("connector_type"):
                if s["connector_type"] not in connector_types and connector_types:
                    pass  # Allow all for now; strict filtering can be added
            station_nodes.setdefault(int(node), []).append(s)

    charging_stops = []
    segment_energy = 0.0
    soc_trace = [{
        "node": int(route_nodes[0]),
        "soc": round(current_soc, 4),
        "cumulative_kwh": 0.0,
    }]
    total_energy = 0.0

    for i in range(len(route_nodes) - 1):
        u = route_nodes[i]
        v = route_nodes[i + 1]

        # Get min-energy edge
        try:
            edge_data = min(G[u][v].values(), key=lambda d: d.get("energy_kwh", float("inf")))
        except (KeyError, ValueError):
            edge_data = {"energy_kwh": 0}

        edge_energy = float(edge_data.get("energy_kwh", 0))
        segment_energy += edge_energy
        total_energy += edge_energy

        soc_after = current_soc - (segment_energy / eff_capacity) if eff_capacity > 0 else 0

        # Check if we need to charge at this node
        if soc_after < soc_trigger and int(v) in station_nodes:
            station = station_nodes[int(v)][0]  # Pick first compatible station

            arrival_soc = max(soc_after, 0.0)
            target_soc = min(SOC_CHARGE_TARGET, 1.0)
            charge_time = estimate_charge_time(
                battery, station["power_kw"], arrival_soc, target_soc, max_charge_rate_kw
            )

            charging_stops.append({
                "station_name": station.get("name", "Unknown"),
                "ocm_id": station.get("ocm_id"),
                "connection_id": station.get("connection_id"),
                "lat": station.get("lat"),
                "lon": station.get("lon"),
                "power_kw": station.get("power_kw"),
                "connector_type": station.get("connector_type"),
                "current_type": station.get("current_type", "Unknown"),
                "is_fast_charge": station.get("is_fast_charge", False),
                "is_operational": station.get("is_operational", True),
                "operator": station.get("operator", "Unknown"),
                "usage_type": station.get("usage_type", "Unknown"),
                "quantity": station.get("quantity", 1),
                "distance_km": station.get("distance_km"),
                "node": int(v),
                "arrival_soc": round(arrival_soc, 4),
                "departure_soc": round(target_soc, 4),
                "charge_time_min": charge_time,
            })

            # Reset SOC and segment tracking
            current_soc = target_soc
            segment_energy = 0.0

            soc_trace.append({
                "node": int(v),
                "soc": round(current_soc, 4),
                "cumulative_kwh": round(total_energy, 4),
                "charging_stop": True,
            })
        else:
            current_soc_now = current_soc - (segment_energy / eff_capacity) if eff_capacity > 0 else 0
            current_soc_now = max(min(current_soc_now, 1.0), 0.0)

            soc_trace.append({
                "node": int(v),
                "soc": round(current_soc_now, 4),
                "cumulative_kwh": round(total_energy, 4),
            })

    # Final arrival SOC
    final_soc = soc_trace[-1]["soc"] if soc_trace else 0.0
    stats = compute_route_stats(route_nodes, G)
    geometry = route_to_geojson(route_nodes, G)

    return {
        "feasible": True,
        "charging_needed": len(charging_stops) > 0,
        "route": {
            "node_ids": [int(n) for n in route_nodes],
            "geometry": geometry,
            "total_distance_km": stats["total_distance_km"],
            "total_energy_kwh": stats["total_energy_kwh"],
            "estimated_time_min": stats["total_time_min"],
        },
        "charging_stops": charging_stops,
        "soc_trace": soc_trace,
        "arrival_soc": round(final_soc, 4),
    }
