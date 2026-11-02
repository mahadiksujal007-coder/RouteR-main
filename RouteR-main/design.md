# EV Route Planning System — Complete Technical Architecture & Implementation Guide

> **Purpose:** Full architectural reference for building an Electric Vehicle (EV) route planning system integrating OSMnx graph constraints, energy-aware routing, battery modeling, charging infrastructure, and a decision engine.

---

## TABLE OF CONTENTS

1. [System Overview & Architecture](#1-system-overview--architecture)
2. [Component 1 — OSMnx Graph Download & Constraints](#2-component-1--osmnx-graph-download--constraints)
3. [Component 2 — Graph-Aware EV Parameter Integration](#3-component-2--graph-aware-ev-parameter-integration)
4. [Component 3 — Energy Consumption Modeling (RouteE)](#4-component-3--energy-consumption-modeling-routee)
5. [Component 4 — Battery Constraints: SOC & SOH](#5-component-4--battery-constraints-soc--soh)
6. [Component 5 — Charging Infrastructure (OpenChargeMap)](#6-component-5--charging-infrastructure-openchargemap)
7. [Component 6 — Routing Engine (A\* / Dijkstra)](#7-component-6--routing-engine-a--dijkstra)
8. [Component 7 — Decision Engine](#8-component-7--decision-engine)
9. [System Data Flow Pipeline](#9-system-data-flow-pipeline)
10. [API Design & Client-Server Architecture](#10-api-design--client-server-architecture)
11. [Data Field Registry](#11-data-field-registry)
12. [Implementation Roadmap](#12-implementation-roadmap)
13. [Known Problems & Solutions](#13-known-problems--solutions)
14. [Open Questions](#14-open-questions)

---

## 1. System Overview & Architecture

### 1.1 High-Level Description

The system is an **energy-aware EV route planner** that replaces conventional distance/time-based routing with **energy-consumption-based routing** using real road graph topology, EV-specific battery parameters, ML-based energy prediction, and live charging infrastructure data.

### 1.2 Core Architectural Layers

```
┌────────────────────────────────────────────────────────┐
│               CLIENT (Web / Mobile App)                │
│         Input: Source, Destination, EV Profile        │
└───────────────────────┬────────────────────────────────┘
                        │ REST API
┌───────────────────────▼────────────────────────────────┐
│               ROUTING SERVER (FastAPI / Flask)         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Graph Engine │  │Energy Engine │  │Decision Engine│  │
│  │  (OSMnx +   │  │  (RouteE /   │  │(SOC/SOH Check │  │
│  │  NetworkX)  │  │  Custom ML)  │  │+ CS Insertion)│  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
└───────────────────────┬────────────────────────────────┘
                        │
┌───────────────────────▼────────────────────────────────┐
│                   DATA LAYER                           │
│  ┌──────────────┐ ┌─────────────┐ ┌────────────────┐  │
│  │ OSM Graph    │ │  EV Model   │ │ OpenChargeMap  │  │
│  │  (GraphML /  │ │  Store      │ │  API / Cache   │  │
│  │  PostGIS)    │ │  (JSON/DB)  │ │                │  │
│  └──────────────┘ └─────────────┘ └────────────────┘  │
└────────────────────────────────────────────────────────┘
```

### 1.3 Key Principles

| Principle                | Detail                                           |
| ------------------------ | ------------------------------------------------ |
| Energy-first routing     | Cost function = energy consumed, not distance    |
| SOC/SOH feasibility gate | Route only served if battery can complete it     |
| Charging stop injection  | Automatic insertion of charging waypoints        |
| Graph pre-computation    | Graph loaded once, cached server-side            |
| Modular ML models        | RouteE pre-trained or custom-trained per vehicle |

---

## 2. Component 1 — OSMnx Graph Download & Constraints

### 2.1 What OSMnx Provides

OSMnx is a Python library that queries OpenStreetMap's Overpass API and constructs a **NetworkX MultiDiGraph** representing the road network.

- **Nodes** = road intersections (lat/lon, OSM node ID)
- **Edges** = road segments (length, speed, geometry, grade, road type)
- **MultiDiGraph** = directed graph allowing parallel edges (one-way streets handled correctly)

### 2.2 Graph Download — Code Patterns

```python
import osmnx as ox
import networkx as nx

# ── Method 1: By place name (city/region)
G = ox.graph_from_place("Nashik, Maharashtra, India", network_type="drive")

# ── Method 2: By coordinates + radius (meters)
G = ox.graph_from_point((20.0059, 73.7898), dist=5000, network_type="drive")

# ── Method 3: By bounding box
G = ox.graph_from_bbox(north=20.05, south=19.95, east=73.85, west=73.73, network_type="drive")

# ── Method 4: Load saved graph (recommended for production)
G = ox.load_graphml("nashik_drive.graphml")

# ── Save for reuse (avoids repeated API calls)
ox.save_graphml(G, filepath="nashik_drive.graphml")
```

**CRITICAL for EV Systems:** Always set `network_type="drive"` to exclude pedestrian and bicycle paths.

### 2.3 Adding Speed & Travel Time Attributes

```python
# Impute missing speed limits (uses OSM maxspeed tag, fills gaps with road-type defaults)
G = ox.add_edge_speeds(G)

# Calculate travel time per edge (in seconds)
G = ox.add_edge_travel_times(G)

# Verify edge attributes
gdf_nodes, gdf_edges = ox.graph_to_gdfs(G)
print(gdf_edges.columns.tolist())
# → ['osmid', 'name', 'highway', 'oneway', 'length', 'geometry',
#    'maxspeed', 'speed_kph', 'travel_time']
```

### 2.4 Adding Elevation (Critical for Energy Modeling)

Elevation difference between nodes is essential for computing road grade (slope), which is a primary factor in EV energy consumption.

```python
# Method A: Google Elevation API (requires API key)
G = ox.elevation.add_node_elevations_google(G, api_key="YOUR_KEY")

# Method B: Open-Elevation API (free, slower)
G = ox.elevation.add_node_elevations_open(G)

# Compute edge grades (rise/run ratio = slope)
G = ox.elevation.add_edge_grades(G)
# Adds 'grade' attribute per edge: positive = uphill, negative = downhill
```

**Grade formula:**

```
grade = (elevation_end - elevation_start) / edge_length
```

For EV energy modeling:

- **Uphill (grade > 0):** Consumes more energy — motor works harder against gravity
- **Downhill (grade < 0):** May recover energy via regenerative braking (negative cost)

### 2.5 Graph Constraints for EV Routing

After downloading the graph, you must add **EV-specific edge weights**. The base OSMnx graph only has distance and time. You need:

| Attribute    | Source                | Usage                                    |
| ------------ | --------------------- | ---------------------------------------- |
| `length`     | OSMnx native          | Distance-based energy base               |
| `grade`      | Elevation API         | Slope factor in energy formula           |
| `speed_kph`  | OSMnx + maxspeed      | Aerodynamic drag factor                  |
| `highway`    | OSM tag               | Road class (motorway, residential, etc.) |
| `energy_kwh` | **Custom — computed** | EV energy cost per edge                  |

```python
# After graph download, compute energy cost per edge
for u, v, key, data in G.edges(data=True, keys=True):
    length_km = data.get('length', 0) / 1000.0     # metres → km
    grade     = data.get('grade', 0.0)              # slope fraction
    speed_kph = data.get('speed_kph', 50.0)        # fallback 50 kph

    energy_kwh = compute_energy(
        distance_km = length_km,
        grade       = grade,
        speed_kph   = speed_kph,
        vehicle_mass_kg  = EV_PARAMS['mass'],
        efficiency_kwh_km = EV_PARAMS['efficiency']
    )
    G[u][v][key]['energy_kwh'] = energy_kwh

# Save enriched graph
ox.save_graphml(G, filepath="nashik_ev_enriched.graphml")
```

### 2.6 Graph Conversion for Routing

```python
# Convert to DiGraph for standard Dijkstra (removes parallel edges by keeping min-energy)
D = ox.convert.to_digraph(G, weight="energy_kwh")

# Find nearest graph node from GPS coordinates
orig_node = ox.nearest_nodes(G, X=origin_lon, Y=origin_lat)
dest_node = ox.nearest_nodes(G, X=dest_lon,   Y=dest_lat)
```

---

## 3. Component 2 — Graph-Aware EV Parameter Integration

### 3.1 EV Data Model

Every EV submitted to the routing engine must be described by a structured parameter set:

```python
EV_PROFILE = {
    # Battery
    "battery_capacity_kwh": 40.0,      # Total battery capacity
    "soc_current":          0.80,      # Current State of Charge (0.0 – 1.0)
    "soh":                  0.95,      # State of Health (degradation factor, 0.0–1.0)
    "soc_min_reserve":      0.10,      # Never discharge below this (safety buffer)
    "soc_target_arrival":   0.20,      # Desired SOC at destination

    # Drivetrain
    "efficiency_kwh_km":    0.18,      # Base energy consumption (kWh per km)
    "regen_efficiency":     0.70,      # Regenerative braking capture efficiency (0–1)

    # Physical
    "mass_kg":              1800,      # Vehicle + payload (kg)
    "drag_coefficient":     0.28,      # Aerodynamic drag (Cd)
    "frontal_area_m2":      2.3,       # Vehicle frontal cross-section (m²)
    "rolling_resistance":   0.015,     # Rolling resistance coefficient (µ)
    "wheel_radius_m":       0.33,      # For inertia calculation

    # Charging
    "max_charge_rate_kw":   50.0,      # Max AC/DC charge rate accepted by vehicle
    "connector_types":      ["CCS2", "Type2"],

    # Identity (for pre-trained model lookup)
    "model_id":             "2017_CHEVROLET_Bolt"
}
```

### 3.2 Usable Energy Calculation

The actual energy available for the trip is constrained by battery health and reserve requirements:

```python
def compute_usable_energy(ev: dict) -> float:
    """
    Returns energy available (kWh) for the current trip.

    Formula:
        usable_energy = battery_capacity × SOC × SOH − reserve_energy
    where:
        reserve_energy = battery_capacity × SOH × soc_min_reserve
    """
    total_capacity = ev['battery_capacity_kwh']
    soh            = ev['soh']
    soc            = ev['soc_current']
    soc_reserve    = ev['soc_min_reserve']

    effective_capacity = total_capacity * soh
    available_energy   = effective_capacity * soc
    reserve_energy     = effective_capacity * soc_reserve

    usable_energy = available_energy - reserve_energy
    return max(usable_energy, 0.0)   # Cannot be negative

# Example: 40 kWh battery, SOC 80%, SOH 95%, 10% reserve
# effective = 40 × 0.95 = 38 kWh
# available = 38 × 0.80 = 30.4 kWh
# reserve   = 38 × 0.10 = 3.8 kWh
# usable    = 30.4 − 3.8 = 26.6 kWh
```

---

## 4. Component 3 — Energy Consumption Modeling (RouteE)

### 4.1 RouteE Overview

RouteE (National Renewable Energy Laboratory — NREL) is an ML-based vehicle energy prediction engine. It provides **pre-trained models** trained on ~1 million miles of real-world drive cycle data across various vehicle types including BEVs.

**Key capability:** Given per-road-link attributes (speed, grade, distance), RouteE predicts energy consumption in kWh per link.

### 4.2 RouteE Installation & Usage

```bash
pip install nrel.routee.powertrain
```

```python
import nrel.routee.powertrain as pt
import pandas as pd

# List all available pre-trained models
print(pt.list_available_models(local=True, external=True))
# → ['2017_CHEVROLET_Bolt', '2016_NISSAN_Leaf', '2018_TESLA_Model3', ...]

# Load BEV model (Chevrolet Bolt = common BEV reference)
model = pt.load_model("2017_CHEVROLET_Bolt")

# Inspect expected input features
print(model)
# Feature: speed_mph, grade (%), distance (miles)
# Target: energy_kwh
```

### 4.3 Predicting Energy Per Route Link

```python
def predict_route_energy_routee(route_links: list, model) -> pd.DataFrame:
    """
    route_links: list of dicts with per-edge attributes from OSMnx graph
    Returns DataFrame with energy_kwh per link
    """
    df = pd.DataFrame(route_links)

    # Convert units to RouteE expected format
    df['speed_mph']  = df['speed_kph'] * 0.621371
    df['grade']      = df['grade'] * 100          # Fraction → Percentage
    df['distance']   = df['length_m'] / 1609.344  # Metres → Miles

    # Predict
    result = model.predict(df)
    return result  # adds 'energy_kwh' column

# Example usage
route_links = [
    {'length_m': 450, 'speed_kph': 60, 'grade': 0.02},
    {'length_m': 300, 'speed_kph': 50, 'grade': -0.01},
    {'length_m': 700, 'speed_kph': 80, 'grade': 0.00},
]
energy_df = predict_route_energy_routee(route_links, bolt_model)
total_kwh  = energy_df['energy_kwh'].sum()
```

### 4.4 Custom Physics-Based Energy Model (Fallback)

When RouteE models are unavailable for a specific vehicle, use a physics-based formula:

```python
import math

# Constants
RHO_AIR  = 1.225     # Air density (kg/m³) at sea level, 15°C
G        = 9.81      # Gravitational acceleration (m/s²)

def compute_edge_energy(
    distance_m:       float,
    speed_ms:         float,  # Speed in m/s
    grade:            float,  # Slope (rise/run ratio)
    mass_kg:          float,
    Cd:               float,  # Drag coefficient
    frontal_area_m2:  float,
    mu_rolling:       float,  # Rolling resistance
    regen_efficiency: float,
    aux_load_kw:      float = 0.3  # HVAC, lights, etc.
) -> float:
    """
    Returns energy in kWh for traversing one road segment.

    Components:
    1. Rolling resistance:   F_rr = µ × m × g × cos(θ)
    2. Aerodynamic drag:     F_aero = 0.5 × Cd × A × ρ × v²
    3. Grade (gravity):      F_grade = m × g × sin(θ)
    4. Auxiliary load:       E_aux = P_aux × t
    5. Regenerative braking: negative energy recovery on downhill
    """
    theta = math.atan(grade)          # Road angle in radians
    t     = distance_m / speed_ms     # Travel time (seconds)

    F_rolling = mu_rolling * mass_kg * G * math.cos(theta)
    F_aero    = 0.5 * Cd * frontal_area_m2 * RHO_AIR * (speed_ms ** 2)
    F_grade   = mass_kg * G * math.sin(theta)

    F_total   = F_rolling + F_aero + F_grade   # Total force (N)
    P_motor   = F_total * speed_ms              # Power (Watts)

    E_drive   = (P_motor * t) / 3_600_000      # Joules → kWh
    E_aux     = (aux_load_kw * 1000 * t) / 3_600_000

    # Regenerative braking: recover energy on downhill
    if grade < 0 and E_drive < 0:
        E_drive = E_drive * regen_efficiency    # Negative = recovery

    return E_drive + E_aux
```

### 4.5 Edge Weight Assignment

```python
def enrich_graph_with_energy(G, ev_profile: dict) -> nx.MultiDiGraph:
    """Annotates every graph edge with predicted energy cost."""
    for u, v, key, data in G.edges(data=True, keys=True):
        energy_kwh = compute_edge_energy(
            distance_m       = data.get('length', 0),
            speed_ms         = data.get('speed_kph', 50) / 3.6,
            grade            = data.get('grade', 0.0),
            mass_kg          = ev_profile['mass_kg'],
            Cd               = ev_profile['drag_coefficient'],
            frontal_area_m2  = ev_profile['frontal_area_m2'],
            mu_rolling       = ev_profile['rolling_resistance'],
            regen_efficiency = ev_profile['regen_efficiency']
        )
        G[u][v][key]['energy_kwh'] = max(energy_kwh, 0)  # Clamp negatives unless regen tracked

    return G
```

---

## 5. Component 4 — Battery Constraints: SOC & SOH

### 5.1 State of Charge (SOC)

SOC represents the current battery charge level as a fraction of total effective capacity.

```
SOC = (current_charge_kWh) / (effective_capacity_kWh)
    where: effective_capacity = battery_capacity × SOH
```

**SOC Tracking Along a Route:**

```python
def simulate_soc_along_route(route_node_ids: list, G, ev_profile: dict) -> list:
    """
    Simulates SOC depletion along a computed route.
    Returns list of (node_id, soc_remaining) tuples.
    """
    usable_energy  = compute_usable_energy(ev_profile)
    energy_consumed = 0.0
    soc_trace      = []

    soc_start = ev_profile['soc_current']
    eff_cap   = ev_profile['battery_capacity_kwh'] * ev_profile['soh']

    for i in range(len(route_node_ids) - 1):
        u = route_node_ids[i]
        v = route_node_ids[i + 1]

        # Get minimum energy edge (in case of parallel edges)
        edge_data = min(G[u][v].values(), key=lambda d: d.get('energy_kwh', 0))
        edge_energy = edge_data.get('energy_kwh', 0)

        energy_consumed += edge_energy
        current_soc = soc_start - (energy_consumed / eff_cap)
        soc_trace.append((v, round(current_soc, 4)))

        # Early termination: SOC dropped to reserve
        if current_soc <= ev_profile['soc_min_reserve']:
            soc_trace.append(('DEPLETED', current_soc))
            break

    return soc_trace
```

### 5.2 State of Health (SOH)

SOH models battery degradation over its lifetime. A battery at 100% SOH delivers its rated capacity. Degradation follows a non-linear pattern based on charge cycles and temperature.

**Simplified SOH Degradation Model:**

```python
def estimate_soh(
    age_years:       float,
    total_cycles:    int,
    avg_temperature: float = 25.0  # °C
) -> float:
    """
    Returns estimated SOH (0.0 – 1.0).
    Based on empirical degradation rates for Li-ion batteries.

    Rules of thumb:
    - ~2–3% capacity loss per year under normal conditions
    - ~0.01% loss per full charge cycle
    - High temp (>35°C) accelerates degradation ~1.5×
    """
    cycle_degradation = total_cycles * 0.0001  # Per cycle
    time_degradation  = age_years * 0.025      # Per year

    temp_factor = 1.5 if avg_temperature > 35 else 1.0
    total_degradation = (cycle_degradation + time_degradation) * temp_factor

    return max(1.0 - total_degradation, 0.60)   # Floor at 60% (end of life)
```

### 5.3 SOC/SOH Feasibility Check

Before executing any route:

```python
def is_route_feasible(
    total_route_energy_kwh: float,
    ev_profile: dict
) -> dict:
    """
    Determines if route is feasible given battery state.
    Returns feasibility verdict and metadata.
    """
    usable = compute_usable_energy(ev_profile)

    result = {
        "feasible":              total_route_energy_kwh <= usable,
        "total_energy_required": round(total_route_energy_kwh, 3),
        "usable_energy_kwh":     round(usable, 3),
        "energy_deficit_kwh":    round(max(total_route_energy_kwh - usable, 0), 3),
        "arrival_soc":           round(
            ev_profile['soc_current'] - (total_route_energy_kwh /
            (ev_profile['battery_capacity_kwh'] * ev_profile['soh'])), 3
        )
    }
    return result
```

---

## 6. Component 5 — Charging Infrastructure (OpenChargeMap)

### 6.1 OpenChargeMap API

OpenChargeMap (OCM) is a global open-data registry of EV charging locations. It exposes a REST API.

**API Endpoint:**

```
https://api.openchargemap.io/v3/poi/
  ?output=json
  &key=YOUR_API_KEY
  &latitude=<lat>
  &longitude=<lon>
  &distance=<km>
  &distanceunit=KM
  &maxresults=50
  &statustype=50   (Operational only)
  &levelid=3       (DC Fast Charge = Level 3)
```

### 6.2 Fetching Charging Stations

```python
import requests

OCM_API_KEY = "YOUR_API_KEY"
OCM_BASE    = "https://api.openchargemap.io/v3/poi/"

def fetch_charging_stations(
    lat: float,
    lon: float,
    radius_km: float = 10.0,
    min_power_kw: float = 7.0
) -> list[dict]:
    """
    Returns list of charging stations within radius_km of (lat, lon).
    Filters by minimum power output.
    """
    params = {
        "output":       "json",
        "key":          OCM_API_KEY,
        "latitude":     lat,
        "longitude":    lon,
        "distance":     radius_km,
        "distanceunit": "KM",
        "maxresults":   100,
    }
    response = requests.get(OCM_BASE, params=params, timeout=10)
    stations = response.json()

    # Normalize & filter
    result = []
    for s in stations:
        conns = s.get("Connections", [])
        for c in conns:
            power_kw = c.get("PowerKW") or 0
            if power_kw >= min_power_kw:
                result.append({
                    "id":             s["ID"],
                    "name":           s.get("AddressInfo", {}).get("Title", "Unknown"),
                    "lat":            s["AddressInfo"]["Latitude"],
                    "lon":            s["AddressInfo"]["Longitude"],
                    "power_kw":       power_kw,
                    "connector_type": c.get("ConnectionType", {}).get("Title", "Unknown"),
                    "is_fast_charge": c.get("Level", {}).get("IsFastChargeCapable", False),
                    "status":         s.get("StatusType", {}).get("Title", "Unknown")
                })
    return result
```

### 6.3 Mapping Charging Stations to Graph Nodes

Each charging station must be mapped to its nearest road node in the OSMnx graph so the router can treat it as a waypoint.

```python
def map_stations_to_graph_nodes(stations: list, G) -> list:
    """Maps each charging station to the nearest OSMnx graph node."""
    enriched = []
    lons = [s['lon'] for s in stations]
    lats = [s['lat'] for s in stations]

    nearest_nodes = ox.nearest_nodes(G, X=lons, Y=lats)

    for station, node_id in zip(stations, nearest_nodes):
        station['graph_node_id'] = node_id
        node_data = G.nodes[node_id]
        station['graph_node_lat'] = node_data['y']
        station['graph_node_lon'] = node_data['x']
        enriched.append(station)

    return enriched
```

### 6.4 Charger Data Schema

```python
CHARGER_SCHEMA = {
    "id":                int,     # OCM station ID
    "name":              str,     # Station name/title
    "lat":               float,   # WGS84 latitude
    "lon":               float,   # WGS84 longitude
    "power_kw":          float,   # Charger output power (kW)
    "connector_type":    str,     # "CCS2", "CHAdeMO", "Type2", etc.
    "is_fast_charge":    bool,    # True = DC fast charge (Level 3, ≥40kW)
    "status":            str,     # "Operational", "Unknown", etc.
    "graph_node_id":     int,     # Nearest OSMnx node ID
    "charge_rate_kw":    float,   # Effective charge rate (min of station & EV limit)
}
```

### 6.5 Charge Time Estimation

```python
def estimate_charge_time(
    ev_profile:    dict,
    station_power: float,  # kW
    soc_from:      float,  # Current SOC
    soc_to:        float   # Target SOC after charging
) -> float:
    """Returns charging time in minutes."""
    eff_capacity     = ev_profile['battery_capacity_kwh'] * ev_profile['soh']
    energy_needed_kwh = eff_capacity * (soc_to - soc_from)

    # Effective charge rate = min(station power, vehicle max charge rate)
    effective_rate_kw = min(station_power, ev_profile['max_charge_rate_kw'])

    charge_time_hours = energy_needed_kwh / effective_rate_kw
    return round(charge_time_hours * 60, 1)  # → minutes
```

---

## 7. Component 6 — Routing Engine (A\* / Dijkstra)

### 7.1 Algorithm Selection

| Algorithm        | Use Case                                     | Complexity         | Notes                                            |
| ---------------- | -------------------------------------------- | ------------------ | ------------------------------------------------ |
| **Dijkstra**     | Single-source shortest (energy) path         | O((V+E) log V)     | Standard; handles positive weights               |
| **A\***          | When heuristic available (lat/lon Euclidean) | Faster in practice | Best for point-to-point                          |
| **Bellman-Ford** | Handles negative edges (downhill regen)      | O(V×E)             | Slower; needed if regen creates negative weights |
| **Johnson's**    | Eliminate negatives → re-apply Dijkstra      | O(V×E + V² log V)  | Pre-processing step                              |

**Recommendation for MVP:** Use Dijkstra with energy weights clamped to ≥ 0 (ignore regen in Phase 1). Add regen via Johnson's in Phase 2.

### 7.2 Dijkstra — Energy-Weighted Shortest Path

```python
def find_energy_optimal_route(
    G,
    origin_lat:   float, origin_lon:   float,
    dest_lat:     float, dest_lon:     float,
    weight_attr:  str = "energy_kwh"
) -> dict:
    """
    Finds the energy-optimal route from origin to destination.
    Returns node list, total distance (m), and total energy (kWh).
    """
    orig_node = ox.nearest_nodes(G, X=origin_lon, Y=origin_lat)
    dest_node = ox.nearest_nodes(G, X=dest_lon,   Y=dest_lat)

    try:
        route = nx.shortest_path(G, orig_node, dest_node, weight=weight_attr)
    except nx.NetworkXNoPath:
        return {"feasible": False, "error": "No path found between origin and destination"}

    # Compute route statistics
    total_energy_kwh = 0.0
    total_distance_m = 0.0

    for u, v in zip(route[:-1], route[1:]):
        best_edge = min(G[u][v].values(), key=lambda d: d.get(weight_attr, float('inf')))
        total_energy_kwh += best_edge.get('energy_kwh', 0)
        total_distance_m  += best_edge.get('length', 0)

    return {
        "route_nodes":       route,
        "total_energy_kwh":  round(total_energy_kwh, 3),
        "total_distance_km": round(total_distance_m / 1000, 2),
        "origin_node":       orig_node,
        "dest_node":         dest_node
    }
```

### 7.3 A\* with Energy Heuristic

```python
import math

def energy_heuristic(u, v, data):
    """
    Haversine-based energy lower bound heuristic for A*.
    Assumes flat terrain, minimal rolling resistance.
    Returns energy lower bound (kWh) between node u and destination v.
    """
    lat1, lon1 = data[u]['y'], data[u]['x']
    lat2, lon2 = data[v]['y'], data[v]['x']

    # Haversine distance (km)
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * \
        math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    dist_km = 2 * R * math.asin(math.sqrt(a))

    # Lower bound: flat road, 50 kph, 0.18 kWh/km
    return dist_km * 0.15  # Conservative estimate

route = nx.astar_path(G, orig_node, dest_node,
                      heuristic=lambda u,v: energy_heuristic(u, v, G.nodes),
                      weight="energy_kwh")
```

---

## 8. Component 7 — Decision Engine

### 8.1 Route Feasibility Decision Tree

```
INPUT: origin, destination, ev_profile
       │
       ▼
[Step 1] Compute energy-optimal route (Dijkstra/A*)
       │
       ▼
[Step 2] Compute total route energy
       │
       ├─ route_energy ≤ usable_energy?
       │      YES → Route FEASIBLE
       │             → Return route directly
       │
       └─ NO → Route INFEASIBLE without charging
                │
                ▼
          [Step 3] Find charging stations along corridor
                │
                ▼
          [Step 4] Insert charging stop(s) as waypoints
                │
                ▼
          [Step 5] Re-compute segmented route
                │
                ▼
          [Step 6] Validate each segment feasibility
                │
                ├─ All segments feasible?
                │    YES → Return multi-segment route + charge stops
                │
                └─ NO → No feasible route found
                         → Return: "Route not feasible with current battery"
```

### 8.2 Charging Stop Insertion Algorithm

```python
def insert_charging_stops(
    route_nodes: list,
    G,
    ev_profile:  dict,
    stations:    list   # Pre-fetched & mapped to graph nodes
) -> dict:
    """
    Inserts minimum required charging stops along route.
    Uses a greedy forward scan: charge only when necessary.
    """
    eff_capacity = ev_profile['battery_capacity_kwh'] * ev_profile['soh']
    current_soc  = ev_profile['soc_current']
    soc_reserve  = ev_profile['soc_min_reserve']
    segments     = []
    charging_stops = []

    # Build set of station graph nodes for quick lookup
    station_nodes = {s['graph_node_id']: s for s in stations}

    segment_start   = route_nodes[0]
    segment_energy  = 0.0

    for i in range(len(route_nodes) - 1):
        u, v = route_nodes[i], route_nodes[i + 1]
        best_edge   = min(G[u][v].values(), key=lambda d: d.get('energy_kwh', 0))
        edge_energy = best_edge.get('energy_kwh', 0)
        segment_energy += edge_energy

        soc_after_segment = current_soc - (segment_energy / eff_capacity)

        # Check if next node is a charging station and SOC is getting low
        threshold_soc = soc_reserve + 0.15  # Trigger charging with 15% buffer above reserve
        if soc_after_segment < threshold_soc and v in station_nodes:
            # Insert charging stop here
            station = station_nodes[v]

            # Determine how much to charge (top up to 80% — optimal for Li-ion)
            target_soc = min(0.80, 1.0)
            charge_time = estimate_charge_time(ev_profile, station['power_kw'], soc_after_segment, target_soc)

            charging_stops.append({
                "node":          v,
                "station":       station,
                "arrival_soc":   round(soc_after_segment, 3),
                "departure_soc": target_soc,
                "charge_time_min": charge_time
            })

            # Reset for next segment
            segments.append({
                "start_node":    segment_start,
                "end_node":      v,
                "energy_kwh":    round(segment_energy, 3)
            })
            segment_start  = v
            segment_energy = 0.0
            current_soc    = target_soc

    # Final segment
    segments.append({
        "start_node":  segment_start,
        "end_node":    route_nodes[-1],
        "energy_kwh":  round(segment_energy, 3)
    })

    return {
        "route_nodes":     route_nodes,
        "segments":        segments,
        "charging_stops":  charging_stops,
        "feasible":        True
    }
```

### 8.3 EV Recommendation Logic

The system can also recommend whether an EV is suitable for a given route:

```python
def recommend_ev_suitability(
    route_energy_kwh:  float,
    ev_catalog:        list[dict],
    trip_context:      dict
) -> list[dict]:
    """
    Ranks EVs in catalog by suitability for a given route.
    Considers: usable energy, charge stops needed, charging compatibility.
    """
    recommendations = []

    for ev in ev_catalog:
        usable = compute_usable_energy(ev)
        direct_feasible   = usable >= route_energy_kwh
        charge_stops_needed = max(0, math.ceil((route_energy_kwh - usable) /
                                   (ev['battery_capacity_kwh'] * ev['soh'] * 0.70)))

        recommendations.append({
            "model":              ev.get('model_id', 'Unknown'),
            "battery_kwh":        ev['battery_capacity_kwh'],
            "usable_energy_kwh":  round(usable, 2),
            "direct_feasible":    direct_feasible,
            "charge_stops":       charge_stops_needed,
            "suitability_score":  _score_ev(ev, route_energy_kwh, trip_context)
        })

    return sorted(recommendations, key=lambda x: x['suitability_score'], reverse=True)

def _score_ev(ev, required_kwh, context):
    usable = compute_usable_energy(ev)
    range_ratio = usable / required_kwh
    score = min(range_ratio, 2.0) * 50  # Max 100 from range
    if ev['max_charge_rate_kw'] >= 50:
        score += 20   # Bonus for fast charging
    if context.get('has_dcfc') and "CCS2" in ev.get('connector_types', []):
        score += 30   # Bonus for compatible fast charger
    return round(score, 1)
```

---

## 9. System Data Flow Pipeline

### 9.1 Complete Request-Response Flow

```
1. CLIENT REQUEST
   POST /api/route
   Body: {
       "origin": {"lat": 20.00, "lon": 73.78},
       "destination": {"lat": 19.99, "lon": 73.85},
       "ev_profile": { ...EV_PROFILE dict... }
   }

2. SERVER PROCESSING (in order):

   [2a] Load/retrieve pre-cached OSMnx graph for the region
        → If not cached: download graph, enrich with elevation & speed
        → Cache as GraphML

   [2b] Enrich graph edges with EV energy weights
        → Apply RouteE or physics model per edge
        → Uses ev_profile['mass_kg'], 'drag_coefficient', 'regen_efficiency'

   [2c] Compute usable energy from ev_profile
        → usable = battery_capacity × SOC × SOH − reserve

   [2d] Find energy-optimal route (Dijkstra)
        → weight="energy_kwh"

   [2e] Compute total route energy

   [2f] Feasibility check
        → If feasible: skip to step 2i
        → If not: proceed to 2g

   [2g] Fetch charging stations within route corridor (OpenChargeMap)
        → radius = max(5km, route_length / 10)

   [2h] Insert charging stops greedily
        → Select nearest compatible station before SOC depletes

   [2i] Simulate SOC trace along final route
        → Return SOC at each node

   [2j] Build response object

3. SERVER RESPONSE
   {
       "feasible": true,
       "route": {
           "geometry": [...GeoJSON coordinates...],
           "total_distance_km": 12.4,
           "total_energy_kwh": 2.18,
           "estimated_time_min": 16
       },
       "charging_stops": [
           {
               "station_name": "Nashik DC Charger",
               "lat": 20.01, "lon": 73.80,
               "arrival_soc": 0.18,
               "departure_soc": 0.80,
               "charge_time_min": 22,
               "power_kw": 50
           }
       ],
       "soc_trace": [
           {"node": 12345, "soc": 0.78},
           {"node": 12346, "soc": 0.74},
           ...
       ],
       "arrival_soc": 0.32
   }
```

---

## 10. API Design & Client-Server Architecture

### 10.1 REST API Endpoints

| Method | Endpoint            | Description                           |
| ------ | ------------------- | ------------------------------------- |
| `POST` | `/api/route`        | Primary route request with EV profile |
| `GET`  | `/api/stations`     | Fetch nearby charging stations        |
| `GET`  | `/api/ev/models`    | List available EV profiles            |
| `POST` | `/api/ev/recommend` | Recommend EV for a given route        |
| `GET`  | `/api/graph/status` | Graph cache status & coverage         |
| `GET`  | `/api/health`       | Server health check                   |

### 10.2 FastAPI Server Skeleton

```python
from fastapi import FastAPI
from pydantic import BaseModel
import osmnx as ox
import networkx as nx

app = FastAPI(title="EV Route Planner API")

# ── Startup: Load graph into memory
@app.on_event("startup")
async def startup():
    global G
    try:
        G = ox.load_graphml("nashik_ev.graphml")
        print("Graph loaded from cache.")
    except FileNotFoundError:
        G = ox.graph_from_place("Nashik, Maharashtra, India", network_type="drive")
        ox.save_graphml(G, filepath="nashik_ev.graphml")
        print("Graph downloaded and cached.")

# ── Request/Response Models
class LatLon(BaseModel):
    lat: float
    lon: float

class EVProfile(BaseModel):
    battery_capacity_kwh: float
    soc_current:          float
    soh:                  float = 1.0
    soc_min_reserve:      float = 0.10
    mass_kg:              float = 1800
    efficiency_kwh_km:    float = 0.18
    regen_efficiency:     float = 0.70
    max_charge_rate_kw:   float = 50.0
    connector_types:      list  = ["CCS2"]

class RouteRequest(BaseModel):
    origin:      LatLon
    destination: LatLon
    ev_profile:  EVProfile

@app.post("/api/route")
async def compute_route(request: RouteRequest):
    ev  = request.ev_profile.dict()
    org = (request.origin.lat, request.origin.lon)
    dst = (request.destination.lat, request.destination.lon)

    # (Full pipeline as described in Section 9)
    result = run_ev_routing_pipeline(G, org, dst, ev)
    return result
```

### 10.3 Technology Stack

| Layer            | Technology                      | Reason                               |
| ---------------- | ------------------------------- | ------------------------------------ |
| Graph Processing | OSMnx + NetworkX                | Industry standard for OSM graph work |
| Energy Modeling  | RouteE (NREL) / Custom          | Pre-trained BEV models               |
| Backend API      | FastAPI (Python)                | Async, auto-docs, type-safe          |
| Charging Data    | OpenChargeMap REST API          | Global open dataset                  |
| Data Storage     | GraphML (files) + Redis (cache) | Fast graph load; station cache       |
| Frontend         | React + Leaflet.js              | Interactive map                      |
| Routing DB       | PostGIS (future)                | Scalable spatial queries             |

---

## 11. Data Field Registry

### 11.1 EV Profile Fields

| Field                  | Type      | Unit   | Required | Notes                         |
| ---------------------- | --------- | ------ | -------- | ----------------------------- |
| `battery_capacity_kwh` | float     | kWh    | Yes      | Rated total capacity          |
| `soc_current`          | float     | 0–1    | Yes      | Current charge level          |
| `soh`                  | float     | 0–1    | Yes      | Health/degradation factor     |
| `soc_min_reserve`      | float     | 0–1    | No       | Default 0.10 (10%)            |
| `soc_target_arrival`   | float     | 0–1    | No       | Default 0.20                  |
| `efficiency_kwh_km`    | float     | kWh/km | Yes      | Base consumption              |
| `regen_efficiency`     | float     | 0–1    | No       | Regen braking capture         |
| `mass_kg`              | float     | kg     | Yes      | Vehicle + max payload         |
| `drag_coefficient`     | float     | —      | No       | Aerodynamic Cd                |
| `frontal_area_m2`      | float     | m²     | No       | Cross-section area            |
| `rolling_resistance`   | float     | —      | No       | µ coefficient                 |
| `max_charge_rate_kw`   | float     | kW     | Yes      | Vehicle onboard charger limit |
| `connector_types`      | list[str] | —      | Yes      | e.g., ["CCS2","Type2"]        |
| `model_id`             | str       | —      | No       | RouteE model key              |

### 11.2 Route Request Fields

| Field             | Type  | Required | Notes |
| ----------------- | ----- | -------- | ----- |
| `origin.lat`      | float | Yes      | WGS84 |
| `origin.lon`      | float | Yes      | WGS84 |
| `destination.lat` | float | Yes      | WGS84 |
| `destination.lon` | float | Yes      | WGS84 |

### 11.3 Graph Edge Fields (OSMnx + Enriched)

| Attribute     | Source        | Type      | Notes              |
| ------------- | ------------- | --------- | ------------------ |
| `length`      | OSMnx         | float (m) | Edge distance      |
| `speed_kph`   | OSMnx         | float     | Imputed speed      |
| `travel_time` | OSMnx         | float (s) | Pre-computed       |
| `grade`       | Elevation API | float     | Slope (rise/run)   |
| `highway`     | OSM tag       | str       | Road class         |
| `energy_kwh`  | Computed      | float     | **EV cost weight** |

### 11.4 Charging Station Fields (OpenChargeMap)

| Field            | Source   | Type  | Notes              |
| ---------------- | -------- | ----- | ------------------ |
| `id`             | OCM      | int   | Station ID         |
| `lat`, `lon`     | OCM      | float | WGS84 location     |
| `power_kw`       | OCM      | float | Output power       |
| `connector_type` | OCM      | str   | Standard           |
| `is_fast_charge` | OCM      | bool  | ≥40kW = Level 3    |
| `status`         | OCM      | str   | Operational?       |
| `graph_node_id`  | Computed | int   | Nearest OSMnx node |

### 11.5 Route Response Fields

| Field                      | Type              | Notes                    |
| -------------------------- | ----------------- | ------------------------ |
| `feasible`                 | bool              | Overall feasibility      |
| `route.geometry`           | GeoJSON           | Polyline for map display |
| `route.total_distance_km`  | float             | Total route length       |
| `route.total_energy_kwh`   | float             | Total energy consumed    |
| `route.estimated_time_min` | float             | Estimated drive time     |
| `charging_stops`           | list              | See charger schema       |
| `soc_trace`                | list[(node, soc)] | SOC at each node         |
| `arrival_soc`              | float             | SOC at destination       |

---

## 12. Implementation Roadmap

### Phase 1 — MVP (Weeks 1–4)

| Task                                           | Component | Output                        |
| ---------------------------------------------- | --------- | ----------------------------- |
| Download & cache OSMnx graph for target region | Graph     | `.graphml` file               |
| Implement physics-based energy model           | Energy    | `compute_edge_energy()`       |
| Annotate graph edges with energy weights       | Graph     | Enriched `G`                  |
| Dijkstra on energy-weighted graph              | Routing   | `route_nodes`, `total_energy` |
| SOC feasibility check                          | Decision  | `is_route_feasible()`         |
| FastAPI server with `/api/route` endpoint      | API       | Working REST API              |
| Basic React + Leaflet map frontend             | Frontend  | Route display                 |

### Phase 2 — Charging Integration (Weeks 5–8)

| Task                                       | Component | Output                  |
| ------------------------------------------ | --------- | ----------------------- |
| OpenChargeMap API integration              | Charging  | Station fetch & cache   |
| Map stations to graph nodes                | Charging  | `station.graph_node_id` |
| Charging stop insertion algorithm          | Decision  | Multi-segment routes    |
| SOC simulation trace                       | Battery   | `soc_trace` per route   |
| Elevation download (Google/Open-Elevation) | Graph     | `grade` attributes      |

### Phase 3 — ML & Optimization (Weeks 9–16)

| Task                                       | Component    | Output                   |
| ------------------------------------------ | ------------ | ------------------------ |
| RouteE model integration                   | Energy       | Accurate BEV predictions |
| Regenerative braking (negative edges)      | Routing      | Johnson's preprocessing  |
| A\* with energy heuristic                  | Routing      | Faster route computation |
| SOH degradation modeling                   | Battery      | Dynamic SOH estimation   |
| Multi-stop optimization (k charging stops) | Decision     | Optimal charging plan    |
| EV recommendation engine                   | Decision     | Ranked EV catalog        |
| Redis caching (graph + stations)           | Architecture | Sub-second responses     |

---

## 13. Known Problems & Solutions

### Problem 1: Negative Edge Weights from Regenerative Braking

**Problem:** Downhill segments can have negative energy costs (regen recovery). Dijkstra fails with negative weights.

**Solutions:**

- **Option A (Simple):** Clamp all edge energies to ≥ 0 in Phase 1. Ignore regen.
- **Option B (Accurate):** Use Johnson's algorithm — shift edge weights by potential function to eliminate negatives, run Dijkstra on shifted graph.
- **Option C (Exact):** Bellman-Ford — handles negatives natively but slower O(V×E).

**Decision:** Start with Option A. Implement Option B in Phase 3.

### Problem 2: Large Graph Memory Usage

**Problem:** Downloading city-scale graphs consumes significant RAM (e.g., Mumbai graph = ~2 GB).

**Solutions:**

- Tile-based graph loading — load only the subgraph within the bounding box of origin→destination + buffer.
- Pre-simplify graph using `ox.simplify_graph()` — removes degree-2 nodes.
- Store as GraphML, load lazily.

### Problem 3: Charging Station Data Quality

**Problem:** OpenChargeMap data has inconsistent power ratings, stale availability, and missing connector types.

**Solutions:**

- Filter by `status = "Operational"` only.
- Add fallback: scan OSM for `amenity=charging_station` tags.
- Cache station data with 24-hour TTL.
- Add `availability` field as best-effort (real-time data requires network operator APIs).

### Problem 4: Route Infeasible With No Charging Stations

**Problem:** EV cannot complete route but no charging stations exist along corridor.

**Solution:** Return infeasibility report with:

- Energy deficit (kWh short)
- Furthest reachable point
- Nearest charging station beyond max range
- Recommendation: charge to higher SOC before departing

### Problem 5: Graph Elevation Data Missing

**Problem:** Many OSM roads lack elevation tags. Without elevation, grade = 0 for all edges (inaccurate for hilly terrain like Nashik region).

**Solution:**

- Use Google Elevation API (paid, accurate) for production.
- Use SRTM (Shuttle Radar Topography Mission) free 30m DEM data for development.
- Add fallback: `grade = 0` with warning flag in response.

---

## 14. Open Questions

1. **Temperature modeling:** Should ambient temperature affect energy consumption? (HVAC load, battery efficiency) — Not yet modeled.

2. **Traffic conditions:** OSMnx uses static speed limits. Real-time traffic (Google Maps API, HERE) would improve energy estimates significantly.

3. **Multiple EV types:** How to handle fleet routing where different vehicles have different connectors? — Catalog approach planned.

4. **SOH input source:** Who provides SOH? The EV's OBD2/BMS system? Manual user input? — Requires OBD2 integration in future.

5. **Charging station real-time availability:** OCM does not provide live slot availability. Should integrate network operator APIs (ChargePoint, EVGO) in Phase 3.

6. **Partial charging strategy:** Current model charges to 80% at each stop. Should optimize charge amount per stop to minimize total trip time (dynamic programming problem).

7. **Bidirectionality:** Some roads are modeled as two separate directed edges. Regen recovery modeled per-direction — confirm graph edge direction is correct.

8. **Graph refresh frequency:** OSM data changes. How often should the graph be re-downloaded and re-enriched?

---

_Document Version: 1.0 | Generated: 2026-03-18 | System: EV Route Planner_
