"""
Antigravity AI — FastAPI Server (F-008, F-009)
Main application with lifespan startup lifecycle, CORS, and static file serving.
"""

import os
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from api.models import RouteRequest, EVProfile, StationsRequest
from config import REGION, VEHICLE_CLASS_DEFAULT, API_HOST, API_PORT

# ── Global application state
APP_STATE = {
    "graph": None,
    "startup_time": None,
    "region": REGION,
    "status": "starting",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Server startup lifecycle (F-009):
    1. Load or download OSMnx graph
    2. Add elevation data (if API key available)
    3. Enrich graph with energy weights (RouteE or physics fallback)
    4. Background-prefetch station data
    """
    t_start = time.time()
    print("=" * 60)
    print("  ANTIGRAVITY AI — EV Route Planner")
    print("  Starting server...")
    print("=" * 60)

    # Step 1: Load graph
    from core.graph_manager import get_graph, add_elevation_to_graph

    print("\n[Startup] Step 1/3: Loading road graph...")
    try:
        G = get_graph(REGION)
        APP_STATE["graph"] = G
    except Exception as e:
        print(f"[Startup] CRITICAL: Could not load graph: {e}")
        print("[Startup] Server will start in degraded mode — no routing available")
        APP_STATE["status"] = "degraded_no_graph"
        yield
        return

    # Step 2: Elevation
    print("\n[Startup] Step 2/3: Adding elevation data...")
    G = add_elevation_to_graph(G)
    APP_STATE["graph"] = G

    # Step 3: Energy enrichment
    print("\n[Startup] Step 3/3: Running energy enrichment...")
    from core.energy_bridge import enrich_full_graph
    G = enrich_full_graph(G, vehicle_class=VEHICLE_CLASS_DEFAULT)
    APP_STATE["graph"] = G

    # Done
    elapsed = time.time() - t_start
    APP_STATE["startup_time"] = round(elapsed, 1)
    APP_STATE["status"] = "ready"

    enriched = sum(1 for _, _, d in G.edges(data=True) if "energy_kwh" in d)
    print(f"\n{'=' * 60}")
    print(f"  Server READY in {elapsed:.1f}s")
    print(f"  Region: {REGION}")
    print(f"  Graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
    print(f"  Energy coverage: {enriched}/{G.number_of_edges()} edges")
    print(f"  API: http://{API_HOST}:{API_PORT}")
    print(f"  UI:  http://{API_HOST}:{API_PORT}/")
    print(f"{'=' * 60}\n")

    # Background prefetch
    from orchestrator.prefetch import run_startup_prefetch
    import asyncio
    asyncio.create_task(run_startup_prefetch(G, REGION))

    yield

    print("[Shutdown] Server stopping...")


# ── Create FastAPI app
app = FastAPI(
    title="Antigravity AI — EV Route Planner",
    description="Energy-aware EV route planning with battery modeling and charging stop insertion.",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Static file serving (frontend)
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_dir):
    app.mount("/static", StaticFiles(directory=frontend_dir), name="static")


# ── Routes

@app.get("/")
async def serve_frontend():
    """Serve the frontend index.html."""
    index_path = os.path.join(frontend_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Antigravity AI — EV Route Planner API", "docs": "/docs"}


@app.post("/api/route")
async def compute_route(request: RouteRequest):
    """
    Primary route computation endpoint.
    Accepts origin/destination + EV profile, returns energy-optimal route
    with feasibility check and optional charging stops.
    """
    G = APP_STATE.get("graph")
    if G is None:
        return {"feasible": False, "error": "Road graph not loaded. Server is starting up."}

    from core.decision_engine import process_route_request

    ev = request.ev_profile.model_dump()
    result = process_route_request(
        G,
        origin_lat=request.origin.lat,
        origin_lon=request.origin.lon,
        dest_lat=request.destination.lat,
        dest_lon=request.destination.lon,
        ev_profile=ev,
    )
    return result


@app.get("/api/stations")
async def get_stations(
    lat: float = Query(..., description="Latitude"),
    lon: float = Query(..., description="Longitude"),
    radius_km: float = Query(10.0, gt=0, le=50),
    min_power_kw: float = Query(0.0, ge=0, description="Minimum charger power in kW"),
):
    """Fetch nearby charging stations from OpenChargeMap utilizing the 0.5-degree grid cache."""
    from orchestrator.ocm_client import retrieve_stations_for_location
    
    # Empty EV profile to fetch all connector types initially for map viewing
    ev_profile = {
        "max_charge_rate_kw": 150.0,
        "connector_types": []
    }
    
    stations = await retrieve_stations_for_location(
        lat=lat, 
        lon=lon, 
        radius_km=radius_km, 
        ev_profile=ev_profile,
        country_code="IN"
    )
    
    # Filter by user requested minimum power if any
    if min_power_kw > 0:
        stations = [s for s in stations if s.best_connection and s.best_connection.effective_power_kw >= min_power_kw]

    return {
        "stations": stations,
        "count": len(stations),
        "attribution": {
            "provider": "OpenChargeMap",
            "license": "Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)",
            "url": "https://openchargemap.org",
        },
    }


@app.get("/api/health")
async def health_check():
    """Full system health check."""
    from orchestrator.health import get_full_health
    return get_full_health(APP_STATE)


@app.get("/api/ev/models")
async def ev_models():
    """List available EV models / RouteE profiles."""
    from config import ROUTEE_MODEL_MAP
    return {
        "models": [
            {"id": key, "routee_model": val}
            for key, val in ROUTEE_MODEL_MAP.items()
        ],
        "default": VEHICLE_CLASS_DEFAULT,
    }


# ── Main entry point
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api.server:app", host=API_HOST, port=API_PORT, reload=True)
