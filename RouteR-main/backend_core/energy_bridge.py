"""
Antigravity AI — Energy Bridge (F-003)
RouteE ML energy prediction + physics-based fallback for graph edge enrichment.
"""

import math
import pandas as pd
import networkx as nx
from config import ROUTEE_MODEL_MAP


# ── Physics constants
RHO_AIR = 1.225   # Air density (kg/m³) at sea level, 15°C
GRAVITY = 9.81    # Gravitational acceleration (m/s²)


def enrich_full_graph(
    G: nx.MultiDiGraph,
    vehicle_class: str = "default_bev"
) -> nx.MultiDiGraph:
    """
    Batch-predict energy consumption (kWh) for every edge in the graph.
    Uses RouteE pre-trained model if available, falls back to physics model.

    Critical unit conversions (OSMnx → RouteE):
    - length: metres → miles (× 0.000621371)
    - speed_kph: km/h → mph (× 0.621371)
    - grade: fraction (0.05) → percent (5.0) (× 100)
    """
    routee_key = ROUTEE_MODEL_MAP.get(vehicle_class, "2017_CHEVROLET_Bolt")

    # Try RouteE first
    try:
        model = _load_routee_model(routee_key)
        if model:
            G = _enrich_with_routee(G, model)
            return G
    except Exception as e:
        print(f"[EnergyBridge] RouteE failed: {e} — falling back to physics model")

    # Fallback: physics-based model
    G = _enrich_with_physics(G)
    return G


def _load_routee_model(model_key: str):
    """Attempt to load a RouteE pre-trained model."""
    try:
        import nrel.routee.powertrain as pt
        model = pt.load_model(model_key)
        print(f"[EnergyBridge] RouteE model loaded: {model_key}")
        return model
    except ImportError:
        print("[EnergyBridge] nrel.routee.powertrain not installed — using physics fallback")
        return None
    except Exception as e:
        print(f"[EnergyBridge] Could not load RouteE model '{model_key}': {e}")
        return None


def _enrich_with_routee(G: nx.MultiDiGraph, model) -> nx.MultiDiGraph:
    """Batch predict energy for all edges using RouteE."""
    print("[EnergyBridge] Running RouteE batch enrichment...")

    # Collect edge data
    edges = []
    edge_keys = []
    for u, v, k, data in G.edges(data=True, keys=True):
        length_m = float(data.get("length", 0))
        speed_kph = float(data.get("speed_kph", 50.0))
        grade_frac = float(data.get("grade", 0.0))

        # Convert units for RouteE
        distance_miles = max(length_m * 0.000621371, 0.0001)
        speed_mph = max(min(speed_kph * 0.621371, 90.0), 1.0)
        grade_pct = max(min(grade_frac * 100.0, 30.0), -30.0)

        edges.append({
            "distance": distance_miles,
            "speed_mph": speed_mph,
            "grade": grade_pct,
        })
        edge_keys.append((u, v, k))

    df = pd.DataFrame(edges)

    # Predict
    predictions = model.predict(df)

    # Detect energy column dynamically
    energy_col = next(
        (c for c in predictions.columns if "energy" in c.lower() or "kwh" in c.lower()),
        None
    )
    if energy_col is None:
        print("[EnergyBridge] WARNING: Could not find energy column in RouteE output")
        print(f"[EnergyBridge] Available columns: {predictions.columns.tolist()}")
        return _enrich_with_physics(G)

    # Apply to graph edges
    energy_values = predictions[energy_col].values
    for (u, v, k), energy_kwh in zip(edge_keys, energy_values):
        G[u][v][k]["energy_kwh"] = max(float(energy_kwh), 0.0)

    coverage = sum(1 for _, _, d in G.edges(data=True) if "energy_kwh" in d)
    total = G.number_of_edges()
    print(f"[EnergyBridge] RouteE enrichment complete: {coverage}/{total} edges "
          f"({coverage/total*100:.1f}% coverage)")

    return G


def _enrich_with_physics(G: nx.MultiDiGraph) -> nx.MultiDiGraph:
    """Fallback: physics-based energy model for all edges."""
    print("[EnergyBridge] Running physics-based energy enrichment...")

    # Default EV parameters (Tata Nexon EV / Chevy Bolt class)
    mass_kg = 1800
    Cd = 0.28
    frontal_area = 2.3
    mu_rolling = 0.015
    regen_eff = 0.70
    aux_load_kw = 0.3

    for u, v, k, data in G.edges(data=True, keys=True):
        energy_kwh = compute_edge_energy(
            distance_m=float(data.get("length", 0)),
            speed_ms=float(data.get("speed_kph", 50.0)) / 3.6,
            grade=float(data.get("grade", 0.0)),
            mass_kg=mass_kg,
            Cd=Cd,
            frontal_area_m2=frontal_area,
            mu_rolling=mu_rolling,
            regen_efficiency=regen_eff,
            aux_load_kw=aux_load_kw,
        )
        G[u][v][k]["energy_kwh"] = max(energy_kwh, 0.0)

    print(f"[EnergyBridge] Physics enrichment complete: {G.number_of_edges()} edges")
    return G


def compute_edge_energy(
    distance_m: float,
    speed_ms: float,
    grade: float,
    mass_kg: float,
    Cd: float,
    frontal_area_m2: float,
    mu_rolling: float,
    regen_efficiency: float,
    aux_load_kw: float = 0.3,
) -> float:
    """
    Physics-based energy calculation for a single road segment.

    Components:
    1. Rolling resistance: F_rr = µ × m × g × cos(θ)
    2. Aerodynamic drag:   F_aero = 0.5 × Cd × A × ρ × v²
    3. Grade (gravity):    F_grade = m × g × sin(θ)
    4. Auxiliary load:     E_aux = P_aux × t
    5. Regen braking:      negative energy recovery on downhill

    Returns energy in kWh.
    """
    if distance_m <= 0 or speed_ms <= 0:
        return 0.0

    theta = math.atan(grade)
    t = distance_m / speed_ms  # seconds

    F_rolling = mu_rolling * mass_kg * GRAVITY * math.cos(theta)
    F_aero = 0.5 * Cd * frontal_area_m2 * RHO_AIR * (speed_ms ** 2)
    F_grade = mass_kg * GRAVITY * math.sin(theta)

    F_total = F_rolling + F_aero + F_grade
    P_motor = F_total * speed_ms  # Watts

    E_drive = (P_motor * t) / 3_600_000  # Joules → kWh
    E_aux = (aux_load_kw * 1000 * t) / 3_600_000

    # Regenerative braking on downhill
    if grade < 0 and E_drive < 0:
        E_drive = E_drive * regen_efficiency

    return E_drive + E_aux
