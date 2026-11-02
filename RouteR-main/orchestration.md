# ORCHESTRATOR.md

## Antigravity AI — System Orchestrator Design Directive

### Distributed Coordination, Caching, Prefetching & Seamless Service Integration

> **Purpose:** This document instructs the AI Orchestrator how to coordinate all Antigravity AI services — Graph Manager, Energy Bridge, Battery Module, Charger Client, Router, and Decision Engine — into a seamless, fault-tolerant, real-time pipeline. Every pattern here is chosen specifically for EV routing workloads.

---

## TABLE OF CONTENTS

1. [Orchestrator Role & Responsibility Model](#1-orchestrator-role--responsibility-model)
2. [Service Registry & Dependency Map](#2-service-registry--dependency-map)
3. [Caching Architecture — Three-Layer Strategy](#3-caching-architecture--three-layer-strategy)
4. [Early Fetching & Prefetch Patterns](#4-early-fetching--prefetch-patterns)
5. [Circuit Breaker Pattern — Per-Service](#5-circuit-breaker-pattern--per-service)
6. [Saga Pattern — Distributed Route Transaction](#6-saga-pattern--distributed-route-transaction)
7. [Retry & Timeout Policy Registry](#7-retry--timeout-policy-registry)
8. [Bulkhead Isolation — Resource Partitioning](#8-bulkhead-isolation--resource-partitioning)
9. [Event-Driven Coordination — Async Hooks](#9-event-driven-coordination--async-hooks)
10. [Health & Observability Contract](#10-health--observability-contract)
11. [Graceful Degradation Playbook](#11-graceful-degradation-playbook)
12. [Orchestrator State Machine](#12-orchestrator-state-machine)
13. [Complete Python Orchestrator Implementation](#13-complete-python-orchestrator-implementation)
14. [Environment Configuration Reference](#14-environment-configuration-reference)

---

## 1. Orchestrator Role & Responsibility Model

### 1.1 What the Orchestrator Is

The Orchestrator is the **central nervous system** of the Antigravity AI backend. It does not perform business logic itself — it coordinates when, in what order, and under what conditions each service is called. It is the only component that understands the full request lifecycle from API entry to JSON response.

```
CLIENT REQUEST
      │
      ▼
 ┌────────────────────────────────────────────────────┐
 │              ORCHESTRATOR                          │
 │                                                    │
 │  ┌─────────┐ ┌──────────┐ ┌──────────────────────┐│
 │  │ Service  │ │  Cache   │ │  Circuit             ││
 │  │ Registry │ │  Layer   │ │  Breakers            ││
 │  └─────────┘ └──────────┘ └──────────────────────┘│
 │                                                    │
 │  Calls services in dependency order with:          │
 │  • cache-aside reads before every service call     │
 │  • circuit breaker protection on every external    │
 │  • prefetch triggers on partial response receipt   │
 │  • saga compensation on any mid-pipeline failure   │
 └──────────────────────┬─────────────────────────────┘
                        │
          ┌─────────────┼──────────────┐
          ▼             ▼              ▼
    GraphManager  EnergyBridge   ChargerClient
    BatteryModule    Router     DecisionEngine
```

### 1.2 Orchestrator Laws — Non-Negotiable Rules

These rules must never be violated, regardless of load or shortcuts:

| Law                           | Rule                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| **L1 — Cache First**          | Every service call is preceded by a cache lookup. Services are called only on cache miss.   |
| **L2 — Fail Fast**            | No call waits longer than its configured timeout. Partial results are better than timeouts. |
| **L3 — Degrade, Never Crash** | Any single service failure must produce a degraded response, not a 500 error.               |
| **L4 — Compensate Always**    | Any mid-pipeline failure triggers rollback of all side effects via saga compensation.       |
| **L5 — Prefetch Forward**     | When Step N completes, the orchestrator immediately triggers prefetch for Step N+2.         |
| **L6 — Observe Everything**   | Every service call emits: duration_ms, cache_hit (bool), service_name, status.              |

---

## 2. Service Registry & Dependency Map

### 2.1 Service Definitions

```python
# orchestrator/registry.py

SERVICE_REGISTRY = {

    "graph_manager": {
        "module":       "core.graph_manager",
        "function":     "get_graph",
        "timeout_s":    5.0,          # Cache load. 90s if download needed (startup only)
        "cache_key":    "graph:{region}",
        "cache_ttl":    None,         # Graph lives for server lifetime — no TTL
        "cache_layer":  "memory",     # In-process memory only (graph is large)
        "circuit_breaker": False,     # Internal — no external call after startup
        "prefetch":     True,         # Pre-warm on server start
        "priority":     0,            # Must complete before ANY other service
    },

    "energy_bridge": {
        "module":       "core.energy_bridge",
        "function":     "enrich_full_graph",
        "timeout_s":    60.0,         # Batch RouteE prediction at startup
        "cache_key":    "energy_graph:{region}:{vehicle_class}",
        "cache_ttl":    None,         # Enriched graph persists for server lifetime
        "cache_layer":  "memory",
        "circuit_breaker": False,     # RouteE runs locally — no HTTP call
        "prefetch":     True,         # Runs immediately after graph_manager
        "priority":     1,
    },

    "charger_client": {
        "module":       "core.charger_client",
        "function":     "fetch_stations_along_corridor",
        "timeout_s":    8.0,          # OCM API call
        "cache_key":    "stations:{lat3}:{lon3}:{radius}",
        "cache_ttl":    86_400,       # 24 hours
        "cache_layer":  "disk",       # JSON file cache
        "circuit_breaker": True,      # External HTTP — needs protection
        "cb_fail_max":  3,            # Open after 3 consecutive failures
        "cb_reset_s":   60,           # Try again after 60 seconds
        "fallback":     "stale_cache",# Serve stale data if API down
        "prefetch":     True,         # Pre-warm when origin+destination known
        "priority":     2,
    },

    "router": {
        "module":       "core.router",
        "function":     "find_route",
        "timeout_s":    2.0,          # Dijkstra on in-memory graph
        "cache_key":    "route:{orig_node}:{dest_node}:{vehicle_class}",
        "cache_ttl":    300,          # 5 minutes — routes change with graph updates
        "cache_layer":  "memory",
        "circuit_breaker": False,
        "prefetch":     False,        # Requires both origin + destination
        "priority":     3,
    },

    "battery_module": {
        "module":       "core.battery",
        "function":     "simulate_soc_trace",
        "timeout_s":    0.5,          # Pure computation — should be instant
        "cache_key":    "soc:{route_hash}:{soc}:{soh}:{capacity}",
        "cache_ttl":    60,           # 1 minute — SOC changes constantly
        "cache_layer":  "memory",
        "circuit_breaker": False,
        "prefetch":     False,
        "priority":     4,
    },

    "decision_engine": {
        "module":       "core.decision_engine",
        "function":     "process_route_request",
        "timeout_s":    10.0,         # Full pipeline including charging insertion
        "cache_key":    "decision:{route_hash}:{battery_hash}",
        "cache_ttl":    120,          # 2 minutes
        "cache_layer":  "memory",
        "circuit_breaker": False,
        "prefetch":     False,
        "priority":     5,
    },
}
```

### 2.2 Dependency Graph

```
graph_manager (P0)
       │
       ▼
energy_bridge (P1) ◄──── RouteE (local ML model, no HTTP)
       │
       ├──────────────────────────────────┐
       ▼                                  ▼
   router (P3)                    charger_client (P2)
       │                                  │
       │         battery_module (P4)      │
       │                │                 │
       └────────────────┼─────────────────┘
                        ▼
               decision_engine (P5)
                        │
                        ▼
                  JSON Response
```

**Dependency rules for the orchestrator:**

- `energy_bridge` cannot start until `graph_manager` completes
- `router` and `charger_client` can run **in parallel** after `energy_bridge` completes
- `battery_module` requires `router` output (route_nodes)
- `decision_engine` requires ALL of: router + charger_client + battery_module

---

## 3. Caching Architecture — Three-Layer Strategy

The orchestrator manages three cache layers with different speed, capacity, and TTL characteristics.

```
REQUEST
  │
  ▼
Layer 1: MEMORY CACHE (Python dict / LRU)
  │       Speed: ~0.01ms  │  Capacity: 500MB max  │  TTL: varies
  │       Contents: enriched graph, recent routes, SOC traces
  │
  ├── HIT → return immediately
  │
  └── MISS
        │
        ▼
      Layer 2: DISK CACHE (JSON files)
        │       Speed: ~5ms  │  Capacity: 2GB max  │  TTL: 24h (stations)
        │       Contents: OpenChargeMap station data, graph snapshots
        │
        ├── HIT + not expired → load, promote to L1, return
        │
        └── MISS or EXPIRED
              │
              ▼
            Layer 3: EXTERNAL SERVICES
                      Speed: 50–2000ms  │  Sources: OCM API, OSM Overpass, Google Elevation
                      │
                      └── Response → write to L2 disk → write to L1 memory → return
```

### 3.1 Cache Manager Implementation

```python
# orchestrator/cache_manager.py

import os
import json
import time
import hashlib
import functools
from collections import OrderedDict
from typing import Any, Optional

class MemoryCache:
    """
    LRU in-process memory cache.
    Used for: enriched graph, route results, SOC traces.
    Thread-safe via GIL for read-heavy workloads.
    """
    def __init__(self, max_size: int = 256):
        self._store: OrderedDict = OrderedDict()
        self._max   = max_size

    def get(self, key: str) -> Optional[tuple]:
        """Returns (value, age_seconds) or None on miss."""
        if key not in self._store:
            return None
        value, stored_at, ttl = self._store[key]
        age = time.time() - stored_at
        if ttl and age > ttl:
            del self._store[key]
            return None
        self._store.move_to_end(key)   # LRU refresh
        return value, age

    def set(self, key: str, value: Any, ttl: Optional[int] = None):
        if key in self._store:
            self._store.move_to_end(key)
        self._store[key] = (value, time.time(), ttl)
        if len(self._store) > self._max:
            self._store.popitem(last=False)  # evict oldest

    def invalidate(self, prefix: str):
        """Invalidate all keys matching a prefix."""
        keys = [k for k in self._store if k.startswith(prefix)]
        for k in keys:
            del self._store[k]


class DiskCache:
    """
    JSON file-based disk cache.
    Used for: OpenChargeMap station data (large, 24h TTL).
    """
    def __init__(self, cache_dir: str = "cache/"):
        os.makedirs(cache_dir, exist_ok=True)
        self._dir = cache_dir

    def _path(self, key: str) -> str:
        safe = hashlib.md5(key.encode()).hexdigest()
        return os.path.join(self._dir, f"{safe}.json")

    def get(self, key: str, ttl: int = 86_400) -> Optional[Any]:
        path = self._path(key)
        if not os.path.exists(path):
            return None
        age = time.time() - os.path.getmtime(path)
        if age > ttl:
            return None          # Expired
        with open(path) as f:
            return json.load(f)

    def set(self, key: str, value: Any):
        with open(self._path(key), 'w') as f:
            json.dump(value, f)

    def get_stale(self, key: str) -> Optional[Any]:
        """Return data even if expired — used as fallback when API is down."""
        path = self._path(key)
        if not os.path.exists(path):
            return None
        with open(path) as f:
            return json.load(f)


# ── Singleton instances shared across orchestrator
_L1 = MemoryCache(max_size=512)
_L2 = DiskCache(cache_dir="cache/")

def cache_get(key: str, ttl: Optional[int] = None) -> Optional[Any]:
    """
    Unified two-layer read:
    1. Check L1 memory
    2. Check L2 disk (promote to L1 on hit)
    """
    result = _L1.get(key)
    if result:
        value, _ = result
        return value

    value = _L2.get(key, ttl=ttl or 86_400)
    if value is not None:
        _L1.set(key, value, ttl=ttl)   # Promote to L1
        return value
    return None

def cache_set(key: str, value: Any, ttl: Optional[int] = None, layers: list = ['memory']):
    """Write to specified cache layers."""
    if 'memory' in layers:
        _L1.set(key, value, ttl=ttl)
    if 'disk' in layers:
        _L2.set(key, value)

def cache_get_stale(key: str) -> Optional[Any]:
    """Get stale disk cache — used only in fallback scenarios."""
    return _L2.get_stale(key)
```

### 3.2 Cache Key Construction

```python
# orchestrator/cache_keys.py

import hashlib

def graph_key(region: str) -> str:
    return f"graph:{region.lower().replace(' ', '_').replace(',', '')}"

def energy_graph_key(region: str, vehicle_class: str) -> str:
    return f"energy_graph:{region}:{vehicle_class}"

def stations_key(lat: float, lon: float, radius_km: float) -> str:
    return f"stations:{round(lat,3)}:{round(lon,3)}:{radius_km}"

def route_key(orig_node: int, dest_node: int, vehicle_class: str) -> str:
    return f"route:{orig_node}:{dest_node}:{vehicle_class}"

def soc_key(route_nodes: list, soc: float, soh: float, capacity: float) -> str:
    route_hash = hashlib.md5(str(route_nodes).encode()).hexdigest()[:8]
    return f"soc:{route_hash}:{round(soc,2)}:{round(soh,2)}:{capacity}"

def decision_key(route_nodes: list, soc: float, soh: float, capacity: float) -> str:
    route_hash = hashlib.md5(str(route_nodes).encode()).hexdigest()[:8]
    battery_hash = f"{round(soc,2)}:{round(soh,2)}:{capacity}"
    return f"decision:{route_hash}:{battery_hash}"
```

---

## 4. Early Fetching & Prefetch Patterns

### 4.1 What "Early Fetch" Means for EV Routing

The read-ahead cache pattern, also known as prefetching, involves proactively loading data into the cache before it is explicitly requested — anticipating future reads to reduce latency when the data is later needed.

In Antigravity AI, there are three prefetch opportunities:

| Trigger           | Prefetch Action                              | Saves                              |
| ----------------- | -------------------------------------------- | ---------------------------------- |
| Server startup    | Download + enrich graph, load RouteE models  | 60s startup delay on first request |
| Origin pin on map | Fetch charging stations near origin corridor | ~500ms station fetch at route time |
| Route computed    | Pre-compute alternate routes (± 20% energy)  | Cold cache on "try another route"  |

### 4.2 Startup Prefetch Pipeline

```python
# orchestrator/prefetch.py

import asyncio
from core.graph_manager   import get_graph, add_elevation_to_graph
from core.energy_bridge   import enrich_full_graph
from core.charger_client  import fetch_stations_along_corridor
from orchestrator.cache_manager import cache_set
import os

async def run_startup_prefetch(region: str, vehicle_class: str = "default_bev") -> dict:
    """
    STARTUP PREFETCH SEQUENCE
    ─────────────────────────
    Runs once at server start. No requests served until this completes.
    Returns status dict for /api/health endpoint.

    Timeline (typical):
      [0s]   graph cache check
      [0–2s] graph load from disk (or 60s download on first run)
      [2–5s] elevation enrichment (if API key present)
      [5–45s] RouteE batch enrichment (city graph ~30s)
      [45s]  server ready
    """
    status = {
        "graph":     {"status": "pending", "nodes": 0, "edges": 0},
        "elevation": {"status": "skipped"},
        "energy":    {"status": "pending", "coverage_pct": 0},
        "stations":  {"status": "pending"},
    }

    # ── Step 1: Graph
    print("[Prefetch] Loading graph...")
    G = get_graph(region)
    status["graph"]["status"] = "ready"
    status["graph"]["nodes"]  = G.number_of_nodes()
    status["graph"]["edges"]  = G.number_of_edges()

    # ── Step 2: Elevation (non-blocking if key missing)
    google_key = os.getenv("GOOGLE_ELEVATION_API_KEY")
    if google_key:
        try:
            G = add_elevation_to_graph(G, api_key=google_key)
            status["elevation"]["status"] = "ready"
        except Exception as e:
            status["elevation"]["status"] = f"degraded: {e}"
            print(f"[Prefetch] Elevation failed — grade defaults to 0.0: {e}")
    else:
        status["elevation"]["status"] = "skipped (no API key)"
        print("[Prefetch] No elevation key — grade=0.0 fallback active")

    # ── Step 3: RouteE Energy Enrichment (the expensive step)
    print("[Prefetch] Running RouteE enrichment (batch predict)...")
    G = enrich_full_graph(G, vehicle_class=vehicle_class)
    coverage = sum(1 for _,_,d in G.edges(data=True) if 'energy_kwh' in d)
    coverage_pct = (coverage / G.number_of_edges()) * 100
    status["energy"]["status"]       = "ready"
    status["energy"]["coverage_pct"] = round(coverage_pct, 1)

    # ── Step 4: Store enriched graph in L1 cache for lifetime
    cache_set(f"graph:{region}",  G,  ttl=None, layers=['memory'])
    cache_set(f"energy_graph:{region}:{vehicle_class}", G, ttl=None, layers=['memory'])

    # ── Step 5: Background prefetch of station data for region centroid
    asyncio.create_task(_prefetch_stations_background(G, region))
    status["stations"]["status"] = "prefetching (background)"

    return status, G


async def _prefetch_stations_background(G, region: str):
    """
    Warm the station cache for the region centroid.
    Runs as a background task — doesn't block server readiness.
    """
    import osmnx as ox
    centroid_node = list(G.nodes())[len(G.nodes()) // 2]
    centroid_lat  = G.nodes[centroid_node]['y']
    centroid_lon  = G.nodes[centroid_node]['x']

    print(f"[Prefetch] Background: warming station cache for region centroid...")
    try:
        stations = fetch_stations_along_corridor(
            [centroid_node], G, radius_km=15.0
        )
        print(f"[Prefetch] Station cache warm: {len(stations)} stations loaded")
    except Exception as e:
        print(f"[Prefetch] Background station prefetch failed: {e}")


async def prefetch_stations_for_route(
    origin_lat: float, origin_lon: float,
    dest_lat: float, dest_lon: float,
    G,
    radius_km: float = 10.0
):
    """
    EARLY FETCH: Triggered as soon as origin + destination are known,
    BEFORE the route is computed. By the time routing finishes (~100ms),
    the station data is already cached.

    Call this immediately when the route request arrives:
        asyncio.create_task(prefetch_stations_for_route(...))
        route = await compute_route(...)   ← runs in parallel
    """
    from orchestrator.cache_manager import stations_key, cache_get
    key = stations_key(
        (origin_lat + dest_lat) / 2,
        (origin_lon + dest_lon) / 2,
        radius_km
    )
    if cache_get(key, ttl=86_400) is not None:
        return  # Already cached — nothing to do

    try:
        # Simulate mid-point corridor node
        import osmnx as ox
        mid_node  = ox.nearest_nodes(G,
            X=(origin_lon + dest_lon) / 2,
            Y=(origin_lat + dest_lat) / 2
        )
        fetch_stations_along_corridor([mid_node], G, radius_km=radius_km)
    except Exception as e:
        print(f"[EarlyFetch] Station prefetch failed silently: {e}")
```

---

## 5. Circuit Breaker Pattern — Per-Service

The circuit breaker prevents cascading failures by monitoring calls to downstream services and stopping requests when failures are detected — transitioning through Closed (normal), Open (blocking), and Half-Open (testing recovery) states.

For Antigravity AI, only **external HTTP services** get circuit breakers. Internal services (RouteE, Dijkstra, battery math) run locally and never need circuit protection.

```
External services needing circuit breakers:
  ✓ OpenChargeMap REST API     — charger_client
  ✓ Google Elevation API       — graph_manager (elevation step)
  ✗ RouteE (local library)     — no HTTP, no circuit needed
  ✗ OSMnx (post-startup)       — graph loaded from file cache
  ✗ Dijkstra router            — pure in-memory computation
```

### 5.1 Circuit Breaker Implementation

```python
# orchestrator/circuit_breaker.py

import time
import asyncio
from enum import Enum
from dataclasses import dataclass, field
from typing import Callable, Any, Optional

class CBState(Enum):
    CLOSED    = "closed"     # Normal — requests flow through
    OPEN      = "open"       # Failing — requests blocked immediately
    HALF_OPEN = "half_open"  # Testing — one probe request allowed

@dataclass
class CircuitBreakerConfig:
    name:          str
    fail_max:      int   = 3      # Failures before opening
    reset_timeout: float = 60.0  # Seconds before half-open attempt
    success_threshold: int = 2   # Successes in half-open before closing


class CircuitBreaker:
    """
    Per-service circuit breaker.
    Tracks failure counts and manages state transitions.
    Thread-safe for async FastAPI workers.
    """
    def __init__(self, config: CircuitBreakerConfig):
        self.cfg           = config
        self.state         = CBState.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.last_failure  = 0.0
        self._lock         = asyncio.Lock()

    async def call(self, fn: Callable, *args, fallback: Callable = None, **kwargs) -> Any:
        async with self._lock:
            if self.state == CBState.OPEN:
                # Check if reset timeout has elapsed
                if time.time() - self.last_failure >= self.cfg.reset_timeout:
                    self.state = CBState.HALF_OPEN
                    print(f"[CB:{self.cfg.name}] → HALF_OPEN (probing)")
                else:
                    # Still open — use fallback or raise
                    if fallback:
                        return await fallback(*args, **kwargs)
                    raise CircuitBreakerOpenError(
                        f"Circuit {self.cfg.name} is OPEN. "
                        f"Retry in {self.cfg.reset_timeout - (time.time()-self.last_failure):.0f}s"
                    )

        try:
            result = await asyncio.wait_for(
                asyncio.coroutine(fn)(*args, **kwargs)
                if not asyncio.iscoroutinefunction(fn)
                else fn(*args, **kwargs),
                timeout=30.0
            )
            await self._on_success()
            return result

        except Exception as e:
            await self._on_failure(e)
            if fallback:
                return await fallback(*args, **kwargs)
            raise

    async def _on_success(self):
        async with self._lock:
            if self.state == CBState.HALF_OPEN:
                self.success_count += 1
                if self.success_count >= self.cfg.success_threshold:
                    self.state         = CBState.CLOSED
                    self.failure_count = 0
                    self.success_count = 0
                    print(f"[CB:{self.cfg.name}] → CLOSED (recovered)")
            elif self.state == CBState.CLOSED:
                self.failure_count = 0   # Reset on success

    async def _on_failure(self, exc: Exception):
        async with self._lock:
            self.failure_count += 1
            self.last_failure   = time.time()
            print(f"[CB:{self.cfg.name}] Failure {self.failure_count}/{self.cfg.fail_max}: {exc}")

            if self.failure_count >= self.cfg.fail_max or self.state == CBState.HALF_OPEN:
                self.state = CBState.OPEN
                print(f"[CB:{self.cfg.name}] → OPEN (tripped)")

    @property
    def is_open(self) -> bool:
        return self.state == CBState.OPEN

    def status_dict(self) -> dict:
        return {
            "name":          self.cfg.name,
            "state":         self.state.value,
            "failures":      self.failure_count,
            "last_failure":  self.last_failure,
        }


class CircuitBreakerOpenError(Exception):
    pass


# ── Circuit breaker registry — one instance per external service
BREAKERS = {
    "ocm_api": CircuitBreaker(CircuitBreakerConfig(
        name="ocm_api", fail_max=3, reset_timeout=60.0
    )),
    "google_elevation": CircuitBreaker(CircuitBreakerConfig(
        name="google_elevation", fail_max=2, reset_timeout=120.0
    )),
}
```

### 5.2 Protected External Call Wrappers

```python
# orchestrator/protected_calls.py

from orchestrator.circuit_breaker import BREAKERS
from orchestrator.cache_manager   import cache_get, cache_set, cache_get_stale
from orchestrator.cache_keys       import stations_key
import asyncio

async def fetch_stations_protected(route_nodes, G, radius_km=8.0) -> list:
    """
    Fetches charging stations with:
    1. L1/L2 cache lookup first
    2. Circuit breaker protection on OCM API call
    3. Stale cache fallback if API is down
    """
    key = stations_key(
        G.nodes[route_nodes[len(route_nodes)//2]]['y'],
        G.nodes[route_nodes[len(route_nodes)//2]]['x'],
        radius_km
    )

    # Layer 1: Fresh cache
    cached = cache_get(key, ttl=86_400)
    if cached is not None:
        return cached

    # Layer 2: Protected live fetch
    from core.charger_client import fetch_stations_along_corridor

    try:
        stations = await BREAKERS["ocm_api"].call(
            fetch_stations_along_corridor,
            route_nodes, G,
            fallback=lambda *a, **kw: _station_stale_fallback(key)
        )
        cache_set(key, stations, ttl=86_400, layers=['memory', 'disk'])
        return stations

    except Exception as e:
        print(f"[ProtectedCall] OCM fetch failed: {e}")
        stale = cache_get_stale(key)
        if stale:
            print(f"[ProtectedCall] Serving stale station data")
            return stale
        return []   # Empty — decision engine handles gracefully


async def _station_stale_fallback(cache_key: str) -> list:
    stale = cache_get_stale(cache_key)
    return stale or []
```

---

## 6. Saga Pattern — Distributed Route Transaction

A saga orchestrator manages the entire transaction sequence, telling each service what operation to perform. This provides better visibility and control. If any step fails, the orchestrator triggers compensating actions on services that completed their part.

The route computation is a **distributed transaction** across 5 services. If any step fails, we must undo side effects.

### 6.1 Route Computation Saga

```python
# orchestrator/saga.py

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

@dataclass
class SagaStep:
    name:        str
    execute:     Callable
    compensate:  Callable           # Rollback function
    result:      Any       = None
    completed:   bool      = False
    error:        Optional[Exception] = None


class RouteSaga:
    """
    Orchestration-based saga for the EV route computation pipeline.

    Steps:
      1. resolve_nodes         → Map lat/lon to graph nodes
      2. compute_route         → Dijkstra shortest path
      3. compute_route_stats   → Energy, distance, time
      4. check_soc_feasibility → Battery gate
      5. fetch_stations        → OCM with circuit breaker
      6. insert_charging_stops → Greedy algorithm
      7. simulate_soc_trace    → Per-node SOC

    Compensations are defined for any step that has side effects.
    For read-only steps (like Dijkstra), compensation is a no-op.
    """

    def __init__(self, request_id: str = None):
        self.saga_id   = request_id or str(uuid.uuid4())[:8]
        self.steps:    list[SagaStep] = []
        self.context:  dict = {}
        self.failed_at: Optional[str] = None

    def add_step(self, name, execute, compensate=None):
        self.steps.append(SagaStep(
            name       = name,
            execute    = execute,
            compensate = compensate or (lambda ctx: None)
        ))
        return self

    async def run(self) -> dict:
        print(f"[Saga:{self.saga_id}] Starting route computation saga")
        completed_steps = []

        for step in self.steps:
            try:
                print(f"[Saga:{self.saga_id}] Executing: {step.name}")
                step.result    = await step.execute(self.context)
                step.completed = True
                self.context[step.name] = step.result
                completed_steps.append(step)

            except Exception as e:
                step.error   = e
                self.failed_at = step.name
                print(f"[Saga:{self.saga_id}] FAILED at {step.name}: {e}")

                # Run compensations in reverse order
                for done_step in reversed(completed_steps):
                    try:
                        print(f"[Saga:{self.saga_id}] Compensating: {done_step.name}")
                        await done_step.compensate(self.context)
                    except Exception as comp_err:
                        print(f"[Saga:{self.saga_id}] Compensation failed for {done_step.name}: {comp_err}")

                return {
                    "success":    False,
                    "failed_at":  self.failed_at,
                    "error":      str(e),
                    "saga_id":    self.saga_id
                }

        print(f"[Saga:{self.saga_id}] Completed successfully")
        return {
            "success": True,
            "context": self.context,
            "saga_id": self.saga_id
        }
```

### 6.2 Building the Route Saga

```python
# orchestrator/route_pipeline.py

async def build_route_saga(G, request, battery) -> RouteSaga:
    """Constructs the saga with all steps and their compensation functions."""
    saga = RouteSaga()

    saga.add_step(
        name="resolve_nodes",
        execute=async_wrap(lambda ctx: {
            "orig_node": ox.nearest_nodes(G,
                X=request.origin.lon, Y=request.origin.lat),
            "dest_node": ox.nearest_nodes(G,
                X=request.destination.lon, Y=request.destination.lat),
        }),
        compensate=lambda ctx: None   # Read-only — no side effects
    )

    saga.add_step(
        name="compute_route",
        execute=async_wrap(lambda ctx: find_route(
            G,
            ctx["resolve_nodes"]["orig_node"],
            ctx["resolve_nodes"]["dest_node"],
        )),
        compensate=lambda ctx: None   # Read-only
    )

    saga.add_step(
        name="compute_route_stats",
        execute=async_wrap(lambda ctx: compute_route_stats(
            ctx["compute_route"], G
        )),
        compensate=lambda ctx: None
    )

    saga.add_step(
        name="check_soc_feasibility",
        execute=async_wrap(lambda ctx: {
            "feasible": battery.is_feasible(
                ctx["compute_route_stats"]["total_energy_kwh"]
            ),
            "usable_kwh": battery.usable_energy,
        }),
        compensate=lambda ctx: None
    )

    saga.add_step(
        name="fetch_stations",
        execute=lambda ctx: fetch_stations_protected(
            ctx["compute_route"], G
        ),
        compensate=lambda ctx: None   # No write side effects
    )

    saga.add_step(
        name="insert_charging_stops",
        execute=async_wrap(lambda ctx: _insert_stops_if_needed(ctx, G, battery, request)),
        compensate=lambda ctx: None
    )

    saga.add_step(
        name="simulate_soc_trace",
        execute=async_wrap(lambda ctx: simulate_soc_trace(
            ctx["compute_route"], G, battery
        )),
        compensate=lambda ctx: None
    )

    return saga


async def async_wrap(fn):
    """Wraps synchronous functions for saga compatibility."""
    async def wrapper(ctx):
        return fn(ctx)
    return wrapper
```

---

## 7. Retry & Timeout Policy Registry

Circuit breakers and retries work together: retries handle transient blips, while circuit breakers handle persistent problems. When the circuit is open, smart retry logic knows not to bother — there is no point retrying when the circuit breaker has already declared the service unavailable.

```python
# orchestrator/retry_policy.py

import asyncio
import random
from typing import Callable, Any, Type

RETRY_POLICIES = {
    "ocm_api": {
        "max_attempts":  3,
        "base_delay_s":  1.0,
        "max_delay_s":   8.0,
        "backoff":       "exponential_jitter",
        "retry_on":      [ConnectionError, TimeoutError],
        "no_retry_on":   [ValueError],     # Bad request — don't retry
    },
    "google_elevation": {
        "max_attempts":  2,
        "base_delay_s":  2.0,
        "max_delay_s":   10.0,
        "backoff":       "linear",
        "retry_on":      [ConnectionError, TimeoutError],
        "no_retry_on":   [],
    },
    "default": {
        "max_attempts":  2,
        "base_delay_s":  0.5,
        "max_delay_s":   4.0,
        "backoff":       "exponential_jitter",
        "retry_on":      [Exception],
        "no_retry_on":   [],
    }
}


async def with_retry(
    fn: Callable,
    *args,
    policy_name: str = "default",
    **kwargs
) -> Any:
    """
    Executes fn with retry logic per named policy.
    Uses exponential backoff with jitter to prevent thundering herd.
    """
    policy  = RETRY_POLICIES.get(policy_name, RETRY_POLICIES["default"])
    attempt = 0

    while attempt < policy["max_attempts"]:
        try:
            return await fn(*args, **kwargs)

        except tuple(policy.get("no_retry_on", [])) as e:
            raise   # Non-retriable error — fail immediately

        except tuple(policy["retry_on"]) as e:
            attempt += 1
            if attempt >= policy["max_attempts"]:
                raise

            # Exponential backoff with full jitter
            if policy["backoff"] == "exponential_jitter":
                delay = min(
                    policy["base_delay_s"] * (2 ** (attempt - 1)),
                    policy["max_delay_s"]
                )
                delay = random.uniform(0, delay)   # Full jitter
            else:
                delay = policy["base_delay_s"] * attempt

            print(f"[Retry] Attempt {attempt}/{policy['max_attempts']} "
                  f"for {fn.__name__}. Waiting {delay:.1f}s...")
            await asyncio.sleep(delay)
```

### 7.1 Timeout Budget Allocation

The orchestrator enforces a **total request budget of 10 seconds**. Each service gets a slice:

```
Total request budget: 10,000ms
├── resolve_nodes:         50ms   (nearest_nodes — in-memory kdtree)
├── prefetch_stations:    500ms   (async, runs in parallel with routing)
├── compute_route:        150ms   (Dijkstra on city graph)
├── compute_route_stats:   20ms   (edge traversal — pure computation)
├── check_soc_feasibility:  5ms   (arithmetic)
├── fetch_stations:          0ms  (early-fetched — should be cache hit)
├── insert_charging_stops: 200ms  (greedy scan)
├── simulate_soc_trace:    100ms  (node-by-node walk)
└── serialize response:     50ms
                          ────────
Total:                    1,075ms (p50 target)
                          10,000ms (p99 hard limit / timeout)
```

---

## 8. Bulkhead Isolation — Resource Partitioning

The Bulkhead pattern is a strategy for isolating different parts of a system to contain failures. It involves partitioning resources so that each service or component has its own dedicated resources — preventing one failing component from starving others.

```python
# orchestrator/bulkheads.py

import asyncio
from typing import Callable, Any

class Bulkhead:
    """
    Limits concurrent executions of a service to prevent one
    slow service from consuming all async workers.
    """
    def __init__(self, name: str, max_concurrent: int):
        self.name      = name
        self._sem      = asyncio.Semaphore(max_concurrent)
        self._max      = max_concurrent
        self._active   = 0
        self._rejected = 0

    async def execute(self, fn: Callable, *args, **kwargs) -> Any:
        if not self._sem._value:   # Semaphore would block
            self._rejected += 1
            raise BulkheadFullError(
                f"Bulkhead '{self.name}' at capacity ({self._max} concurrent). "
                f"Request rejected. Total rejections: {self._rejected}"
            )

        async with self._sem:
            self._active += 1
            try:
                return await fn(*args, **kwargs)
            finally:
                self._active -= 1

    def status(self) -> dict:
        return {
            "name":      self.name,
            "active":    self._active,
            "capacity":  self._max,
            "rejected":  self._rejected,
        }


class BulkheadFullError(Exception):
    pass


# ── Bulkhead configuration: isolated pools per service type
BULKHEADS = {
    "routing":        Bulkhead("routing",       max_concurrent=20),  # Dijkstra
    "ocm_api":        Bulkhead("ocm_api",        max_concurrent=5),   # External HTTP
    "elevation_api":  Bulkhead("elevation_api",  max_concurrent=2),   # External HTTP
    "battery_compute":Bulkhead("battery_compute",max_concurrent=50),  # Cheap compute
}
```

---

## 9. Event-Driven Coordination — Async Hooks

The orchestrator publishes internal events at each pipeline step. Other components subscribe to react without tight coupling.

```python
# orchestrator/event_bus.py

import asyncio
from collections import defaultdict
from typing import Callable

class EventBus:
    """
    Lightweight in-process async event bus.
    Used for: prefetch triggers, metrics emission, cache invalidation.
    NOT a message queue — runs in the same process.
    """
    def __init__(self):
        self._handlers: dict[str, list[Callable]] = defaultdict(list)

    def on(self, event: str, handler: Callable):
        """Subscribe to an event."""
        self._handlers[event].append(handler)

    async def emit(self, event: str, data: dict = {}):
        """Fire event to all subscribers (non-blocking)."""
        for handler in self._handlers.get(event, []):
            asyncio.create_task(handler(data))

# ── Global bus instance
bus = EventBus()

# ── Event catalog — all events the orchestrator emits
EVENTS = {
    "route.request.received":   "Origin + destination known. Trigger early station fetch.",
    "route.computed":           "Route node list available. Trigger SOC trace pre-compute.",
    "stations.fetched":         "Station data available. Decision engine can proceed.",
    "route.response.sent":      "Full response delivered. Emit metrics.",
    "graph.enrichment.complete":"All edges have energy_kwh. Server is ready.",
    "circuit.opened":           "A circuit breaker tripped. Alert monitoring.",
    "cache.miss":               "Cache miss on key. Track for prefetch optimization.",
}
```

### 9.1 Wiring Events to Prefetch

```python
# orchestrator/event_wiring.py

from orchestrator.event_bus   import bus
from orchestrator.prefetch    import prefetch_stations_for_route
from orchestrator.metrics     import record_event

# When request arrives → immediately start station prefetch in background
@bus.on("route.request.received")
async def on_request_received(data: dict):
    asyncio.create_task(prefetch_stations_for_route(
        data["origin_lat"],  data["origin_lon"],
        data["dest_lat"],    data["dest_lon"],
        data["G"]
    ))

# When route is computed → emit to metrics
@bus.on("route.computed")
async def on_route_computed(data: dict):
    record_event("route_computed", {
        "total_kwh": data["stats"]["total_energy_kwh"],
        "nodes":     len(data["route_nodes"]),
    })

# When a circuit opens → log critical alert
@bus.on("circuit.opened")
async def on_circuit_opened(data: dict):
    print(f"[ALERT] Circuit breaker opened: {data['name']} — "
          f"fallback active for {data['service']}")
```

---

## 10. Health & Observability Contract

Every service must expose this standard status interface to the orchestrator.

```python
# orchestrator/health.py

import time
from orchestrator.circuit_breaker import BREAKERS
from orchestrator.bulkheads       import BULKHEADS
from orchestrator.cache_manager   import _L1, _L2

def get_full_health(APP_STATE: dict) -> dict:
    """
    Returns full system health — exposed via GET /api/health.
    Aggregates graph status, circuit breaker states, cache stats, bulkhead loads.
    """
    G = APP_STATE.get("graph")

    # Graph health
    graph_health = {"status": "not_loaded"}
    if G:
        total_edges   = G.number_of_edges()
        enriched      = sum(1 for _,_,d in G.edges(data=True) if "energy_kwh" in d)
        graph_health  = {
            "status":        "ready" if enriched == total_edges else "partial",
            "nodes":          G.number_of_nodes(),
            "edges":          total_edges,
            "enriched_edges": enriched,
            "coverage_pct":   round(enriched / total_edges * 100, 1) if total_edges else 0
        }

    return {
        "timestamp":       time.time(),
        "status":          "ready" if graph_health.get("status") == "ready" else "degraded",
        "graph":           graph_health,
        "circuit_breakers": {name: cb.status_dict() for name, cb in BREAKERS.items()},
        "bulkheads":        {name: bh.status()      for name, bh in BULKHEADS.items()},
        "cache": {
            "l1_memory_keys":  len(_L1._store),
            "l2_disk_files":   len(os.listdir("cache/")) if os.path.exists("cache/") else 0,
        }
    }
```

### 10.1 Metrics Contract — Minimum Required Signals

Every service call must emit these metrics. Orchestrator collects them for observability.

```python
# orchestrator/metrics.py

import time
from typing import Optional

_metrics_log = []   # In production: replace with Prometheus / InfluxDB

def record_service_call(
    service:       str,
    function:      str,
    duration_ms:   float,
    cache_hit:     bool,
    status:        str,          # success | fallback | error
    error:         Optional[str] = None
):
    entry = {
        "ts":          time.time(),
        "service":     service,
        "function":    function,
        "duration_ms": round(duration_ms, 2),
        "cache_hit":   cache_hit,
        "status":      status,
        "error":       error
    }
    _metrics_log.append(entry)

    # Console output (replace with structured logging in production)
    status_icon = "✓" if status == "success" else ("⚡" if status == "fallback" else "✗")
    cache_icon  = "[C]" if cache_hit else "[ ]"
    print(f"  {status_icon} {cache_icon} {service}.{function} → {duration_ms:.0f}ms")
```

---

## 11. Graceful Degradation Playbook

When external services fail, the orchestrator must follow this exact decision tree — no crashes, no 500s.

```
Service: OpenChargeMap API
  ├── CB Closed, cache fresh (< 24h)  → serve cached stations ✓
  ├── CB Closed, cache stale (> 24h)  → call API → if fails → serve stale + warn ✓
  ├── CB Open, stale cache exists      → serve stale data + flag in response ✓
  └── CB Open, no cache               → return route WITHOUT charging stops
                                         Response: {feasible: false, charging_data: "unavailable"} ✓

Service: Google Elevation API
  ├── API available                   → add grade to all edges ✓
  └── API unavailable / no key        → grade=0.0 on all edges
                                         Energy predictions degraded ~15–30% on hilly terrain
                                         Response: {energy_warning: "grade data unavailable"} ✓

Service: RouteE (local)
  ├── Model loads successfully         → full energy prediction ✓
  └── Model file missing               → fallback to physics model
                                         (compute_edge_energy() in energy_bridge.py) ✓

Service: OSMnx (startup only)
  ├── GraphML cache exists             → load from file (~2s) ✓
  ├── No cache, Overpass API available → download graph (~60–90s) ✓
  └── No cache, API unreachable        → CRITICAL — server cannot start
                                         Exit with error: "Cannot load road graph" ✗

Service: Dijkstra Router
  ├── Path found                       → return route ✓
  └── No path (disconnected graph)     → return {feasible: false, error: "No path"} ✓
```

```python
# orchestrator/degradation.py

def build_degraded_response(failure_context: dict) -> dict:
    """
    Constructs the best possible partial response when services degrade.
    Never returns a 500 — always returns a 200 with degradation metadata.
    """
    response = {
        "feasible":    False,
        "degraded":    True,
        "degradations": [],
        "error":        failure_context.get("error"),
    }

    if failure_context.get("station_data_unavailable"):
        response["degradations"].append({
            "service": "charger_client",
            "message": "Charging station data temporarily unavailable. Route shown without stops.",
            "severity": "warning"
        })

    if failure_context.get("grade_data_unavailable"):
        response["degradations"].append({
            "service": "elevation",
            "message": "Road grade data unavailable. Energy predictions assume flat terrain.",
            "severity": "info"
        })

    if failure_context.get("route_computed") and not failure_context.get("stations_needed"):
        # We have a direct route and don't need stations
        response["feasible"]  = True
        response["degraded"]  = len(response["degradations"]) > 0

    return response
```

---

## 12. Orchestrator State Machine

The orchestrator itself is a state machine. Every request transitions through these states:

```
IDLE
  │  [request received]
  ▼
PREFETCHING_STATIONS (async background)
  │  [origin + dest known]
  │  → fire: route.request.received event
  ▼
ROUTING
  │  [Dijkstra running]
  ▼
STATS_COMPUTING
  │  [route stats calculated]
  ▼
FEASIBILITY_CHECK
  │  [battery.is_feasible()?]
  ├──YES──► SOC_TRACING ──► RESPONDING
  │
  └──NO───► CHARGING_INSERTION
              │  [greedy stop insertion]
              ▼
            SEGMENTED_SOC_TRACING
              │
              ▼
            RESPONDING
              │
              ▼
           IDLE (reset for next request)
```

```python
# orchestrator/state_machine.py

from enum import Enum

class OrchestratorState(Enum):
    IDLE                    = "idle"
    PREFETCHING             = "prefetching"
    ROUTING                 = "routing"
    STATS_COMPUTING         = "stats_computing"
    FEASIBILITY_CHECK       = "feasibility_check"
    SOC_TRACING             = "soc_tracing"
    CHARGING_INSERTION      = "charging_insertion"
    SEGMENTED_SOC_TRACING   = "segmented_soc_tracing"
    RESPONDING              = "responding"
    DEGRADED                = "degraded"
    ERROR                   = "error"
```

---

## 13. Complete Python Orchestrator Implementation

```python
# orchestrator/main.py

import asyncio
import time
from core.battery         import BatteryState, simulate_soc_trace
from core.router          import find_route, compute_route_stats, route_to_geojson
from orchestrator.cache_manager   import cache_get, cache_set
from orchestrator.cache_keys       import route_key, soc_key, decision_key
from orchestrator.circuit_breaker  import BREAKERS
from orchestrator.bulkheads        import BULKHEADS
from orchestrator.prefetch         import prefetch_stations_for_route
from orchestrator.protected_calls  import fetch_stations_protected
from orchestrator.event_bus        import bus
from orchestrator.metrics          import record_service_call
from orchestrator.degradation      import build_degraded_response
from orchestrator.saga             import RouteSaga
import osmnx as ox


class RouteOrchestrator:
    """
    Master coordinator for the Antigravity AI route computation pipeline.
    Implements: cache-aside, early fetch, circuit breakers, saga, bulkhead, graceful degradation.
    """

    def __init__(self, G, app_state: dict):
        self.G         = G
        self.app_state = app_state

    async def handle_route_request(self, request, ev_profile: dict) -> dict:
        """
        Entry point for every POST /api/route request.
        Coordinates the full pipeline with all distributed system patterns applied.
        """
        t_start = time.time()

        # ── Emit event: request received → triggers background station prefetch
        await bus.emit("route.request.received", {
            "origin_lat": request.origin.lat,
            "origin_lon": request.origin.lon,
            "dest_lat":   request.destination.lat,
            "dest_lon":   request.destination.lon,
            "G":          self.G,
        })

        # ── Build battery state from EV profile
        battery = BatteryState(
            capacity_kwh = ev_profile["battery_capacity_kwh"],
            soc          = ev_profile["soc_current"],
            soh          = ev_profile.get("soh", 1.0),
            soc_reserve  = ev_profile.get("soc_min_reserve", 0.10),
        )

        # ── Check full decision cache first (skip entire pipeline on hit)
        d_cache_key = decision_key([], battery.soc, battery.soh, battery.capacity_kwh)
        cached_decision = cache_get(d_cache_key, ttl=120)
        if cached_decision:
            record_service_call("orchestrator", "handle_route_request",
                                (time.time()-t_start)*1000, True, "success")
            return cached_decision

        # ── Step 1: Resolve lat/lon → graph nodes (in bulkhead)
        t1 = time.time()
        try:
            orig_node = ox.nearest_nodes(self.G, X=request.origin.lon, Y=request.origin.lat)
            dest_node = ox.nearest_nodes(self.G, X=request.destination.lon, Y=request.destination.lat)
        except Exception as e:
            return {"feasible": False, "error": f"Could not resolve coordinates: {e}"}
        record_service_call("router", "nearest_nodes", (time.time()-t1)*1000, False, "success")

        # ── Step 2: Route computation (cache-aside)
        t2     = time.time()
        r_key  = route_key(orig_node, dest_node, ev_profile.get("vehicle_class", "default_bev"))
        route_nodes = cache_get(r_key, ttl=300)
        cache_hit   = route_nodes is not None

        if not cache_hit:
            try:
                async with BULKHEADS["routing"]._sem:
                    route_nodes = find_route(self.G, orig_node, dest_node)
            except Exception as e:
                return {"feasible": False, "error": f"Routing failed: {e}"}

            if route_nodes is None:
                return {"feasible": False, "error": "No driveable path between origin and destination."}

            cache_set(r_key, route_nodes, ttl=300, layers=["memory"])

        record_service_call("router", "find_route", (time.time()-t2)*1000, cache_hit, "success")

        # ── Step 3: Route statistics
        stats = compute_route_stats(route_nodes, self.G)

        # ── Step 4: Feasibility gate
        if battery.is_feasible(stats["total_energy_kwh"]):
            # ── Direct route: no charging needed
            soc_trace, _ = simulate_soc_trace(route_nodes, self.G, battery)
            response     = self._build_success_response(
                route_nodes, stats, soc_trace, [], battery
            )
        else:
            # ── Needs charging — fetch stations (early fetch should be cache hit)
            t3       = time.time()
            stations = await fetch_stations_protected(route_nodes, self.G)
            record_service_call("charger_client", "fetch_stations",
                               (time.time()-t3)*1000, True, "success")

            if not stations:
                return {
                    "feasible":    False,
                    "error":       f"Route needs {stats['total_energy_kwh']:.2f} kWh "
                                   f"but only {battery.usable_energy:.2f} kWh available. "
                                   f"No compatible charging stations found.",
                    "deficit_kwh": battery.deficit_kwh(stats["total_energy_kwh"])
                }

            # ── Insert charging stops
            from core.decision_engine import _insert_charging_stops
            result   = _insert_charging_stops(self.G, route_nodes, battery, stations, ev_profile)
            response = result

        # ── Cache final decision
        cache_set(d_cache_key, response, ttl=120, layers=["memory"])

        # ── Emit completion event
        await bus.emit("route.response.sent", {
            "duration_ms": (time.time() - t_start) * 1000,
            "feasible":    response.get("feasible"),
        })

        record_service_call("orchestrator", "handle_route_request",
                           (time.time()-t_start)*1000, False, "success")
        return response

    def _build_success_response(self, route_nodes, stats, soc_trace, charging_stops, battery) -> dict:
        return {
            "feasible":        True,
            "charging_needed": len(charging_stops) > 0,
            "route": {
                "node_ids":           route_nodes,
                "geometry":           route_to_geojson(route_nodes, self.G),
                "total_distance_km":  stats["total_distance_km"],
                "total_energy_kwh":   stats["total_energy_kwh"],
                "estimated_time_min": stats["total_time_min"],
            },
            "charging_stops":  charging_stops,
            "soc_trace":       soc_trace,
            "arrival_soc":     soc_trace[-1]["soc"] if soc_trace else battery.soc,
        }
```

---

## 14. Environment Configuration Reference

```bash
# .env — All orchestrator configuration

# ── Core region
REGION="Nashik, Maharashtra, India"
VEHICLE_CLASS_DEFAULT="default_bev"

# ── Cache
GRAPH_CACHE_DIR="cache/graphs/"
STATION_CACHE_DIR="cache/stations/"
STATION_CACHE_TTL_SECONDS=86400
MEMORY_CACHE_MAX_KEYS=512

# ── External API keys
GOOGLE_ELEVATION_API_KEY=""      # Leave empty to use grade=0.0 fallback
OCM_API_KEY="YOUR_OCM_KEY"

# ── Circuit breakers
CB_OCM_FAIL_MAX=3
CB_OCM_RESET_TIMEOUT_S=60
CB_ELEVATION_FAIL_MAX=2
CB_ELEVATION_RESET_TIMEOUT_S=120

# ── Timeout budgets (seconds)
TIMEOUT_ROUTING_S=2.0
TIMEOUT_STATIONS_S=8.0
TIMEOUT_TOTAL_REQUEST_S=10.0

# ── Bulkhead limits (max concurrent)
BULKHEAD_ROUTING_MAX=20
BULKHEAD_OCM_MAX=5
BULKHEAD_ELEVATION_MAX=2

# ── Charging logic
SOC_MIN_RESERVE=0.10
SOC_CHARGE_TARGET=0.80
SOC_TRIGGER_CHARGE=0.20
OCM_MIN_POWER_KW=7.0
CORRIDOR_RADIUS_KM=8.0

# ── Server
API_HOST="0.0.0.0"
API_PORT=8000
LOG_LEVEL="info"
```

---

## Pattern Quick Reference Card

| Pattern                     | Applied To                | What It Does                                        |
| --------------------------- | ------------------------- | --------------------------------------------------- |
| **Cache-Aside (L1 Memory)** | Route, SOC trace, graph   | Read L1 first; write on miss                        |
| **Cache-Aside (L2 Disk)**   | Station data              | 24h JSON file cache                                 |
| **Read-Ahead Prefetch**     | Station data              | Fetched when request arrives, before route computed |
| **Startup Prefetch**        | Graph + energy enrichment | Warm entire pipeline before first request           |
| **Circuit Breaker**         | OCM API, Elevation API    | Open after 3 failures; try again after 60s          |
| **Stale Cache Fallback**    | Station data (CB open)    | Serve expired data rather than empty                |
| **Saga Orchestration**      | Full route pipeline       | Compensate on any step failure                      |
| **Bulkhead Isolation**      | Routing, OCM, elevation   | Separate concurrency pools per service              |
| **Retry + Jitter**          | External HTTP calls       | Exponential backoff prevents thundering herd        |
| **Graceful Degradation**    | All external failures     | Partial response always beats a 500                 |
| **Event Bus**               | Cross-service triggers    | Decoupled prefetch and metric hooks                 |
| **State Machine**           | Request lifecycle         | Explicit states prevent illegal transitions         |

---

_ORCHESTRATOR.md v1.0 — Antigravity AI | Distributed Systems Directive_
