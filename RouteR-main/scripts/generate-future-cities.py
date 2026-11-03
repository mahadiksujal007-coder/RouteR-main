#!/usr/bin/env python3
"""Build cached, OSM-grounded synthetic city scenarios for RouteR."""

from __future__ import annotations

import hashlib
import json
import math
import random
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

from shapely.affinity import rotate, translate
from shapely.geometry import LineString, Point, Polygon, box, mapping
from shapely.ops import transform, unary_union


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIRECTORY = ROOT / "public" / "data" / "future-cities"
OSM_CACHE_DIRECTORY = ROOT / "data" / "future-cities" / "osm"
ELEVATION_CACHE_DIRECTORY = ROOT / "data" / "future-cities" / "elevation"
OSM_MAP_ENDPOINT = "https://api.openstreetmap.org/api/0.6/map"
ELEVATION_ENDPOINT = "https://api.open-meteo.com/v1/elevation"
OSM_LICENSE = "OpenStreetMap contributors, ODbL 1.0"
EXPANSION_BUFFER_METERS = 500
SETTLEMENT_EVIDENCE_RADIUS_METERS = 1000
MAX_BUILDING_SLOPE_PERCENT = 15
SITE_GRID_METERS = 100
SITE_FOOTPRINT_METERS = 60
MAX_BUILDING_SITES = 300


CITIES = [
    {
        "id": "vita",
        "name": "Vita",
        "mappedPlace": "Vita",
        "osmNodeId": "3158450464",
        "lat": 17.271977,
        "lon": 74.5372841,
        "accent": "#D9A441",
        "identity": "Future commercial and technology centre",
        "districts": [
            "Central Business District",
            "Technology and Innovation District",
            "Future Residential District",
            "Green Mobility Corridor",
            "Civic and Cultural District",
            "Renewable Energy District",
        ],
    },
    {
        "id": "nevari",
        "name": "Nevari",
        "mappedPlace": "Nevri",
        "osmNodeId": "10106903805",
        "lat": 17.307049,
        "lon": 74.4819617,
        "accent": "#36A3A3",
        "identity": "Compact green smart city",
        "districts": [
            "Compact Skyline District",
            "Smart Residential District",
            "Solar Energy District",
            "Green Public Spaces",
            "Innovation Campus",
        ],
    },
    {
        "id": "tasgaon",
        "name": "Tasgaon",
        "mappedPlace": "Tasgaon",
        "osmNodeId": "2023270821",
        "lat": 17.0375853,
        "lon": 74.6024851,
        "accent": "#9264C8",
        "identity": "Future metropolitan centre",
        "districts": [
            "Metropolitan Central Business District",
            "Commercial High-Rise District",
            "Smart Residential District",
            "Transit-Oriented Development District",
            "Technology Campus",
            "Green Infrastructure Corridor",
        ],
    },
    {
        "id": "chinchani-ambak",
        "name": "Chinchani-Ambak",
        "mappedPlace": "Ambak",
        "osmNodeId": "3791425940",
        "lat": 17.2014694,
        "lon": 74.3725211,
        "accent": "#4B83D4",
        "identity": "Future sustainable urban district",
        "districts": [
            "Sustainable Skyline District",
            "Residential Innovation District",
            "Renewable Energy District",
            "Green Corridor",
            "Smart Civic District",
        ],
    },
]


def project_geometry(geometry, latitude: float, longitude: float, inverse: bool = False):
    longitude_scale = 111320 * math.cos(math.radians(latitude))

    if inverse:
        return transform(
            lambda x, y, z=None: (x / longitude_scale + longitude, y / 111320 + latitude),
            geometry,
        )
    return transform(
        lambda x, y, z=None: ((x - longitude) * longitude_scale, (y - latitude) * 111320),
        geometry,
    )


def make_request(url: str, timeout: int = 90) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "RouteR-FutureCity-Scenario/1.0 (OpenStreetMap attribution included)"},
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                if response.status != 200:
                    raise RuntimeError(f"Data request failed with HTTP {response.status}: {url}")
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 4:
                detail = error.read().decode("utf-8", errors="replace")
                raise RuntimeError(
                    f"Data request failed with HTTP {error.code}: {detail[:300]}"
                ) from error
            retry_after = error.headers.get("Retry-After")
            delay = int(retry_after) if retry_after and retry_after.isdigit() else 8 * (attempt + 1)
            print(f"Data source rate-limited the request; retrying in {delay}s.", flush=True)
            time.sleep(delay)
    raise RuntimeError("Data request retry limit reached.")


