"""
Antigravity AI — Cache Key Construction
Standardized cache key builders for all services.
"""

import hashlib


def graph_key(region: str) -> str:
    return f"graph:{region.lower().replace(' ', '_').replace(',', '')}"


def energy_graph_key(region: str, vehicle_class: str) -> str:
    return f"energy_graph:{region}:{vehicle_class}"


def stations_key(lat: float, lon: float, radius_km: float) -> str:
    return f"stations:{round(lat, 3)}:{round(lon, 3)}:{radius_km}"


def route_key(orig_node: int, dest_node: int, vehicle_class: str) -> str:
    return f"route:{orig_node}:{dest_node}:{vehicle_class}"


def soc_key(route_nodes: list, soc: float, soh: float, capacity: float) -> str:
    route_hash = hashlib.md5(str(route_nodes).encode()).hexdigest()[:8]
    return f"soc:{route_hash}:{round(soc, 2)}:{round(soh, 2)}:{capacity}"


def decision_key(route_nodes: list, soc: float, soh: float, capacity: float) -> str:
    route_hash = hashlib.md5(str(route_nodes).encode()).hexdigest()[:8]
    battery_hash = f"{round(soc, 2)}:{round(soh, 2)}:{capacity}"
    return f"decision:{route_hash}:{battery_hash}"
