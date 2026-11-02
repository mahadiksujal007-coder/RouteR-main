{
"document_metadata": {
"title": "Product Requirements Document — Antigravity AI EV Routing MVP",
"version": "1.0.0",
"status": "Draft",
"created_date": "2026-03-19",
"last_updated": "2026-03-19",
"owner": "Product Team — Antigravity AI",
"classification": "Internal"
},

"executive_summary": {
"product_name": "Antigravity AI — EV Route Planner",
"tagline": "Energy-aware routing that knows your battery better than you do.",
"overview": "Antigravity AI is an intelligent EV route planning system that replaces conventional distance-based navigation with energy-consumption-based routing. It integrates real road network graphs (OSMnx/NetworkX), ML-based energy prediction (RouteE by NREL), battery state modeling (SOC/SOH), and live charging infrastructure data (OpenChargeMap) to deliver the most energy-efficient, feasibility-guaranteed route for any electric vehicle.",
"target_users": [
"EV drivers seeking range confidence on unfamiliar routes",
"Fleet managers operating mixed or all-electric vehicle fleets",
"EV manufacturers and OEMs embedding routing intelligence into vehicles"
],
"key_goals": [
"Deliver energy-optimal routes using RouteE ML models pre-applied to OSMnx road graphs",
"Guarantee trip feasibility through SOC/SOH battery modeling before route confirmation",
"Automatically insert charging stops when battery cannot complete the route directly",
"Expose all functionality via a clean REST API for seamless third-party integration"
],
"mvp_scope": "A functional backend routing API serving a single geographic region, with graph enrichment, energy prediction, battery feasibility checks, and charging stop insertion — delivered as a FastAPI server with cached graph data and a JSON response contract."
},

"product_vision": {
"vision_statement": "To become the intelligence layer that every EV uses to navigate the world — eliminating range anxiety by making energy-aware routing as seamless as turning on a GPS.",
"mission": "Replace guesswork with precision by bringing ML-based energy science to every EV routing decision.",
"strategic_pillars": [
{
"pillar": "Energy-First",
"description": "Every routing decision is optimized for energy consumption, not just distance or time."
},
{
"pillar": "Feasibility-Guaranteed",
"description": "No route is served to a user unless the system has verified the battery can complete it — with or without charging stops."
},
{
"pillar": "Seamlessly Integrated",
"description": "A clean API-first architecture makes Antigravity embeddable in any EV app, OEM dashboard, or fleet management system."
},
{
"pillar": "Continuously Learning",
"description": "RouteE models and graph enrichment are updated as new vehicle data and road network changes become available."
}
]
},

"target_users": {
"primary_personas": [
{
"id": "persona_01",
"name": "Priya — The Long-Distance EV Commuter",
"age_range": "28–42",
"occupation": "Urban professional, 80–120 km daily commute",
"vehicle": "Tata Nexon EV / Hyundai Kona",
"goals": [
"Complete daily commute without range anxiety",
"Know exactly how much battery will remain at destination",
"Avoid unexpected charging stops that cost time"
],
"pain_points": [
"Standard navigation apps show distance but not energy consumption",
"Hilly terrain or traffic jams drain battery faster than estimated",
"Doesn't know which charging stations are compatible with her vehicle"
],
"tech_comfort": "High — uses smartphone navigation daily",
"key_need": "Confidence that the route is achievable on current charge"
},
{
"id": "persona_02",
"name": "Rajan — The Fleet Manager",
"age_range": "38–55",
"occupation": "Operations manager for logistics/delivery company",
"vehicle": "Mixed EV fleet (5–50 vehicles)",
"goals": [
"Minimize charging downtime across all vehicles",
"Route vehicles based on current battery state, not just distance",
"Predict energy cost per route for budgeting"
],
"pain_points": [
"No centralized tool knows the real-time SOC of all vehicles",
"Drivers manually decide when to charge, leading to stranded vehicles",
"Inconsistent energy consumption due to different driving conditions"
],
"tech_comfort": "Medium — uses fleet management dashboards",
"key_need": "API integration with fleet management system for automated routing decisions"
},
{
"id": "persona_03",
"name": "Dev Team — OEM / App Builder",
"age_range": "N/A",
"occupation": "Software engineers at EV manufacturers or navigation app companies",
"vehicle": "N/A",
"goals": [
"Embed energy-aware routing into existing products via API",
"Get accurate energy predictions per vehicle model",
"Receive structured JSON responses that fit existing data models"
],
"pain_points": [
"No off-the-shelf API provides vehicle-specific energy modeling",
"Building custom energy models requires specialized ML and geospatial expertise",
"Inconsistent charging station data across providers"
],
"tech_comfort": "Expert",
"key_need": "A reliable, documented REST API with predictable response schemas"
}
]
},

"problem_statement": {
"core_problem": "Existing navigation systems route electric vehicles the same way they route petrol cars — by distance or time — completely ignoring the physics of energy consumption. This leads to range anxiety, stranded vehicles, suboptimal charging decisions, and user distrust of EVs.",
"specific_problems": [
{
"id": "P1",
"problem": "Distance-based routing ignores terrain and EV physics",
"impact": "Routes through hilly terrain consume 30–50% more energy than flat alternatives of equal distance, causing unexpected battery depletion."
},
{
"id": "P2",
"problem": "No battery health modeling in routing decisions",
"impact": "A 3-year-old EV battery at 85% SOH has 15% less range than its rated spec. Existing routing systems treat all batteries identically, producing overconfident range estimates."
},
{
"id": "P3",
"problem": "Charging stop decisions are reactive, not proactive",
"impact": "Drivers only think about charging when the battery warning light appears, leading to emergency stops at non-optimal, non-compatible, or congested chargers."
},
{
"id": "P4",
"problem": "Charging station data is fragmented and vehicle-incompatible",
"impact": "Drivers arrive at charging stations only to find incompatible connectors, broken units, or insufficient power output for their vehicle."
}
]
},

"solution_overview": {
"description": "Antigravity AI solves these problems by building a unified pipeline where every routing decision is grounded in energy science. The system pre-computes energy costs for every road segment using RouteE ML models, models the user's specific battery state (SOC × SOH), checks trip feasibility before committing to a route, and automatically inserts compatible charging stops when needed.",
"solution_components": [
{
"component": "Energy-Enriched Road Graph",
"description": "OSMnx graph downloaded and cached per region, with every edge annotated with predicted energy cost (kWh) from RouteE."
},
{
"component": "Battery State Engine",
"description": "Models actual usable energy using: usable_energy = battery_capacity × SOC × SOH − reserve. Accounts for real degradation."
},
{
"component": "Energy-Optimal Router",
"description": "Dijkstra shortest-path on energy_kwh edge weights instead of distance. Finds the route that minimizes energy spent."
},
{
"component": "Feasibility Decision Gate",
"description": "Before returning any route, verifies that the vehicle's usable energy covers the total predicted route energy. Blocks infeasible routes."
},
{
"component": "Charging Stop Insertion Engine",
"description": "When route is infeasible, fetches compatible charging stations (OpenChargeMap), maps them to the graph, and inserts stops greedily where SOC drops below threshold."
},
{
"component": "REST API",
"description": "FastAPI server exposing route computation, charging station lookup, EV model management, and health monitoring endpoints."
}
]
},

"success_metrics": {
"primary_kpis": [
{
"metric": "Route Energy Prediction Accuracy",
"definition": "Mean absolute percentage error (MAPE) between predicted route energy (kWh) and actual energy consumed by EV.",
"target": "≤ 10% MAPE across test routes",
"measurement": "A/B comparison with real-world drive logs from 3+ vehicle models",
"priority": "P0"
},
{
"metric": "Feasibility Prediction Accuracy",
"definition": "Percentage of routes marked 'feasible' that were actually completed without battery depletion.",
"target": "≥ 97% of feasible-marked routes completed successfully",
"measurement": "Telemetry from pilot EV users",
"priority": "P0"
},
{
"metric": "API Route Response Latency",
"definition": "Time from POST /api/route request receipt to JSON response delivery (p95).",
"target": "≤ 300ms p95 for graph-cached regions",
"measurement": "Server-side instrumentation (Prometheus + Grafana)",
"priority": "P0"
}
],
"secondary_kpis": [
{
"metric": "Charging Stop Relevance Rate",
"definition": "Percentage of auto-inserted charging stops where the driver actually charged vs. skipped.",
"target": "≥ 80% acceptance rate",
"measurement": "Session tracking in pilot app",
"priority": "P1"
},
{
"metric": "API Uptime",
"definition": "Percentage of time the /api/route endpoint responds with 2xx within SLA.",
"target": "99.5% uptime (MVP), 99.9% (v1.0)",
"measurement": "Uptime monitoring",
"priority": "P1"
},
{
"metric": "Graph Enrichment Coverage",
"definition": "Percentage of edges in the road graph that have a valid energy_kwh attribute.",
"target": "100% coverage for active regions",
"measurement": "Graph health check endpoint",
"priority": "P1"
},
{
"metric": "Developer Integration Time",
"definition": "Time for a third-party developer to make their first successful /api/route call using documentation.",
"target": "≤ 30 minutes",
"measurement": "Onboarding session observation",
"priority": "P2"
}
]
},

"feature_requirements": [
{
"feature_id": "F-001",
"feature_name": "OSMnx Graph Download & Caching",
"module": "Graph Manager",
"priority": "P0 — Must Have",
"description": "System downloads the road network graph for a configured geographic region using OSMnx, enriches it with speed and travel time attributes, and caches it as a GraphML file. On subsequent server starts, the cached graph is loaded instead of re-downloaded.",
"user_benefit": "Eliminates repeated API calls to OpenStreetMap's Overpass API, reducing startup time from 90s (download) to 2s (cache load) and removing network dependency at runtime.",
"acceptance_criteria": [
"Graph downloads successfully for any valid place name or bounding box via OSMnx",
"Graph is saved as .graphml in cache/graphs/ directory after first download",
"On server restart, cached graph loads without making any external network requests to OSM",
"Graph contains edge attributes: length, speed_kph, travel_time, highway, oneway",
"Graph cache is region-keyed (e.g., nashik_maharashtra_india.graphml)"
],
"technical_notes": "Use ox.graph_from_place() with network_type='drive'. Apply ox.add_edge_speeds() and ox.add_edge_travel_times() before caching. Handle OSMnx version compatibility for attribute naming.",
"dependencies": ["OSMnx library", "OpenStreetMap Overpass API (first-run only)"],
"out_of_scope": ["Real-time graph updates", "Multi-region graph stitching"]
},
{
"feature_id": "F-002",
"feature_name": "Elevation & Road Grade Enrichment",
"module": "Graph Manager",
"priority": "P0 — Must Have",
"description": "Adds elevation data to every graph node and computes road grade (slope as rise/run fraction) for every edge. Grade is critical for energy prediction accuracy, particularly in hilly regions.",
"user_benefit": "Without grade, energy predictions assume flat terrain — up to 50% underestimation on hilly roads. Grade data is the single biggest accuracy driver after speed.",
"acceptance_criteria": [
"Every graph node has an 'elevation' attribute (metres above sea level)",
"Every graph edge has a 'grade' attribute (float, negative = downhill, positive = uphill)",
"System uses Google Elevation API when GOOGLE_ELEVATION_API_KEY env var is set",
"System falls back to grade=0.0 with a logged warning when no API key is present",
"Enriched graph is saved back to GraphML cache with grade included"
],
"technical_notes": "Use ox.elevation.add_node_elevations_google() and ox.elevation.add_edge_grades(). Grade stored as fraction (0.05 = 5%), converted to percent only at RouteE prediction time.",
"dependencies": ["F-001", "Google Elevation API (optional but strongly recommended)"],
"out_of_scope": ["SRTM/DEM elevation data integration (Phase 2)"]
},
{
"feature_id": "F-003",
"feature_name": "RouteE Energy Prediction & Graph Enrichment",
"module": "Energy Bridge",
"priority": "P0 — Must Have",
"description": "Loads a RouteE pre-trained BEV model, batch-predicts energy consumption (kWh) for every edge in the road graph using converted OSMnx attributes, and writes energy_kwh as an edge attribute. This enrichment runs once at server startup.",
"user_benefit": "Every edge in the graph becomes energy-aware. Routing can then minimize energy spent rather than distance traveled, directly reducing charge anxiety.",
"acceptance_criteria": [
"RouteE model loads successfully from nrel.routee.powertrain package",
"All OSMnx units are correctly converted before prediction: length(m)→distance(miles), speed_kph→speed_mph, grade(fraction)→grade(percent)",
"energy_kwh is written to 100% of graph edges after enrichment",
"Enrichment runs as a single batch operation (not per-edge loop) for performance",
"Edge values are clamped: speed_mph in [1,90], grade in [-30,30], distance > 0.0001",
"energy_kwh values are non-negative (clipped at 0.0)",
"RouteE energy column name is detected dynamically (not hardcoded) to handle model version differences",
"Enrichment completes within 60 seconds for a city-scale graph of 50,000 edges"
],
"technical_notes": "Critical unit conversion: OSMnx grade is fraction (e.g. 0.03), RouteE expects percentage (3.0). Use next(c for c in predictions.columns if 'energy' in c.lower()) for column detection. Batch predict via pandas DataFrame for performance.",
"dependencies": ["F-001", "F-002", "nrel.routee.powertrain package"],
"out_of_scope": ["Vehicle-specific enrichment at request time (Phase 2)", "ICE/hybrid vehicle models"]
},
{
"feature_id": "F-004",
"feature_name": "Battery State Modeling (SOC & SOH)",
"module": "Battery Module",
"priority": "P0 — Must Have",
"description": "Computes the actual usable energy available for a trip from the EV's battery parameters. Models both current charge level (SOC) and battery degradation (SOH) to produce a realistic usable energy figure.",
"user_benefit": "A 3-year-old battery at 85% SOH has 15% less range than a new battery. This feature ensures routing reflects the actual vehicle condition, not rated specifications.",
"acceptance_criteria": [
"Usable energy computed as: max((capacity × SOH × SOC) − (capacity × SOH × reserve), 0.0)",
"BatteryState object accepts: battery_capacity_kwh, soc_current, soh, soc_min_reserve",
"System defaults: soh=1.0 (new battery), soc_min_reserve=0.10 (10% reserve)",
"SOC trace simulated node-by-node along a route, returning {node, soc, cumulative_kwh} per node",
"Charge time estimation: energy_needed / min(station_kw, vehicle_max_charge_rate_kw) × 60 minutes",
"All SOC values clamped to [0.0, 1.0] throughout simulation"
],
"technical_notes": "BatteryState implemented as a Python dataclass with computed properties. simulate_soc_trace() returns early with ran_out=True if SOC reaches reserve threshold before destination.",
"dependencies": ["F-003"],
"out_of_scope": ["Real-time OBD2/BMS SOC telemetry integration (Phase 3)", "Temperature-based battery derating (Phase 2)"]
},
{
"feature_id": "F-005",
"feature_name": "Energy-Optimal Route Computation",
"module": "Router",
"priority": "P0 — Must Have",
"description": "Finds the route between origin and destination that minimizes total energy consumption using Dijkstra's algorithm on the energy-enriched graph. Returns route as ordered node list, total energy (kWh), total distance (km), and GeoJSON geometry.",
"user_benefit": "The returned route may be slightly longer in distance but consumes measurably less energy — the fundamental value proposition of the system.",
"acceptance_criteria": [
"Route computed using nx.shortest_path(G, weight='energy_kwh')",
"Origin and destination coordinates (lat/lon) mapped to nearest graph nodes via ox.nearest_nodes()",
"When parallel edges exist between two nodes, minimum-energy edge is selected",
"Response includes: route_nodes (list[int]), total_energy_kwh (float), total_distance_km (float), estimated_time_min (float), geometry ([[lon,lat],...])",
        "Returns error response (not exception) when no path exists between origin and destination",
        "Route computation completes within 100ms for city-scale graphs"
      ],
      "technical_notes": "Graph must be pre-enriched (F-003) before routing. Use min(G[u][v].values(), key=...) for parallel edge resolution. Geometry extracted as [[lon,lat]] list for GeoJSON compatibility.",
"dependencies": ["F-003"],
"out_of_scope": ["A* routing with heuristic (Phase 2)", "Multi-waypoint routing (Phase 2)", "Avoiding toll roads (Phase 2)"]
},
{
"feature_id": "F-006",
"feature_name": "SOC Feasibility Gate",
"module": "Decision Engine",
"priority": "P0 — Must Have",
"description": "Before returning any route to a user, the system verifies that the vehicle's usable energy is sufficient to complete the route. Infeasible routes are not returned directly — instead charging stop insertion is triggered.",
"user_benefit": "Users are never given a route they cannot complete. This is the core trust-building feature of the product.",
"acceptance_criteria": [
"Feasibility check: total_route_energy_kwh <= battery.usable_energy",
"If feasible: route returned immediately with soc_trace and arrival_soc",
"If infeasible: charging stop insertion (F-007) is triggered automatically — not an error",
"Response always includes: feasible (bool), charging_needed (bool), arrival_soc (float), deficit_kwh (float when infeasible)",
"Feasibility gate executes in < 5ms"
],
"dependencies": ["F-004", "F-005"],
"out_of_scope": ["Partial feasibility (reach-as-far-as-possible mode) — Phase 2"]
},
{
"feature_id": "F-007",
"feature_name": "Automatic Charging Stop Insertion",
"module": "Decision Engine",
"priority": "P0 — Must Have",
"description": "When a route is infeasible on current battery, the system fetches compatible charging stations along the route corridor, maps them to the graph, and inserts charging stops using a greedy forward-scan algorithm. Charging is triggered when SOC drops below 20% at a node that has a mapped charger.",
"user_benefit": "Users never see a 'route not possible' error. Instead they get a complete, achievable multi-stop route with exact charge times at each stop.",
"acceptance_criteria": [
"System fetches stations from OpenChargeMap within configured corridor radius (default: 8km from route midpoint)",
"Stations filtered by: minimum power (7kW), operational status, and EV connector type compatibility",
"Each station mapped to nearest graph node via ox.nearest_nodes()",
"Charging stop inserted when: current_soc < 0.20 AND current_node has a mapped station",
"After charging stop: SOC reset to 0.80 (80%, optimal Li-ion charge level)",
"Charge time calculated as: energy_needed / min(station_kw, vehicle_max_kw) × 60",
"Response includes per-stop details: station_name, lat, lon, power_kw, connector_type, arrival_soc, departure_soc, charge_time_min",
"If no compatible stations found: return infeasible response with deficit_kwh and explanation",
"Charging station data cached locally for 24 hours (TTL = 86400s)"
],
"technical_notes": "Cache keyed by (round(lat,3), round(lon,3), radius_km). OCM API called only on cache miss or TTL expiry. Station lat/lon null values must be filtered before nearest_nodes() call.",
"dependencies": ["F-004", "F-005", "F-006", "OpenChargeMap API"],
"out_of_scope": ["Real-time charger availability (Phase 3)", "Optimal multi-stop planning via dynamic programming (Phase 2)"]
},
{
"feature_id": "F-008",
"feature_name": "REST API — Core Endpoints",
"module": "API Server",
"priority": "P0 — Must Have",
"description": "A FastAPI server exposing the core routing functionality as JSON REST endpoints with Pydantic request/response validation and automatic OpenAPI documentation.",
"user_benefit": "Enables any EV app, OEM system, or fleet platform to integrate energy-aware routing without building the underlying infrastructure.",
"endpoints": [
{
"method": "POST",
"path": "/api/route",
"description": "Compute energy-optimal route with optional charging stops",
"request_body": "RouteRequest (origin, destination, ev_profile)",
"response": "RouteResponse (feasible, route, charging_stops, soc_trace, arrival_soc)"
},
{
"method": "GET",
"path": "/api/stations",
"description": "Fetch nearby charging stations for a given coordinate",
"params": "lat, lon, radius_km, min_power_kw",
"response": "List of ChargingStation objects"
},
{
"method": "GET",
"path": "/api/ev/models",
"description": "List available RouteE vehicle models",
"response": "List of model IDs with metadata"
},
{
"method": "GET",
"path": "/api/health",
"description": "Server health check with graph status",
"response": "status, node_count, edge_count, enriched (bool)"
}
],
"acceptance_criteria": [
"All endpoints return valid JSON with Content-Type: application/json",
"Pydantic validation rejects malformed requests with 422 Unprocessable Entity and field-level error messages",
"POST /api/route returns within 300ms p95 for cached graph regions",
"OpenAPI docs available at /docs and /redoc",
"All endpoints return appropriate HTTP status codes: 200 (success), 422 (validation error), 500 (server error)",
"CORS headers configured to allow cross-origin requests for web frontend integration"
],
"dependencies": ["F-005", "F-006", "F-007"],
"out_of_scope": ["Authentication/API keys (Phase 2)", "Rate limiting (Phase 2)"]
},
{
"feature_id": "F-009",
"feature_name": "Server Startup Lifecycle (Graph Pre-loading)",
"module": "API Server",
"priority": "P0 — Must Have",
"description": "The FastAPI server uses a lifespan context manager to load the graph, add elevation, and run full RouteE enrichment ONCE at startup before accepting any requests. The enriched graph is held in memory for the server's lifetime.",
"user_benefit": "Every user request benefits from a fully pre-computed energy graph, making routing near-instant with no ML inference at request time.",
"acceptance_criteria": [
"Server does not accept requests until graph enrichment is complete",
"Startup sequence: load_graph → add_elevation (if key present) → enrich_full_graph → ready",
"Graph stored in shared APP_STATE dictionary accessible by all request handlers",
"Health endpoint returns graph stats (nodes, edges, enrichment status) after startup",
"Graceful shutdown clears APP_STATE on server stop"
],
"dependencies": ["F-001", "F-002", "F-003"],
"out_of_scope": ["Hot graph reload without server restart (Phase 2)", "Multi-worker graph sharing with Redis (Phase 2)"]
}
],

"non_functional_requirements": {
"performance": [
{
"requirement": "Route response latency",
"specification": "POST /api/route: ≤ 300ms p95, ≤ 100ms p50 for cached graph regions"
},
{
"requirement": "Graph enrichment startup time",
"specification": "Full city graph (≤ 100,000 edges) enriched within 60 seconds at server start"
},
{
"requirement": "Graph cache load time",
"specification": "Cached .graphml loaded within 5 seconds on server restart"
},
{
"requirement": "Charging station fetch (cache hit)",
"specification": "≤ 10ms when local JSON cache is valid (within 24h TTL)"
}
],
"scalability": [
{
"requirement": "Graph size",
"specification": "MVP supports single-region graphs up to 200,000 edges. Multi-region tiling deferred to Phase 2."
},
{
"requirement": "Concurrent requests",
"specification": "API must handle ≥ 50 concurrent route requests without degradation using FastAPI async workers"
}
],
"reliability": [
{
"requirement": "API uptime",
"specification": "99.5% monthly uptime target for MVP pilot phase"
},
{
"requirement": "Graceful degradation",
"specification": "If Google Elevation API is unavailable, system falls back to grade=0.0 with warning log — routing continues"
},
{
"requirement": "Graceful degradation — OCM",
"specification": "If OpenChargeMap API is unavailable and cache is stale, system returns partial response indicating charging data unavailable"
}
],
"security": [
{
"requirement": "API key storage",
"specification": "All external API keys (Google Elevation, OCM) stored as environment variables, never in source code or committed to version control"
},
{
"requirement": "Input validation",
"specification": "All user inputs validated via Pydantic models. Coordinates validated to valid WGS84 ranges (lat: -90 to 90, lon: -180 to 180)"
}
],
"data_quality": [
{
"requirement": "OCM data filtering",
"specification": "Charging stations with null lat/lon coordinates must be excluded before graph node mapping"
},
{
"requirement": "RouteE edge coverage",
"specification": "100% of graph edges must receive a valid energy_kwh value after enrichment — no NaN or null values permitted"
}
]
},

"data_field_registry": {
"ev_profile_fields": [
{ "field": "battery_capacity_kwh", "type": "float", "unit": "kWh", "required": true, "validation": "gt=0", "example": 40.0 },
{ "field": "soc_current", "type": "float", "unit": "fraction 0-1", "required": true, "validation": "ge=0, le=1", "example": 0.75 },
{ "field": "soh", "type": "float", "unit": "fraction 0-1", "required": false, "default": 1.0, "example": 0.95 },
{ "field": "soc_min_reserve", "type": "float", "unit": "fraction 0-1", "required": false, "default": 0.10, "example": 0.10 },
{ "field": "max_charge_rate_kw", "type": "float", "unit": "kW", "required": false, "default": 50.0, "example": 50.0 },
{ "field": "connector_types", "type": "list[str]", "unit": null, "required": false, "default": [], "example": ["CCS2", "Type2"] },
{ "field": "vehicle_class", "type": "str", "unit": null, "required": false, "default": "default_bev", "example": "bolt_bev" }
],
"route_request_fields": [
{ "field": "origin.lat", "type": "float", "unit": "WGS84 degrees", "required": true, "validation": "ge=-90, le=90" },
{ "field": "origin.lon", "type": "float", "unit": "WGS84 degrees", "required": true, "validation": "ge=-180, le=180" },
{ "field": "destination.lat", "type": "float", "unit": "WGS84 degrees", "required": true },
{ "field": "destination.lon", "type": "float", "unit": "WGS84 degrees", "required": true }
],
"graph_edge_attributes": [
{ "field": "length", "source": "OSMnx native", "type": "float", "unit": "metres" },
{ "field": "speed_kph", "source": "OSMnx imputed", "type": "float", "unit": "km/h" },
{ "field": "travel_time", "source": "OSMnx computed", "type": "float", "unit": "seconds" },
{ "field": "grade", "source": "Elevation API", "type": "float", "unit": "fraction (rise/run)", "note": "Defaults to 0.0 without API key" },
{ "field": "energy_kwh", "source": "RouteE prediction", "type": "float", "unit": "kWh", "note": "Added by energy_bridge.py at startup" }
],
"charging_station_fields": [
{ "field": "ocm_id", "source": "OpenChargeMap", "type": "int" },
{ "field": "name", "source": "OpenChargeMap", "type": "str" },
{ "field": "lat", "source": "OpenChargeMap", "type": "float", "unit": "WGS84" },
{ "field": "lon", "source": "OpenChargeMap", "type": "float", "unit": "WGS84" },
{ "field": "power_kw", "source": "OpenChargeMap", "type": "float", "unit": "kW" },
{ "field": "connector_type", "source": "OpenChargeMap", "type": "str" },
{ "field": "is_fast_charge", "source": "OpenChargeMap", "type": "bool" },
{ "field": "status", "source": "OpenChargeMap", "type": "str" },
{ "field": "graph_node", "source": "Computed (ox.nearest_nodes)", "type": "int" }
],
"route_response_fields": [
{ "field": "feasible", "type": "bool" },
{ "field": "charging_needed", "type": "bool" },
{ "field": "route.geometry", "type": "list[[lon,lat]]", "format": "GeoJSON coordinate array" },
{ "field": "route.total_distance_km", "type": "float", "unit": "km" },
{ "field": "route.total_energy_kwh", "type": "float", "unit": "kWh" },
{ "field": "route.estimated_time_min", "type": "float", "unit": "minutes" },
{ "field": "charging_stops", "type": "list[ChargingStop]" },
{ "field": "soc_trace", "type": "list[{node, soc, cumulative_kwh}]" },
{ "field": "arrival_soc", "type": "float", "unit": "fraction 0-1" },
{ "field": "deficit_kwh", "type": "float", "note": "Present only when feasible=false and no chargers found" },
{ "field": "error", "type": "str", "note": "Human-readable error message when applicable" }
]
},

"constraints_and_dependencies": {
"technical_constraints": [
{
"constraint": "Single geographic region for MVP",
"rationale": "Graph enrichment at startup is memory-intensive. Multi-region support requires tile-based lazy loading — deferred to Phase 2.",
"impact": "MVP deployed for one city/region at a time"
},
{
"constraint": "RouteE BEV model coverage",
"rationale": "RouteE pre-trained models cover specific US-market vehicle models. Non-US EVs default to the Chevrolet Bolt model as proxy.",
"impact": "Energy predictions for non-covered vehicles may have higher error margin"
},
{
"constraint": "Charging station real-time availability not available",
"rationale": "OpenChargeMap does not provide live slot availability. Real-time data requires network operator APIs (ChargePoint, EVGO).",
"impact": "System cannot guarantee a charger is available when user arrives — noted in response metadata"
},
{
"constraint": "Graph enrichment blocking startup",
"rationale": "RouteE batch prediction for large graphs takes 15–60s. Server cannot serve requests during this period.",
"impact": "Cold start has a delay. Mitigated by saving enriched graph to cache in Phase 2."
}
],
"external_dependencies": [
{
"dependency": "OSMnx / OpenStreetMap Overpass API",
"purpose": "Road network graph download",
"dependency_type": "First-run only (then cached)",
"risk": "Low — data cached after first download"
},
{
"dependency": "nrel.routee.powertrain (RouteE)",
"purpose": "Vehicle energy consumption prediction",
"dependency_type": "Required — core ML engine",
"risk": "Medium — version upgrades may change model output column names"
},
{
"dependency": "Google Elevation API",
"purpose": "Road grade/slope data",
"dependency_type": "Optional but strongly recommended",
"risk": "Low — system falls back to grade=0.0 (reduces accuracy)"
},
{
"dependency": "OpenChargeMap REST API",
"purpose": "Charging station location and attributes",
"dependency_type": "Required for charging stop insertion",
"risk": "Medium — data quality is community-sourced; null coordinates must be filtered"
}
],
"business_constraints": [
"MVP must be deliverable as a functional backend API — no frontend UI required for Phase 1",
"All external API keys managed via environment variables for security",
"No user data stored or logged beyond server-side request logs for MVP"
]
},

"release_plan": {
"phases": [
{
"phase": "Phase 1 — MVP",
"duration": "Weeks 1–4",
"goal": "Functional routing API for a single region with RouteE energy enrichment",
"deliverables": [
"OSMnx graph download, enrichment, and caching (F-001, F-002)",
"RouteE energy bridge with full unit conversion (F-003)",
"Battery state modeling — SOC/SOH (F-004)",
"Dijkstra energy-optimal routing (F-005)",
"SOC feasibility gate (F-006)",
"FastAPI server with /api/route, /api/health endpoints (F-008, F-009)",
"Pydantic request/response schemas",
"README with curl examples and setup instructions"
],
"success_criteria": [
"POST /api/route returns valid route for Nashik test case within 300ms",
"Energy prediction MAPE ≤ 15% against reference RouteE output",
"Server starts cleanly from cached graph in < 10 seconds"
],
"out_of_scope": ["Charging stop insertion", "Frontend UI", "Authentication"]
},
{
"phase": "Phase 2 — Charging Integration",
"duration": "Weeks 5–8",
"goal": "Complete charging stop insertion and station data pipeline",
"deliverables": [
"OpenChargeMap client with 24h local cache (F-007 partial)",
"Charging stop insertion engine — greedy algorithm (F-007 complete)",
"Connector type compatibility filtering",
"/api/stations endpoint (F-008)",
"SOC trace simulation along full route including charge stops",
"Save enriched graph to cache to eliminate startup delay"
],
"success_criteria": [
"Infeasible routes automatically produce valid multi-stop itineraries",
"Charging stop acceptance rate ≥ 70% in pilot testing",
"Station cache reduces OCM API calls by ≥ 90%"
]
},
{
"phase": "Phase 3 — ML & Scale",
"duration": "Weeks 9–16",
"goal": "Vehicle-specific models, optimization, and production hardening",
"deliverables": [
"Per-request vehicle class model selection (not just default_bev)",
"A* routing with energy heuristic for faster computation",
"Regenerative braking via Johnson's algorithm for negative edge weights",
"Temperature-based battery derating",
"Multi-region support with tile-based graph loading",
"API authentication and rate limiting",
"EV recommendation engine (/api/ev/recommend)",
"Redis graph cache for multi-worker deployments",
"Prometheus metrics and Grafana dashboard"
]
}
]
},

"open_questions": [
{
"id": "OQ-001",
"question": "Which vehicle models should be supported at MVP launch?",
"context": "RouteE has ~20 pre-trained models. The default (Bolt BEV) is a reasonable proxy but accuracy varies per vehicle. Should we expand the ROUTEE_MODEL_MAP in config?",
"owner": "Product + Engineering",
"resolution_needed_by": "Phase 1 Week 2"
},
{
"id": "OQ-002",
"question": "Should the enriched graph (with energy_kwh) be saved to disk to eliminate startup delay?",
"context": "Currently the graph is enriched at every server start (15–60s). Saving the enriched GraphML eliminates this but adds complexity around cache invalidation when EV profiles change.",
"owner": "Engineering",
"resolution_needed_by": "Phase 2 Week 5"
},
{
"id": "OQ-003",
"question": "How will SOH be collected from users in production?",
"context": "For MVP, SOH is a user-provided float. In production, should we integrate OBD2/BMS telemetry, or rely on age-based estimation? This affects the accuracy of feasibility checks significantly.",
"owner": "Product",
"resolution_needed_by": "Phase 3 planning"
},
{
"id": "OQ-004",
"question": "What is the coverage strategy for charging station data outside OpenChargeMap?",
"context": "OCM coverage in India (Nashik region) may be sparse. Should we supplement with OSM amenity=charging_station tags or operator APIs (Tata Power, ChargeZone)?",
"owner": "Product + Data",
"resolution_needed_by": "Phase 2 Week 5"
},
{
"id": "OQ-005",
"question": "Should the charging stop trigger (20% SOC) be configurable by the user or fixed system-wide?",
"context": "Different users have different risk tolerances. A configurable threshold adds flexibility but increases API surface area and testing burden.",
"owner": "Product",
"resolution_needed_by": "Phase 2 Week 6"
},
{
"id": "OQ-006",
"question": "What is the graph refresh strategy? How often should OSM data be re-downloaded?",
"context": "Road networks change (new roads, speed limit changes). Currently there is no automated refresh mechanism.",
"owner": "Engineering + Ops",
"resolution_needed_by": "Phase 2"
}
],

"assumptions": [
"RouteE pre-trained models are accurate enough for MVP without custom fine-tuning (MAPE ≤ 15%)",
"OSMnx road graph data quality in the target region (Nashik, Maharashtra) is sufficient for routing",
"OpenChargeMap has adequate station coverage in the target region for Phase 2",
"Users will provide honest SOC values — no telemetry integration needed for MVP",
"A single geographic region is sufficient to validate the core product hypothesis",
"Energy predictions are directionally correct even without elevation data (grade=0 fallback)"
],

"appendices": {
"routee_model_map": {
"description": "Mapping of vehicle class identifiers to RouteE pre-trained model keys",
"models": [
{ "vehicle_class": "bolt_bev", "routee_key": "2017_CHEVROLET_Bolt", "type": "BEV" },
{ "vehicle_class": "leaf_bev", "routee_key": "2016_NISSAN_Leaf", "type": "BEV" },
{ "vehicle_class": "default_bev", "routee_key": "2017_CHEVROLET_Bolt", "type": "BEV (fallback)" }
]
},
"unit_conversion_table": {
"description": "Critical OSMnx → RouteE unit conversions in energy_bridge.py",
"conversions": [
{ "osmnx_field": "length", "osmnx_unit": "metres", "routee_field": "distance", "routee_unit": "miles", "factor": 0.000621371 },
{ "osmnx_field": "speed_kph", "osmnx_unit": "km/h", "routee_field": "speed_mph", "routee_unit": "mph", "factor": 0.621371 },
{ "osmnx_field": "grade", "osmnx_unit": "fraction (0.05)", "routee_field": "grade", "routee_unit": "percent (5.0)", "factor": 100.0 }
]
},
"key_formulas": {
"usable_energy": "usable_energy = battery_capacity × SOH × (SOC - soc_min_reserve)",
"charge_time_minutes": "charge_time = (energy_needed / min(station_kw, vehicle_max_kw)) × 60",
"edge_grade": "grade = (elevation_end - elevation_start) / edge_length_metres"
},
"installation_commands": [
"python -m venv ev_router_env",
"source ev_router_env/bin/activate",
"pip install osmnx networkx fastapi uvicorn pydantic requests pandas",
"pip install nrel.routee.powertrain",
"uvicorn api.server:app --host 0.0.0.0 --port 8000"
],
"known_gaps_and_mitigations": [
{
"gap": "RouteE energy column name varies by model version",
"mitigation": "Detect dynamically: next(c for c in predictions.columns if 'energy' in c.lower() or 'kwh' in c.lower())"
},
{
"gap": "OCM station lat/lon can be null",
"mitigation": "Filter all stations where lat or lon is None before calling ox.nearest_nodes()"
},
{
"gap": "Parallel edges in MultiDiGraph",
"mitigation": "Always resolve with: min(G[u][v].values(), key=lambda d: d.get('energy_kwh', inf))"
},
{
"gap": "Grade missing when no elevation API key",
"mitigation": "Log warning, default grade=0.0, continue routing with degraded accuracy"
}
]
}
}
