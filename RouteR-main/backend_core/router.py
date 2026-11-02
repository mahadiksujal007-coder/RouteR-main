"""
Antigravity AI — Router (F-005)
Energy-optimal route computation using Dijkstra on energy-enriched graphs.
"""

import networkx as nx
import osmnx as ox


def find_route(
    G: nx.MultiDiGraph,
    orig_node: int,
    dest_node: int,
    weight: str = "energy_kwh",
) -> list[int] | None:
    """
    Find the energy-optimal route between two graph nodes.
    Uses Dijkstra's algorithm with energy_kwh edge weights.

    Returns list of node IDs or None if no path exists.
    """
    try:
        route = nx.shortest_path(G, orig_node, dest_node, weight=weight)
        return route
    except nx.NetworkXNoPath:
        return None
    except nx.NodeNotFound:
        return None


def compute_route_stats(route_nodes: list[int], G: nx.MultiDiGraph) -> dict:
    """
    Compute route statistics: total energy, distance, and time.
    Resolves parallel edges by selecting minimum-energy edge.
    """
    total_energy_kwh = 0.0
    total_distance_m = 0.0
    total_time_s = 0.0

    for u, v in zip(route_nodes[:-1], route_nodes[1:]):
        try:
            best_edge = min(
                G[u][v].values(),
                key=lambda d: d.get("energy_kwh", float("inf"))
            )
        except (KeyError, ValueError):
            best_edge = {}

        total_energy_kwh += float(best_edge.get("energy_kwh", 0))
        total_distance_m += float(best_edge.get("length", 0))
        total_time_s += float(best_edge.get("travel_time", 0))

    return {
        "total_energy_kwh": round(total_energy_kwh, 3),
        "total_distance_km": round(total_distance_m / 1000.0, 2),
        "total_time_min": round(total_time_s / 60.0, 1),
    }


def route_to_geojson(route_nodes: list[int], G: nx.MultiDiGraph) -> list[list[float]]:
    """
    Extract route geometry as [[lon, lat], ...] for Leaflet/GeoJSON.
    Uses node coordinates from the graph.
    """
    coords = []
    for node_id in route_nodes:
        node_data = G.nodes[node_id]
        coords.append([
            round(float(node_data["x"]), 6),  # lon
            round(float(node_data["y"]), 6),  # lat
        ])
    return coords


def resolve_coordinates(
    G: nx.MultiDiGraph,
    lat: float,
    lon: float,
) -> int:
    """Map GPS coordinates to the nearest graph node."""
    return ox.nearest_nodes(G, X=lon, Y=lat)