def fetch_osm_extract(city: dict) -> tuple[ET.Element, dict]:
    half_degrees = 0.0225
    bounds = {
        "west": city["lon"] - half_degrees,
        "south": city["lat"] - half_degrees,
        "east": city["lon"] + half_degrees,
        "north": city["lat"] + half_degrees,
    }
    bbox = ",".join(f"{bounds[key]:.7f}" for key in ("west", "south", "east", "north"))
    url = f"{OSM_MAP_ENDPOINT}?{urllib.parse.urlencode({'bbox': bbox})}"
    cache_path = OSM_CACHE_DIRECTORY / f"{city['id']}.osm"
    if cache_path.exists():
        root = ET.fromstring(cache_path.read_bytes())
    else:
        osm_data = make_request(url)
        root = ET.fromstring(osm_data)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(osm_data)
    if root.tag != "osm":
        raise RuntimeError(f"Unexpected OpenStreetMap response for {city['name']}.")

    place_node = next(
        (node for node in root.findall("node") if node.get("id") == city["osmNodeId"]),
        None,
    )
    if place_node is None:
        raise RuntimeError(
            f"Mapped place node {city['osmNodeId']} for {city['name']} was absent from its OSM extract."
        )

    return root, {
        "bbox": bounds,
        "osmNodeId": city["osmNodeId"],
        "osmNodeUrl": f"https://www.openstreetmap.org/node/{city['osmNodeId']}",
        "placeLatitude": float(place_node.get("lat")),
        "placeLongitude": float(place_node.get("lon")),
        "snapshotDate": max(
            (element.get("timestamp", "") for element in root if element.get("timestamp")),
            default=None,
        ),
    }


def parse_tags(element: ET.Element) -> dict[str, str]:
    return {tag.get("k", ""): tag.get("v", "") for tag in element.findall("tag")}


def project_osm_features(root: ET.Element, city: dict) -> dict:
    nodes = {
        node.get("id"): (float(node.get("lon")), float(node.get("lat")))
        for node in root.findall("node")
    }

    def project_refs(way: ET.Element) -> list[tuple[float, float]] | None:
        refs = [node.get("ref", "") for node in way.findall("nd")]
        if len(refs) < 2 or any(reference not in nodes for reference in refs):
            return None
        geographic = [nodes[reference] for reference in refs]
        longitude_scale = 111320 * math.cos(math.radians(city["lat"]))
        return [
            (
                (longitude - city["lon"]) * longitude_scale,
                (latitude - city["lat"]) * 111320,
            )
            for longitude, latitude in geographic
        ]

    buildings = []
    roads = []
    restricted = []
    counts = {"ways": 0, "buildingWays": 0, "incompleteWays": 0}
    for way in root.findall("way"):
        counts["ways"] += 1
        tags = parse_tags(way)
        coordinates = project_refs(way)
        if coordinates is None:
            counts["incompleteWays"] += 1
            continue

        closed = len(coordinates) >= 4 and coordinates[0] == coordinates[-1]
        if tags.get("building") and tags["building"].lower() != "no" and closed:
            polygon = Polygon(coordinates)
            if not polygon.is_valid:
                polygon = polygon.buffer(0)
            if not polygon.is_empty and polygon.area > 1:
                buildings.append({"geometry": polygon, "id": way.get("id", ""), "tags": tags})
                counts["buildingWays"] += 1

        if tags.get("highway"):
            roads.append({"geometry": LineString(coordinates), "tags": tags})
        if tags.get("waterway"):
            restricted.append(
                {"geometry": LineString(coordinates), "kind": "waterway", "tags": tags}
            )
        if closed and (
            tags.get("natural") in {"water", "wetland", "wood", "scrub"}
            or tags.get("landuse")
            in {
                "water",
                "wetland",
                "forest",
                "farmland",
                "orchard",
                "vineyard",
                "nature_reserve",
                "military",
                "landfill",
                "quarry",
            }
            or tags.get("leisure") in {"park", "nature_reserve"}
            or tags.get("boundary") == "protected_area"
        ):
            polygon = Polygon(coordinates)
            if not polygon.is_valid:
                polygon = polygon.buffer(0)
            if not polygon.is_empty:
                restricted.append(
                    {"geometry": polygon, "kind": "restricted-area", "tags": tags}
                )

    counts["completeBuildings"] = len(buildings)
    counts["roadWays"] = len(roads)
    counts["restrictedWays"] = len(restricted)
    return {"buildings": buildings, "roads": roads, "restricted": restricted, "counts": counts}


