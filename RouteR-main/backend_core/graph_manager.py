"""
Antigravity AI — Graph Manager (F-001, F-002)
Downloads, caches, and enriches OSMnx road network graphs.
Elevation data from GPXZ API (high-res, no Google dependency).
"""

import os
import math
import requests
import osmnx as ox
import networkx as nx
from config import GRAPH_CACHE_DIR, GPXZ_API_KEY


os.makedirs(GRAPH_CACHE_DIR, exist_ok=True)

GPXZ_BATCH_URL = "https://api.gpxz.io/v1/elevation/points"
GPXZ_MAX_BATCH = 512  # Max points per API call


def _cache_path(region: str) -> str:
    """Generate safe filename for region cache."""
    safe = region.lower().replace(",", "").replace(" ", "_").strip("_")
    return os.path.join(GRAPH_CACHE_DIR, f"{safe}.graphml")


def get_graph(region: str) -> nx.MultiDiGraph:
    """
    Load road graph for a region.
    1. Check GraphML cache → load from file (~2s)
    2. Cache miss → download from OSM Overpass API (~60–90s)
    3. Add speed + travel time attributes
    4. Save to cache for next time
    """
    path = _cache_path(region)

    if os.path.exists(path):
        print(f"[GraphManager] Loading cached graph: {path}")
        G = ox.load_graphml(path)
        print(f"[GraphManager] Loaded: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
        return G

    print(f"[GraphManager] Downloading graph for '{region}' from OSM...")
    G = ox.graph_from_place(region, network_type="drive")

    # Add speed and travel time attributes
    G = ox.add_edge_speeds(G)
    G = ox.add_edge_travel_times(G)

    # Save to cache
    ox.save_graphml(G, filepath=path)
    print(f"[GraphManager] Graph cached: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")

    return G


def add_elevation_to_graph(G: nx.MultiDiGraph, api_key: str = None) -> nx.MultiDiGraph:
    """
    Add elevation data to graph nodes using GPXZ API and compute edge grades.
    Falls back to grade=0.0 if no API key is provided.

    GPXZ API: /v1/elevation/points
    - Input:  latlons=lat,lon|lat,lon|... (max 512 per batch)
    - Auth:   x-api-key header
    - Output: results[].elevation (metres)

    Grade formula: grade = (elevation_end - elevation_start) / edge_length
    Positive = uphill (more energy), Negative = downhill (regen potential)
    """
    key = api_key or GPXZ_API_KEY

    if not key:
        print("[GraphManager] No GPXZ API key — setting grade=0.0 on all edges (degraded mode)")
        for u, v, k, data in G.edges(data=True, keys=True):
            G[u][v][k]["grade"] = 0.0
        return G

    try:
        print("[GraphManager] Fetching elevation data from GPXZ API...")
        G = _add_node_elevations_gpxz(G, key)
        G = _compute_edge_grades(G)
        enriched_count = sum(1 for _, d in G.nodes(data=True) if "elevation" in d)
        print(f"[GraphManager] Elevation enrichment complete: "
              f"{enriched_count}/{G.number_of_nodes()} nodes")
    except Exception as e:
        print(f"[GraphManager] GPXZ elevation failed: {e} — falling back to grade=0.0")
        for u, v, k, data in G.edges(data=True, keys=True):
            if "grade" not in data:
                G[u][v][k]["grade"] = 0.0

    return G


def _add_node_elevations_gpxz(G: nx.MultiDiGraph, api_key: str) -> nx.MultiDiGraph:
    """
    Batch-fetch elevation for all graph nodes via GPXZ /v1/elevation/points.

    Batches into groups of 512 (GPXZ max per request).
    Sets node attribute 'elevation' (metres above sea level).
    """
    node_ids = list(G.nodes())
    node_data = [(nid, G.nodes[nid]) for nid in node_ids]

    total_nodes = len(node_ids)
    batch_count = math.ceil(total_nodes / GPXZ_MAX_BATCH)
    print(f"[GraphManager] GPXZ: {total_nodes} nodes → {batch_count} batch(es)")

    headers = {"x-api-key": api_key}
    failed_nodes = 0

    for batch_idx in range(batch_count):
        start = batch_idx * GPXZ_MAX_BATCH
        end = min(start + GPXZ_MAX_BATCH, total_nodes)
        batch = node_data[start:end]

        # Build latlons string: "lat1,lon1|lat2,lon2|..."
        latlons = "|".join(
            f"{float(d['y'])},{float(d['x'])}" for _, d in batch
        )

        try:
            response = requests.get(
                GPXZ_BATCH_URL,
                params={"latlons": latlons},
                headers=headers,
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()

            if data.get("status") != "OK":
                print(f"[GraphManager] GPXZ batch {batch_idx+1} error: {data.get('error_message', 'unknown')}")
                failed_nodes += len(batch)
                continue

            results = data.get("results", [])
            if len(results) != len(batch):
                print(f"[GraphManager] GPXZ batch {batch_idx+1}: expected {len(batch)} results, got {len(results)}")

            for (nid, _), result in zip(batch, results):
                elevation = result.get("elevation")
                if elevation is not None:
                    G.nodes[nid]["elevation"] = float(elevation)
                else:
                    G.nodes[nid]["elevation"] = 0.0
                    failed_nodes += 1

            print(f"[GraphManager] GPXZ batch {batch_idx+1}/{batch_count}: "
                  f"{len(results)} elevations (resolution: "
                  f"{results[0].get('resolution', '?')}m, source: {results[0].get('data_source', '?')})")

        except requests.exceptions.Timeout:
            print(f"[GraphManager] GPXZ batch {batch_idx+1} timed out")
            failed_nodes += len(batch)
        except requests.exceptions.RequestException as e:
            print(f"[GraphManager] GPXZ batch {batch_idx+1} failed: {e}")
            failed_nodes += len(batch)

    if failed_nodes > 0:
        print(f"[GraphManager] WARNING: {failed_nodes}/{total_nodes} nodes missing elevation (set to 0)")

    return G


def _compute_edge_grades(G: nx.MultiDiGraph) -> nx.MultiDiGraph:
    """
    Compute grade (slope) for each edge from node elevations.
    grade = (elevation_end - elevation_start) / edge_length
    Clamp to ±0.5 (50% grade) to prevent outliers from bad data.
    """
    for u, v, k, data in G.edges(data=True, keys=True):
        u_elev = G.nodes[u].get("elevation", 0.0)
        v_elev = G.nodes[v].get("elevation", 0.0)
        length = float(data.get("length", 0))

        if length > 0:
            grade = (v_elev - u_elev) / length
            # Clamp to realistic range
            grade = max(min(grade, 0.5), -0.5)
        else:
            grade = 0.0

        G[u][v][k]["grade"] = grade

    return G


def get_graph_stats(G: nx.MultiDiGraph) -> dict:
    """Return summary stats for the health endpoint."""
    total_edges = G.number_of_edges()
    enriched = sum(1 for _, _, d in G.edges(data=True) if "energy_kwh" in d)
    has_elevation = any(
        "elevation" in G.nodes[n] and G.nodes[n]["elevation"] != 0.0
        for n in G.nodes()
    )

    return {
        "nodes": G.number_of_nodes(),
        "edges": total_edges,
        "enriched_edges": enriched,
        "coverage_pct": round(enriched / total_edges * 100, 1) if total_edges else 0,
        "has_elevation": has_elevation,
        "elevation_source": "GPXZ" if has_elevation else "none (flat terrain fallback)",
    }