def get_road_width(road_class: str) -> float:
    return {
        "motorway": 18,
        "trunk": 16,
        "primary": 14,
        "secondary": 12,
        "tertiary": 10,
        "residential": 8,
        "unclassified": 8,
        "service": 5,
        "track": 5,
    }.get(road_class, 6)


def road_bearing(point: Point, roads: list[dict]) -> float:
    nearest_distance = math.inf
    nearest_bearing = 0.0
    for road in roads:
        coordinates = list(road["geometry"].coords)
        for start, end in zip(coordinates, coordinates[1:]):
            segment = LineString((start, end))
            distance = segment.distance(point)
            if distance < nearest_distance:
                nearest_distance = distance
                nearest_bearing = math.degrees(
                    math.atan2(end[1] - start[1], end[0] - start[0])
                )
    return nearest_bearing


def elevation_grid(
    boundary, city_id: str, latitude: float, longitude: float
) -> tuple[dict, list[float]]:
    min_x, min_y, max_x, max_y = boundary.bounds
    start_x = math.floor(min_x / SITE_GRID_METERS) * SITE_GRID_METERS
    end_x = math.ceil(max_x / SITE_GRID_METERS) * SITE_GRID_METERS
    start_y = math.floor(min_y / SITE_GRID_METERS) * SITE_GRID_METERS
    end_y = math.ceil(max_y / SITE_GRID_METERS) * SITE_GRID_METERS
    grid = {
        (x, y): None
        for x in range(start_x - SITE_GRID_METERS, end_x + 2 * SITE_GRID_METERS, SITE_GRID_METERS)
        for y in range(start_y - SITE_GRID_METERS, end_y + 2 * SITE_GRID_METERS, SITE_GRID_METERS)
    }
    longitude_scale = 111320 * math.cos(math.radians(latitude))
    samples = list(grid)
    cache_path = ELEVATION_CACHE_DIRECTORY / f"{city_id}.json"
    if cache_path.exists():
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
        if cached.get("samples") == [list(point) for point in samples]:
            elevations = cached.get("elevations")
            if isinstance(elevations, list) and len(elevations) == len(samples):
                return dict(zip(samples, elevations)), samples
    requested_elevations = []
    for batch_start in range(0, len(samples), 100):
        batch = samples[batch_start : batch_start + 100]
        latitudes = [latitude + y / 111320 for _, y in batch]
        longitudes = [longitude + x / longitude_scale for x, _ in batch]
        query = urllib.parse.urlencode(
            {
                "latitude": ",".join(f"{value:.7f}" for value in latitudes),
                "longitude": ",".join(f"{value:.7f}" for value in longitudes),
            }
        )
        response = json.loads(make_request(f"{ELEVATION_ENDPOINT}?{query}"))
        elevations = response.get("elevation")
        if not isinstance(elevations, list) or len(elevations) != len(batch):
            raise RuntimeError("The Open-Meteo elevation response did not match the requested grid.")
        for coordinate, elevation in zip(batch, elevations):
            if elevation is None or not math.isfinite(float(elevation)):
                raise RuntimeError("The Copernicus DEM returned a missing elevation sample.")
            grid[coordinate] = float(elevation)
            requested_elevations.append(float(elevation))
        if batch_start + 100 < len(samples):
            time.sleep(7)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(
        json.dumps(
            {"samples": [list(point) for point in samples], "elevations": requested_elevations},
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    return grid, samples


def local_slope_percent(elevation_values: dict, x: int, y: int) -> float | None:
    step = SITE_GRID_METERS
    neighbors = [
        elevation_values.get((x - step, y)),
        elevation_values.get((x + step, y)),
        elevation_values.get((x, y - step)),
        elevation_values.get((x, y + step)),
    ]
    if any(value is None for value in neighbors):
        return None
    gradient_east = (neighbors[1] - neighbors[0]) / (2 * step)
    gradient_north = (neighbors[3] - neighbors[2]) / (2 * step)
    return math.hypot(gradient_east, gradient_north) * 100


def district_for_point(city: dict, point: Point, district_shapes: list[dict]) -> dict:
    for district in district_shapes:
        if district["geometry"].covers(point):
            return district
    return district_shapes[0]


def district_geometries(city: dict, boundary) -> list[dict]:
    center = Point(0, 0)
    max_radius = max(
        math.hypot(x, y)
        for x, y in (
            (boundary.bounds[0], boundary.bounds[1]),
            (boundary.bounds[0], boundary.bounds[3]),
            (boundary.bounds[2], boundary.bounds[1]),
            (boundary.bounds[2], boundary.bounds[3]),
        )
    )
    districts = city["districts"]
    colors = [city["accent"], "#58C6AC", "#78A9E8", "#9ACD79", "#E88C6F", "#B498E2"]
    features = [
        {
            "id": f"{city['id']}-district-0",
            "name": districts[0],
            "color": colors[0],
            "geometry": center.buffer(240).intersection(boundary),
        }
    ]
    sector_count = max(1, len(districts) - 1)
    outer_radius = max(max_radius + 10, 250)
    for index, name in enumerate(districts[1:]):
        start = 2 * math.pi * index / sector_count
        end = 2 * math.pi * (index + 1) / sector_count
        steps = max(8, math.ceil((end - start) * 18))
        outer = [
            (outer_radius * math.cos(start + (end - start) * step / steps),
             outer_radius * math.sin(start + (end - start) * step / steps))
            for step in range(steps + 1)
        ]
        inner = [
            (240 * math.cos(start + (end - start) * step / steps),
             240 * math.sin(start + (end - start) * step / steps))
            for step in range(steps, -1, -1)
        ]
        shape = Polygon(outer + inner).intersection(boundary)
        features.append(
            {
                "id": f"{city['id']}-district-{index + 1}",
                "name": name,
                "color": colors[(index + 1) % len(colors)],
                "geometry": shape,
            }
        )
    return [district for district in features if not district["geometry"].is_empty]


def geojson_feature(geometry, properties: dict, latitude: float, longitude: float) -> dict:
    geographic = project_geometry(geometry, latitude, longitude, inverse=True)
    return {"type": "Feature", "geometry": mapping(geographic), "properties": properties}


def generate_city(city: dict) -> tuple[dict, dict, dict]:
    osm_root, source = fetch_osm_extract(city)
    city = {**city, "lat": source["placeLatitude"], "lon": source["placeLongitude"]}
    features = project_osm_features(osm_root, city)
    center = Point(0, 0)
    nearby_buildings = [
        item["geometry"]
        for item in features["buildings"]
        if item["geometry"].distance(center) <= SETTLEMENT_EVIDENCE_RADIUS_METERS
    ]
    evidence = [center.buffer(75), *nearby_buildings]
    planning_boundary = unary_union(evidence).buffer(EXPANSION_BUFFER_METERS)
    if planning_boundary.is_empty or planning_boundary.area <= 0:
        raise RuntimeError(f"Could not derive a provisional planning boundary for {city['name']}.")

    elevation_values, elevation_samples = elevation_grid(
        planning_boundary, city["id"], city["lat"], city["lon"]
    )
    obstacles = [item["geometry"].buffer(8) for item in features["buildings"]]
    obstacles.extend(
        item["geometry"].buffer(get_road_width(item["tags"]["highway"]), cap_style="flat")
        for item in features["roads"]
    )
    obstacles.extend(
        item["geometry"].buffer(18 if item["kind"] == "waterway" else 10)
        for item in features["restricted"]
    )
    obstacle_union = unary_union(obstacles) if obstacles else None
    districts = district_geometries(city, planning_boundary)
    min_x, min_y, max_x, max_y = planning_boundary.bounds
    first_x = math.floor(min_x / SITE_GRID_METERS) * SITE_GRID_METERS
    last_x = math.ceil(max_x / SITE_GRID_METERS) * SITE_GRID_METERS
    first_y = math.floor(min_y / SITE_GRID_METERS) * SITE_GRID_METERS
    last_y = math.ceil(max_y / SITE_GRID_METERS) * SITE_GRID_METERS
    seed = int(hashlib.sha256(city["id"].encode("utf-8")).hexdigest()[:8], 16)
    jitter = random.Random(seed)
    candidate_sites = []

    for grid_x in range(first_x, last_x + 1, SITE_GRID_METERS):
        for grid_y in range(first_y, last_y + 1, SITE_GRID_METERS):
            x = grid_x + jitter.uniform(-3, 3)
            y = grid_y + jitter.uniform(-3, 3)
            point = Point(x, y)
            footprint = rotate(
                box(-SITE_FOOTPRINT_METERS / 2, -SITE_FOOTPRINT_METERS / 2,
                    SITE_FOOTPRINT_METERS / 2, SITE_FOOTPRINT_METERS / 2),
                road_bearing(point, features["roads"]),
                origin=(0, 0),
            )
            footprint = translate(footprint, xoff=x, yoff=y)
            if not planning_boundary.covers(footprint):
                continue
            if obstacle_union is not None and footprint.intersects(obstacle_union):
                continue

            snapped_x = round(x / SITE_GRID_METERS) * SITE_GRID_METERS
            snapped_y = round(y / SITE_GRID_METERS) * SITE_GRID_METERS
            slope = local_slope_percent(elevation_values, snapped_x, snapped_y)
            if slope is None or slope > MAX_BUILDING_SLOPE_PERCENT:
                continue
            district = district_for_point(city, point, districts)
            candidate_sites.append(
                {
                    "point": point,
                    "bearing": road_bearing(point, features["roads"]),
                    "slope": slope,
                    "district": district,
                    "slotId": f"{city['id']}-site-{len(candidate_sites) + 1:04d}",
                }
            )
            if len(candidate_sites) >= MAX_BUILDING_SITES:
                break
        if len(candidate_sites) >= MAX_BUILDING_SITES:
            break

    if not candidate_sites:
        raise RuntimeError(
            f"No buildable sites remained for {city['name']} after OSM and slope exclusions."
        )

    boundary_properties = {
        "feature_type": "settlement-boundary",
        "city_id": city["id"],
        "name": f"{city['name']} provisional visual planning boundary",
        "boundary_kind": "place-and-building-evidence-with-500m-buffer",
        "official_boundary": False,
        "is_synthetic": True,
        "osm_place": city["mappedPlace"],
        "osm_node_id": city["osmNodeId"],
        "osm_license": OSM_LICENSE,
        "expansion_buffer_m": EXPANSION_BUFFER_METERS,
        "observed_buildings_within_1km": len(nearby_buildings),
    }
    boundary_feature = geojson_feature(
        planning_boundary, boundary_properties, city["lat"], city["lon"]
    )
    center_feature = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [city["lon"], city["lat"]]},
        "properties": {
            "feature_type": "city-anchor",
            "city_id": city["id"],
            "name": city["name"],
            "mapped_place": city["mappedPlace"],
            "osm_node_id": city["osmNodeId"],
            "is_synthetic": False,
        },
    }

    boundary_collection = {
        "type": "FeatureCollection",
        "name": f"{city['name']} provisional planning boundary",
        "features": [boundary_feature, center_feature],
        "metadata": {
            "city_id": city["id"],
            "osm_license": OSM_LICENSE,
            "official_boundary": False,
            "osm_place_node": source["osmNodeUrl"],
            "snapshot_date": source["snapshotDate"],
            "expansion_buffer_m": EXPANSION_BUFFER_METERS,
        },
    }

    scenario_features = [boundary_feature, center_feature]
    visible_buildings = 0
    for item in features["buildings"]:
        polygon = item["geometry"]
        if not polygon.intersects(planning_boundary):
            continue
        levels = item["tags"].get("building:levels")
        try:
            height = float(item["tags"].get("height", "").lower().replace("m", "").strip())
        except ValueError:
            try:
                height = max(3, float(levels) * 3)
            except (TypeError, ValueError):
                height = 8
        scenario_features.append(
            geojson_feature(
                polygon,
                {
                    "feature_type": "existing-building",
                    "city_id": city["id"],
                    "osm_id": item["id"],
                    "building_type": item["tags"].get("building", "yes"),
                    "height_m": height,
                    "base_height_m": 0,
                    "is_synthetic": False,
                    "source": "OpenStreetMap",
                },
                city["lat"],
                city["lon"],
            )
        )
        visible_buildings += 1

    district_features = []
    for district in districts:
        district_features.append(
            geojson_feature(
                district["geometry"],
                {
                    "feature_type": "future-district",
                    "city_id": city["id"],
                    "district_id": district["id"],
                    "district_name": district["name"],
                    "color": district["color"],
                    "is_synthetic": True,
                },
                city["lat"],
                city["lon"],
            )
        )
    scenario_features.extend(district_features)

    total_future_buildings = min(
        MAX_BUILDING_SITES, max(12, round(len(candidate_sites) * 0.48))
    )
    signature_tower_count = min(
        4, max(1, round(math.sqrt(len(candidate_sites) / 30)))
    )
    building_classes = [
        ("signature", signature_tower_count, 100, 46, 42),
        ("secondary_skyscraper", round(total_future_buildings * 0.10), 75, 50, 42),
        ("high_rise", round(total_future_buildings * 0.18), 55, 46, 38),
        ("mid_rise", round(total_future_buildings * 0.38), 32, 38, 32),
    ]
    allocations = []
    remaining = total_future_buildings
    for building_type, requested, height, width, depth in building_classes:
        count = min(requested, max(0, remaining))
        allocations.extend([(building_type, height, width, depth)] * count)
        remaining -= count
    allocations.extend([("low_rise", 14, 30, 26)] * max(0, remaining))

    ordered_sites = sorted(
        candidate_sites,
        key=lambda site: (
            site["point"].distance(center),
            random.Random(f"{seed}:{site['slotId']}").random(),
        ),
    )
    future_building_features = []
    for index, (site, allocation) in enumerate(zip(ordered_sites, allocations)):
        building_type, height, width, depth = allocation
        footprint = rotate(
            box(-width / 2, -depth / 2, width / 2, depth / 2),
            site["bearing"],
            origin=(0, 0),
        )
        footprint = translate(
            footprint, xoff=site["point"].x, yoff=site["point"].y
        )
        future_building_features.append(
            geojson_feature(
                footprint,
                {
                    "feature_type": "future-building",
                    "city_id": city["id"],
                    "building_id": f"{city['id']}-future-{index + 1:04d}",
                    "district_id": site["district"]["id"],
                    "district_name": site["district"]["name"],
                    "district_color": site["district"]["color"],
                    "building_type": building_type,
                    "height_m": height,
                    "base_height_m": 0,
                    "footprint_width_m": width,
                    "footprint_depth_m": depth,
                    "bearing_deg": round(site["bearing"], 2),
                    "slope_percent": round(site["slope"], 2),
                    "is_synthetic": True,
                    "scenario_year": 2050,
                    "generation_seed": seed,
                    "architecture_style": (
                        "three-wing-radial-setback" if building_type == "signature"
                        else "contemporary-sustainable"
                    ),
                    "tower_instance": building_type == "signature",
                },
                city["lat"],
                city["lon"],
            )
        )

    scenario_features.extend(future_building_features)
    for site in ordered_sites:
        scenario_features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        city["lon"] + site["point"].x / (111320 * math.cos(math.radians(city["lat"]))),
                        city["lat"] + site["point"].y / 111320,
                    ],
                },
                "properties": {
                    "feature_type": "candidate-site",
                    "city_id": city["id"],
                    "site_id": site["slotId"],
                    "bearing_deg": site["bearing"],
                    "slope_percent": round(site["slope"], 2),
                    "max_footprint_m": SITE_FOOTPRINT_METERS,
                    "district_id": site["district"]["id"],
                    "district_name": site["district"]["name"],
                    "is_synthetic": True,
                    "is_buildable_candidate": True,
                },
            }
        )

    corridor_radius = max(350, min(max(
        abs(planning_boundary.bounds[0]),
        abs(planning_boundary.bounds[1]),
        abs(planning_boundary.bounds[2]),
        abs(planning_boundary.bounds[3]),
    ), 1200))
    for corridor_index, angle in enumerate((0, math.pi / 2, math.pi, 3 * math.pi / 2)):
        corridor = LineString(
            [
                (0, 0),
                (
                    corridor_radius * math.cos(angle),
                    corridor_radius * math.sin(angle),
                ),
            ]
        ).intersection(planning_boundary)
        if corridor.is_empty or corridor.length < 50:
            continue
        scenario_features.append(
            geojson_feature(
                corridor,
                {
                    "feature_type": "future-green-corridor",
                    "city_id": city["id"],
                    "corridor_id": f"{city['id']}-green-corridor-{corridor_index + 1}",
                    "name": f"{city['name']} proposed green mobility corridor",
                    "is_synthetic": True,
                    "scenario_year": 2050,
                },
                city["lat"],
                city["lon"],
            )
        )

    bounds = planning_boundary.bounds
    catalog_city = {
        "id": city["id"],
        "name": city["name"],
        "mappedPlace": city["mappedPlace"],
        "identity": city["identity"],
        "accent": city["accent"],
        "center": {"lat": city["lat"], "lon": city["lon"]},
        "osmNodeId": city["osmNodeId"],
        "districts": [
            {"id": district["id"], "name": district["name"], "color": district["color"]}
            for district in districts
        ],
        "bounds": [
            city["lon"] + bounds[0] / (111320 * math.cos(math.radians(city["lat"]))),
            city["lat"] + bounds[1] / 111320,
            city["lon"] + bounds[2] / (111320 * math.cos(math.radians(city["lat"]))),
            city["lat"] + bounds[3] / 111320,
        ],
        "featureCounts": {
            "observedBuildingsWithin1Km": len(nearby_buildings),
            "observedBuildingsInBoundary": visible_buildings,
            "candidateSites": len(candidate_sites),
            "futureBuildings": len(future_building_features),
            "signatureTowers": sum(
                feature["properties"]["building_type"] == "signature"
                for feature in future_building_features
            ),
            "terrainSamples": len(elevation_samples),
        },
    }
    scenario_collection = {
        "type": "FeatureCollection",
        "name": f"{city['name']} synthetic future-city scenario inputs",
        "features": scenario_features,
        "metadata": {
            "city": catalog_city,
            "snapshot_date": source["snapshotDate"],
            "osm_license": OSM_LICENSE,
            "osm_extraction_bounds": source["bbox"],
            "osm_counts": features["counts"],
            "elevation_source": "Open-Meteo Elevation API / Copernicus DEM GLO-90",
            "elevation_source_url": "https://open-meteo.com/en/docs/elevation-api",
            "elevation_resolution_m": 90,
            "maximum_building_slope_percent": MAX_BUILDING_SLOPE_PERCENT,
            "terrain_screening_note": (
                "Planning-level slope screen from 90 m elevation samples; "
                "not a site survey or engineering assessment."
            ),
            "candidate_site_count": len(candidate_sites),
            "observed_buildings_within_1km": len(nearby_buildings),
            "official_boundary": False,
            "generator_seed": 2050,
            "max_generated_buildings": total_future_buildings,
            "signature_tower_target": signature_tower_count,
            "osm_attribution": "© OpenStreetMap contributors",
            "elevation_attribution": "Elevation data © Copernicus; API by Open-Meteo",
        },
    }
    return boundary_collection, scenario_collection, catalog_city


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main() -> None:
    boundary_directory = OUTPUT_DIRECTORY / "boundaries"
    scenario_directory = OUTPUT_DIRECTORY / "scenarios"
    catalog_cities = []
    generated_at = datetime.now(timezone.utc).isoformat()

    for index, city in enumerate(CITIES):
        if index:
            time.sleep(1.1)
        boundaries, scenario, catalog_city = generate_city(city)
        write_json(boundary_directory / f"{city['id']}.geojson", boundaries)
        write_json(scenario_directory / f"{city['id']}.geojson", scenario)
        catalog_cities.append(catalog_city)
        counts = scenario["metadata"]["osm_counts"]
        print(
            f"{city['name']}: {counts['completeBuildings']} mapped building ways; "
            f"{scenario['metadata']['candidate_site_count']} slope-screened buildable sites; "
            f"{len(scenario['features'])} cached GeoJSON features",
            flush=True,
        )

    write_json(
        OUTPUT_DIRECTORY / "catalog.json",
        {
            "generated_at": generated_at,
            "osm_attribution": "© OpenStreetMap contributors",
            "osm_license": OSM_LICENSE,
            "elevation_attribution": "Elevation data © Copernicus; API by Open-Meteo",
            "official_boundaries": False,
            "cities": catalog_cities,
        },
    )


if __name__ == "__main__":
    main()
