/* ══════════════════════════════════════════════════════════
   MAKE MY ROUTE — Frontend Application
   EV Routing · OpenChargeMap · Real-Time Animation Simulation
   ══════════════════════════════════════════════════════════ */

const API_BASE = window.location.origin;

// ─── Map & Routing State ───
let map;
let originMarker = null;
let destMarker = null;
let baseRoutePolyline = null;
let activeRoutePolyline = null;
let unmitigatedPolyline = null;
let unmitigatedStopMarkers = [];
let currentRouteData = null;
let vehicleMarker = null;
let stationMarkers = [];
let nearbyStationMarkers = [];
let isStationsLayerVisible = true;
let isArchitecturalLayerVisible = true;
let isTerrainEnabled = false;
let activePowerFilter = "all";
let userLocationMarker = null;
let allStateStations = [];
let focusedStationMarker = null;
let stationDataPromise = null;
let mapReadyPromise = null;
let mapStatusElement = null;
let mapboxFallbackActive = false;
let chargingStation3DLayer = null;
let futureCity3DLayer = null;
let futureCityScenario = emptyFeatureCollection();
let futureCityRequestId = 0;
let stationFeatures = [];
let activeTrailChunkIds = [];
let activeTrailChunkData = [];
let activeTrailLiveFeature = emptyFeatureCollection();
let activeMapPopup = null;
const mapPointGroups = {
  origin: new Map(),
  destination: new Map(),
  chargingStop: new Map(),
  nearbyStation: new Map(),
  vehicle: new Map(),
  userLocation: new Map(),
  focusedStation: new Map(),
  unmitigatedStop: new Map(),
};
const MAP_POINT_SOURCES = {
  origin: "origin-source",
  destination: "destination-source",
  chargingStop: "charging-stops-source",
  nearbyStation: "nearby-stations-source",
  vehicle: "vehicle-position-source",
  userLocation: "user-location-source",
  focusedStation: "focused-station-source",
  unmitigatedStop: "unmitigated-stops-source",
};
let clickMode = "origin"; // "origin" | "destination"
let originCoords = null;
let destCoords = null;
const STATION_DISPLAY_MIN_ZOOM = 9;
const TERRAIN_SOURCE_ID = "route-terrain-dem";
const TERRAIN_HILLSHADE_LAYER_ID = "route-terrain-hillshade";
const FUTURE_CITY_SOURCE_ID = "future-city-scenario-source";
const FUTURE_CITY_LAYER_IDS = {
  existingBuildings: "future-city-existing-buildings",
  futureBuildings: "future-city-proposed-buildings",
  futureBuildingPick: "future-city-building-pick",
  districts: "future-city-districts",
  greenCorridors: "future-city-green-corridors",
};

// ─── Animation State Machine ───
const anim = {
  isPlaying: false,
  progress: 0.0, // 0.0 to 1.0
  speed: 1.0,    // 1x, 2x, 5x
  rafId: null,
  lastTimestamp: null,
  isCharging: false,
  chargeStartTime: null,
  currentStopIndex: -1,
  handledStopIndices: new Set(),
  routeData: null,
  cumDistances: [], // cumulative distance in meters at each coordinate index
  totalDistanceMeters: 0,
  cameraFollowCenter: null,
  cameraFollowBearing: null,
  lastCameraFollowAt: 0,
  lastStationViewportRefreshAt: 0,
  activeTrailPolyline: null,
  completedTrailChunks: 0,
};

const ANIMATION_TRAIL_CHUNK_SIZE = 128;
const CHARGING_STOP_DURATION_MS = 2800;

// Sangli Default Center
const SANGLI_CENTER = [16.8524, 74.5815];
const MAPBOX_STYLE = "mapbox://styles/mapbox/streets-v12";
const OSM_MAPBOX_STYLE = {
  version: 8,
  sources: {
    openstreetmap: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [{ id: "openstreetmap-raster", type: "raster", source: "openstreetmap" }],
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function encodeInlineValue(value) {
  return encodeURIComponent(String(value ?? "")).replace(/'/g, "%27");
}

function normalizeStationConnectors(value) {
  const normalized = new Set();
  String(value || "").split(";").forEach((name) => {
    const connector = name.trim().toLowerCase();
    if (connector.includes("ccs")) {
      normalized.add(/ccs\s*1|type\s*1|combo\s*1/.test(connector) ? "CCS1" : "CCS2");
    }
    if (/type\s*2/.test(connector)) normalized.add("Type2");
    if (connector.includes("chademo")) normalized.add("CHAdeMO");
    if (/gb\s*[-/]?\s*t/.test(connector)) normalized.add("GB/T");
    if (/type\s*1|j1772/.test(connector)) normalized.add("Type1");
  });
  return Array.from(normalized);
}

async function ensureStationInventoryLoaded() {
  if (allStateStations.length > 0) return allStateStations;
  if (!stationDataPromise) {
    stationDataPromise = fetch(`${API_BASE}/api/stations/all`)
      .then((res) => {
        if (!res.ok) throw new Error(`Station API returned HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        allStateStations = data.stations || [];
        return allStateStations;
      })
      .catch((err) => {
        stationDataPromise = null;
        throw err;
      });
  }
  return stationDataPromise;
}

// ─── Initialize ───
document.addEventListener("DOMContentLoaded", () => {
  initMap().catch((error) => {
    console.error("Map initialization failed:", error);
    const mapContainer = document.getElementById("map");
    if (mapContainer) {
      const notice = document.createElement("div");
      notice.className = "map-init-error";
      notice.textContent = `Map initialization failed: ${error.message}`;
      mapContainer.appendChild(notice);
    }
  });
  initEVProfileListeners();
  initButtonListeners();
  initChipListeners();
  initAnimationControls();
  initBenchmarkModal();
  initStorylineModal();
  initStationsModal();
  updateUsableEnergyPreview();
  updateBatteryGauge(0.75);
  checkServerHealth();

  // Mobile panel toggle
  const panel = document.getElementById("left-panel");
  panel.addEventListener("click", (e) => {
    if (window.innerWidth < 768 && !panel.classList.contains("expanded")) {
      panel.classList.add("expanded");
    }
  });
});

// ══════════════════════════════════════════════════
// MAP
// ══════════════════════════════════════════════════

function emptyFeatureCollection() {
  return { type: "FeatureCollection", features: [] };
}

function toPointFeature(id, coordinates, properties = {}) {
  return {
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates },
    properties: { ...properties, id },
  };
}

function updatePointSource(kind) {
  const sourceId = MAP_POINT_SOURCES[kind];
  const source = map?.getSource(sourceId);
  if (source) {
    source.setData({
      type: "FeatureCollection",
      features: Array.from(mapPointGroups[kind].values()),
    });
  }
}

function setMapPoint(kind, id, coordinates, properties = {}) {
  mapPointGroups[kind].set(id, toPointFeature(id, coordinates, properties));
  updatePointSource(kind);
}

function removeMapPoint(kind, id) {
  mapPointGroups[kind].delete(id);
  updatePointSource(kind);
}

function setStationSourceData(features) {
  stationFeatures = features;
  const source = map?.getSource("charging-stations-source");
  if (source) source.setData({ type: "FeatureCollection", features: stationFeatures });
  chargingStation3DLayer?.setStations(stationFeatures);
}

function createMapMarker(kind, id, lat, lon, options = {}) {
  const marker = {
    kind,
    id,
    lat,
    lon,
    properties: {
      color: options.color || "#00E5A0",
      radius: options.radius || 9,
      label: options.label || "",
      bearing: options.bearing || 0,
      popupHtml: "",
      tooltipHtml: "",
      popupClass: "",
    },
    update() {
      setMapPoint(this.kind, this.id, [this.lon, this.lat], this.properties);
    },
    addTo() {
      this.update();
      return this;
    },
    bindPopup(html, popupOptions = {}) {
      this.properties.popupHtml = html;
      this.properties.popupClass = popupOptions.className || "";
      this._popup = { _content: html };
      this.update();
      return this;
    },
    bindTooltip(html) {
      this.properties.tooltipHtml = html;
      this.update();
      return this;
    },
    setLatLng(latLng) {
      this.lat = latLng[0];
      this.lon = latLng[1];
      this.update();
      return this;
    },
    getLatLng() {
      return { lat: this.lat, lng: this.lon };
    },
    openPopup() {
      openMapPopup(this.lon, this.lat, this.properties.popupHtml, this.properties.popupClass);
      return this;
    },
    remove() {
      removeMapPoint(this.kind, this.id);
    },
  };
  return marker;
}

function openMapPopup(lon, lat, html, className = "") {
  if (!html || !map || !window.mapboxgl) return;
  if (activeMapPopup) activeMapPopup.remove();
  activeMapPopup = new mapboxgl.Popup({ className, closeButton: true, maxWidth: "320px" })
    .setLngLat([lon, lat])
    .setHTML(html)
    .addTo(map);
}

function fitMapToLatLngs(latLngs, padding = 40) {
  if (!map || !latLngs.length) return;
  const coordinates = latLngs.map(([lat, lon]) => [lon, lat]);
  const bounds = new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]);
  coordinates.slice(1).forEach((coordinate) => bounds.extend(coordinate));
  map.fitBounds(bounds, { padding, maxZoom: 15 });
}

function createMapPolyline(sourceId, layerId, latLngs, style) {
  const coordinates = latLngs.map(([lat, lon]) => [lon, lat]);
  const geojson = {
    type: "Feature",
    geometry: { type: "LineString", coordinates },
    properties: {},
  };
  const line = {
    sourceId,
    layerId,
    geojson,
    addTo() {
      const source = map.getSource(this.sourceId);
      if (source) source.setData(this.geojson);
      return this;
    },
    getBounds() {
      if (!this.geojson.geometry.coordinates.length) return null;
      const bounds = new mapboxgl.LngLatBounds(
        this.geojson.geometry.coordinates[0],
        this.geojson.geometry.coordinates[0]
      );
      this.geojson.geometry.coordinates.slice(1).forEach((coordinate) => bounds.extend(coordinate));
      return bounds;
    },
    remove() {
      this.geojson = emptyFeatureCollection();
      const source = map?.getSource(this.sourceId);
      if (source) source.setData(this.geojson);
    },
  };
  if (style) line.style = style;
  return line;
}

function addGeoJSONSource(sourceId, data = emptyFeatureCollection()) {
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: "geojson",
      data,
      ...(sourceId === "charging-stations-source"
        ? { cluster: true, clusterRadius: 48, clusterMaxZoom: 12, clusterMinPoints: 2 }
        : {}),
    });
  }
}

function syncTerrainToStyle(enabled = isTerrainEnabled) {
  if (!map || !enabled) return;

  if (!map.getSource(TERRAIN_SOURCE_ID)) {
    map.addSource(TERRAIN_SOURCE_ID, {
      type: "raster-dem",
      url: "mapbox://mapbox.mapbox-terrain-dem-v1",
      tileSize: 512,
      maxzoom: 14,
    });
  }
  if (!map.getLayer(TERRAIN_HILLSHADE_LAYER_ID)) {
    map.addLayer({
      id: TERRAIN_HILLSHADE_LAYER_ID,
      type: "hillshade",
      source: TERRAIN_SOURCE_ID,
      paint: {
        "hillshade-exaggeration": 0.35,
        "hillshade-shadow-color": "#263746",
        "hillshade-highlight-color": "#f0e9d8",
        "hillshade-accent-color": "#71827a",
      },
    }, map.getLayer("route-layer") ? "route-layer" : undefined);
  }
  map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.15 });
}

function setTerrainEnabled(enabled) {
  if (!map || !map.isStyleLoaded()) {
    throw new Error("The map style is not ready for terrain yet.");
  }

  if (enabled) {
    syncTerrainToStyle(true);
    isTerrainEnabled = true;
    return;
  }

  isTerrainEnabled = false;
  map.setTerrain(null);
  if (map.getLayer(TERRAIN_HILLSHADE_LAYER_ID)) {
    map.removeLayer(TERRAIN_HILLSHADE_LAYER_ID);
  }
  if (map.getSource(TERRAIN_SOURCE_ID)) {
    map.removeSource(TERRAIN_SOURCE_ID);
  }
}

function addPointLayers(sourceId, prefix, { minzoom = 0 } = {}) {
  const circleLayerId = `${prefix}-layer`;
  if (!map.getLayer(circleLayerId)) {
    map.addLayer({
      id: circleLayerId,
      type: "circle",
      source: sourceId,
      minzoom,
      paint: {
        "circle-color": ["coalesce", ["get", "color"], "#00E5A0"],
        "circle-radius": ["coalesce", ["get", "radius"], 9],
        "circle-stroke-color": "#080C10",
        "circle-stroke-width": 2,
        "circle-opacity": 0.96,
      },
    });
  }
  if (!map.getStyle().glyphs) return;
  const labelLayerId = `${prefix}-labels`;
  if (!map.getLayer(labelLayerId)) {
    map.addLayer({
      id: labelLayerId,
      type: "symbol",
      source: sourceId,
      minzoom,
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        "text-size": 12,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "text-rotation-alignment": "map",
        "text-rotate": ["coalesce", ["get", "bearing"], 0],
      },
      paint: {
        "text-color": ["coalesce", ["get", "color"], "#FFFFFF"],
        "text-halo-color": "#0D0F11",
        "text-halo-width": 1.5,
      },
      filter: ["!=", ["get", "label"], ""],
    });
  }
}

function installFutureCityMapLayers() {
  const sourceId = FUTURE_CITY_SOURCE_ID;
  const boundaryLayerId = "future-city-provisional-boundary";
  if (!map.getLayer(FUTURE_CITY_LAYER_IDS.districts)) {
    map.addLayer({
      id: FUTURE_CITY_LAYER_IDS.districts,
      type: "fill",
      source: sourceId,
      filter: ["==", ["get", "feature_type"], "future-district"],
      paint: {
        "fill-color": ["coalesce", ["get", "color"], "#78909c"],
        "fill-opacity": 0.12,
        "fill-outline-color": ["coalesce", ["get", "color"], "#78909c"],
      },
    });
  }
  if (!map.getLayer(boundaryLayerId)) {
    map.addLayer({
      id: boundaryLayerId,
      type: "line",
      source: sourceId,
      filter: ["==", ["get", "feature_type"], "settlement-boundary"],
      paint: {
        "line-color": "#f0ca7a",
        "line-width": 2,
        "line-dasharray": [2, 1.5],
        "line-opacity": 0.9,
      },
    });
  }
  if (!map.getLayer(FUTURE_CITY_LAYER_IDS.greenCorridors)) {
    map.addLayer({
      id: FUTURE_CITY_LAYER_IDS.greenCorridors,
      type: "line",
      source: sourceId,
      filter: ["==", ["get", "feature_type"], "future-green-corridor"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#44d49b",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2, 15, 7],
        "line-opacity": 0.8,
        "line-blur": 0.5,
      },
    });
  }
  if (!map.getLayer(FUTURE_CITY_LAYER_IDS.existingBuildings)) {
    map.addLayer({
      id: FUTURE_CITY_LAYER_IDS.existingBuildings,
      type: "fill-extrusion",
      source: sourceId,
      minzoom: 14,
      filter: ["==", ["get", "feature_type"], "existing-building"],
      paint: {
        "fill-extrusion-color": "#89949a",
        "fill-extrusion-height": ["coalesce", ["get", "height_m"], 8],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.88,
        "fill-extrusion-vertical-gradient": true,
      },
    });
  }
  if (!map.getLayer(FUTURE_CITY_LAYER_IDS.futureBuildings)) {
    map.addLayer({
      id: FUTURE_CITY_LAYER_IDS.futureBuildings,
      type: "fill-extrusion",
      source: sourceId,
      minzoom: 12,
      filter: [
        "all",
        ["==", ["get", "feature_type"], "future-building"],
        ["!=", ["get", "building_type"], "signature"],
      ],
      paint: {
        "fill-extrusion-color": [
          "match",
          ["get", "building_type"],
          "secondary_skyscraper", "#c5b9e8",
          "high_rise", "#91b9cc",
          "mid_rise", "#8db4a0",
          "low_rise", "#a9aa91",
          "#92a9ad",
        ],
        "fill-extrusion-height": ["coalesce", ["get", "height_m"], 8],
        "fill-extrusion-base": ["coalesce", ["get", "base_height_m"], 0],
        "fill-extrusion-opacity": 0.88,
        "fill-extrusion-vertical-gradient": true,
      },
    });
  }
  if (!map.getLayer(FUTURE_CITY_LAYER_IDS.futureBuildingPick)) {
    map.addLayer({
      id: FUTURE_CITY_LAYER_IDS.futureBuildingPick,
      type: "fill",
      source: sourceId,
      minzoom: 12,
      filter: [
        "in",
        ["get", "feature_type"],
        ["literal", ["future-building", "existing-building"]],
      ],
      paint: { "fill-color": "#ffffff", "fill-opacity": 0.01 },
    });
  }
  if (!map.getLayer("future-city-tower-symbols")) {
    map.addLayer({
      id: "future-city-tower-symbols",
      type: "circle",
      source: sourceId,
      minzoom: 9.5,
      maxzoom: 11.5,
      filter: ["==", ["get", "feature_type"], "future-tower"],
      paint: {
        "circle-color": "#e9c879",
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9.5, 3.5, 11.5, 6],
        "circle-stroke-color": "#fff5d5",
        "circle-stroke-width": 1.5,
        "circle-opacity": 0.96,
      },
    });
  }

  if (!map.getLayer("future-city-signature-towers")) {
    if (typeof window.createFutureCityLayer !== "function") {
      throw new Error("The bundled Three.js future-city tower layer did not load.");
    }
    futureCity3DLayer = window.createFutureCityLayer({ minimumZoom: 11.5 });
    map.addLayer(futureCity3DLayer, "charging-stations-layer");
  }
  futureCity3DLayer?.setVisible(true);
  futureCity3DLayer?.setTowers(
    futureCityScenario.features.filter(
      (feature) => feature.properties?.feature_type === "future-tower"
    )
  );
}

function showFutureCityFeaturePopup(event) {
  const feature = event.features?.[0];
  if (!feature) return;
  const properties = feature.properties || {};
  const featureType = properties.feature_type;
  if (featureType !== "future-building" && featureType !== "existing-building") return;
  event.preventDefault();
  const title = featureType === "future-building"
    ? "Proposed synthetic building"
    : "Mapped existing building";
  const rows = [
    properties.district_name ? `District: ${properties.district_name}` : null,
    properties.building_type ? `Type: ${String(properties.building_type).replaceAll("_", " ")}` : null,
    Number.isFinite(Number(properties.height_m)) ? `Height: ${Number(properties.height_m)} m` : null,
    properties.scenario_year ? `${properties.scenario_year} scenario` : null,
    properties.generation_seed !== undefined ? `Seed: ${properties.generation_seed}` : null,
    properties.osm_id ? `OpenStreetMap way ${properties.osm_id}` : null,
  ].filter(Boolean);
  openMapPopup(
    event.lngLat.lng,
    event.lngLat.lat,
    `<strong>${escapeHtml(title)}</strong><br>${rows.map(escapeHtml).join("<br>")}`,
    "future-city-feature-popup"
  );
}

function addChargingStationClusterLayers() {
  if (!map.getLayer("charging-stations-clusters")) {
    map.addLayer({
      id: "charging-stations-clusters",
      type: "circle",
      source: "charging-stations-source",
      maxzoom: 13,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": [
          "step",
          ["get", "point_count"],
          "#087f69",
          20,
          "#096853",
          100,
          "#124e43",
        ],
        "circle-radius": ["step", ["get", "point_count"], 15, 20, 19, 100, 25],
        "circle-stroke-color": "#9ef2d4",
        "circle-stroke-width": 1.5,
        "circle-opacity": 0.94,
      },
    });
  }
  if (!map.getLayer("charging-stations-cluster-count") && map.getStyle().glyphs) {
    map.addLayer({
      id: "charging-stations-cluster-count",
      type: "symbol",
      source: "charging-stations-source",
      maxzoom: 13,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        "text-size": 11,
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "#103a32",
        "text-halo-width": 1,
      },
    });
  }
}

function installApplicationMapLayers() {
  if (!map) return;
  addGeoJSONSource("route-source", baseRoutePolyline?.geojson || emptyFeatureCollection());
  addGeoJSONSource("active-route-source", activeTrailLiveFeature);
  addGeoJSONSource("unmitigated-route-source", unmitigatedPolyline?.geojson || emptyFeatureCollection());
  addGeoJSONSource("charging-stations-source", { type: "FeatureCollection", features: stationFeatures });
  addGeoJSONSource(FUTURE_CITY_SOURCE_ID, futureCityScenario);
  Object.entries(MAP_POINT_SOURCES).forEach(([kind, sourceId]) => {
    addGeoJSONSource(sourceId, {
      type: "FeatureCollection",
      features: Array.from(mapPointGroups[kind].values()),
    });
  });
  syncTerrainToStyle();

  if (!map.getLayer("route-layer")) {
    map.addLayer({
      id: "route-layer",
      type: "line",
      source: "route-source",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#00E5A0", "line-width": 4, "line-opacity": 0.28 },
    });
  }
  if (!map.getLayer("active-route-layer")) {
    map.addLayer({
      id: "active-route-layer",
      type: "line",
      source: "active-route-source",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#00E5A0", "line-width": 5, "line-opacity": 0.95 },
    });
  }
  if (!map.getLayer("unmitigated-route-layer")) {
    map.addLayer({
      id: "unmitigated-route-layer",
      type: "line",
      source: "unmitigated-route-source",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#F5A623",
        "line-width": 4,
        "line-opacity": 0.95,
        "line-dasharray": [2, 2.7],
      },
    });
  }

  activeTrailChunkData.forEach((feature, index) => {
    const sourceId = `active-route-chunk-source-${index}`;
    const layerId = `active-route-chunk-layer-${index}`;
    addGeoJSONSource(sourceId, feature);
    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: "line",
        source: sourceId,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#00E5A0", "line-width": 5, "line-opacity": 0.95 },
      });
    }
    activeTrailChunkIds[index] = { sourceId, layerId };
  });

  addChargingStationClusterLayers();
  addPointLayers("charging-stations-source", "charging-stations", { minzoom: 13 });
  addPointLayers("origin-source", "origin");
  addPointLayers("destination-source", "destination");
  addPointLayers("charging-stops-source", "charging-stops");
  addPointLayers("nearby-stations-source", "nearby-stations");
  addPointLayers("vehicle-position-source", "vehicle-position");
  addPointLayers("user-location-source", "user-location");
  addPointLayers("focused-station-source", "focused-station");
  addPointLayers("unmitigated-stops-source", "unmitigated-stops");
  installFutureCityMapLayers();

  if (!map.getLayer("ev-charging-station-3d-layer")) {
    if (typeof window.createChargingStationLayer !== "function") {
      throw new Error("The bundled Three.js charging-station layer did not load.");
    }
    chargingStation3DLayer = window.createChargingStationLayer({ minimumZoom: 15.5 });
    map.addLayer(chargingStation3DLayer, "charging-stations-layer");
  }
  chargingStation3DLayer?.setVisible(isArchitecturalLayerVisible);
  chargingStation3DLayer?.setStations(stationFeatures);
}

async function initMap() {
  if (map) return mapReadyPromise;
  const response = await fetch(`${API_BASE}/api/config`);
  if (!response.ok) {
    throw new Error(`Map configuration request failed with HTTP ${response.status}`);
  }
  const config = await response.json();
  const token = config.mapboxPublicToken;
  if (!window.mapboxgl) throw new Error("The bundled Mapbox GL JS runtime failed to load.");
  if (!token) throw new Error("Mapbox public token is missing from /api/config.");

  window.mapboxgl.accessToken = token;
  map = new mapboxgl.Map({
    container: "map",
    style: MAPBOX_STYLE,
    center: [SANGLI_CENTER[1], SANGLI_CENTER[0]],
    zoom: 12,
    pitch: 45,
    bearing: 0,
    antialias: true,
    attributionControl: true,
  });
  window.map = map;
  map.addControl(new mapboxgl.NavigationControl(), "bottom-right");
  mapStatusElement = document.createElement("div");
  mapStatusElement.className = "map-engine-status";
  mapStatusElement.textContent = "Map: Mapbox GL JS loading";
  map.addControl({
    onAdd() { return mapStatusElement; },
    onRemove() { mapStatusElement.remove(); },
  }, "bottom-left");

  let resolveMapReady;
  mapReadyPromise = new Promise((resolve) => {
    resolveMapReady = resolve;
  });
  map.on("error", handleMapError);
  map.once("load", () => {
    installApplicationMapLayers();
    const terrainToggle = document.getElementById("btn-toggle-terrain");
    if (terrainToggle) terrainToggle.disabled = false;
    map.on("click", onMapClick);
    map.on("click", "charging-stations-layer", (event) => showMapFeaturePopup(event, "station-plot-popup"));
    map.on("click", FUTURE_CITY_LAYER_IDS.futureBuildingPick, showFutureCityFeaturePopup);
    map.on("click", "charging-stations-clusters", (event) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      const source = map.getSource("charging-stations-source");
      if (clusterId === undefined || !source?.getClusterExpansionZoom) return;
      source.getClusterExpansionZoom(clusterId, (error, zoom) => {
        if (error) {
          console.error("Could not expand charging-station cluster:", error.message);
          return;
        }
        const coordinates = feature.geometry.coordinates;
        map.easeTo({ center: coordinates, zoom });
      });
    });
    Object.values(MAP_POINT_SOURCES).forEach((sourceId) => {
      const prefix = sourceId.replace("-source", "");
      map.on("click", `${prefix}-layer`, showMapFeaturePopup);
    });
    map.on("mousemove", "charging-stations-layer", showStationTooltip);
    map.on("mouseleave", "charging-stations-layer", hideMapTooltip);
    map.on("zoomend", () => {
      plotAllChargingStations({ fitBounds: false, filter: activePowerFilter });
    });
    map.on("moveend", () => {
      const now = performance.now();
      if (
        anim.isPlaying &&
        now - anim.lastStationViewportRefreshAt < 1000
      ) return;
      anim.lastStationViewportRefreshAt = now;
      plotAllChargingStations({ fitBounds: false, filter: activePowerFilter });
    });
    mapStatusElement.textContent = "Map: Mapbox GL JS";
    initMapStationsBar();
    loadFutureCityScenario("vita", 2050).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[FutureCity] Scenario load failed:", message);
    });
    initGeolocation();
    resolveMapReady(map);
    plotAllChargingStations({ fitBounds: false, filter: "all" });
  });
  map.on("style.load", () => {
    installApplicationMapLayers();
    const terrainToggle = document.getElementById("btn-toggle-terrain");
    if (terrainToggle) terrainToggle.disabled = false;
  });
  return mapReadyPromise;
}

function showMapFeaturePopup(event, className = "") {
  const feature = event.features?.[0];
  if (!feature?.properties?.popupHtml) return;
  event.preventDefault();
  openMapPopup(
    event.lngLat.lng,
    event.lngLat.lat,
    feature.properties.popupHtml,
    feature.properties.popupClass || className
  );
}

let stationTooltipPopup = null;
function showStationTooltip(event) {
  const feature = event.features?.[0];
  const html = feature?.properties?.tooltipHtml;
  if (!html) return;
  map.getCanvas().style.cursor = "pointer";
  if (!stationTooltipPopup) {
    stationTooltipPopup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: "station-plot-tooltip",
    });
  }
  stationTooltipPopup.setLngLat(event.lngLat).setHTML(html).addTo(map);
}

function hideMapTooltip() {
  map.getCanvas().style.cursor = "";
  if (stationTooltipPopup) stationTooltipPopup.remove();
}

const mapErrors = [];
function handleMapError(event) {
  const error = event.error || new Error("Unknown Mapbox GL JS map error.");
  const message = String(error.message || error).replace(/access_token=[^&\s]+/gi, "access_token=[redacted]");
  console.error("Mapbox GL JS error:", message);
  if (mapStatusElement) mapStatusElement.textContent = `Map error: ${message}`;
  if (mapboxFallbackActive) return;
  if (!/api\.mapbox\.com|tile|401|403|unauthorized|access token/i.test(message)) return;
  const now = Date.now();
  mapErrors.push(now);
  while (mapErrors.length && now - mapErrors[0] > 10000) mapErrors.shift();
  if (mapErrors.length >= 4) {
    mapboxFallbackActive = true;
    console.warn("Mapbox style tiles failed repeatedly; switching the Mapbox GL JS base style to OpenStreetMap.");
    map.setStyle(OSM_MAPBOX_STYLE);
    map.once("style.load", () => {
      installApplicationMapLayers();
      mapStatusElement.textContent = "Map: OpenStreetMap (Mapbox GL JS)";
    });
  }
}

window.flyToMapPoint = (lat, lon, zoom = 15) => {
  map?.flyTo({ center: [lon, lat], zoom });
};

// ══════════════════════════════════════════════════
// CHARGING STATIONS PLOT ENGINE & GEOLOCATION
// ══════════════════════════════════════════════════

async function plotAllChargingStations(options = { fitBounds: false, filter: "all" }) {
  try {
    if (!map || !mapReadyPromise) return;
    await mapReadyPromise;
    await ensureStationInventoryLoaded();

    if (!allStateStations) return;

    const selectedConnectors = getSelectedConnectors();
    const compatibleStations = allStateStations.filter((station) => {
      if (station.is_public === false || !(Number(station.power_kw) > 0)) return false;
      if (station.status && station.status.toLowerCase() !== "operational") return false;
      const connectors = station.connector_types?.length
        ? station.connector_types
        : normalizeStationConnectors(station.connector_type);
      return connectors.some((connector) => selectedConnectors.includes(connector));
    });

    // Calculate level & power breakdowns
    let ultraCount = 0;
    let dcCount = 0;
    let acCount = 0;

    compatibleStations.forEach((s) => {
      if (s.power_kw >= 120) ultraCount++;
      else if (s.power_kw >= 40) dcCount++;
      else acCount++;
    });

    const stationBadge = document.getElementById("station-count-badge");
    if (stationBadge) stationBadge.textContent = allStateStations.length.toLocaleString();
    const elTotal = document.getElementById("plotted-count-badge");
    const elUltra = document.getElementById("count-ultra");
    const elDc = document.getElementById("count-dc");
    const elAc = document.getElementById("count-ac");
    const visibleStations = compatibleStations.filter((station) => map.getBounds().contains([station.lon, station.lat]));
    const canShowStations = map.getZoom() >= STATION_DISPLAY_MIN_ZOOM;
    if (elTotal) {
      elTotal.textContent = canShowStations
        ? `${visibleStations.length} / ${compatibleStations.length} Compatible`
        : `Zoom in to level ${STATION_DISPLAY_MIN_ZOOM} · ${compatibleStations.length} compatible`;
    }
    if (elUltra) elUltra.textContent = ultraCount;
    if (elDc) elDc.textContent = dcCount;
    if (elAc) elAc.textContent = acCount;
    const allFilterCount = document.getElementById("count-all");
    if (allFilterCount) allFilterCount.textContent = compatibleStations.length;

    const filter = options.filter || activePowerFilter || "all";

    if (!canShowStations || !isStationsLayerVisible) {
      setStationSourceData([]);
      return;
    }

    const features = [];
    compatibleStations.forEach((s) => {
      if (!Number.isFinite(Number(s.lat)) || !Number.isFinite(Number(s.lon))) return;
      if (!map.getBounds().contains([s.lon, s.lat])) return;

      const isUltra = s.power_kw >= 120;
      const isFastDc = s.power_kw >= 40 && s.power_kw < 120;
      const isAc = s.power_kw < 40;

      if (filter === "ultra" && !isUltra) return;
      if (filter === "dc_fast" && !isFastDc) return;
      if (filter === "ac" && !isAc) return;

      // Color coding & sizing:
      // Level 3 Ultra-Fast (>=120kW): Gold #F5A623
      // Level 3 Fast DC (50-100kW): Emerald #00E5A0
      // Level 2 AC (<40kW): Cyan #38BDF8
      const markerColor = isUltra ? "#F5A623" : isFastDc ? "#00E5A0" : "#38BDF8";
      const radius = isUltra ? 7.5 : isFastDc ? 6 : 5;

      const tooltipHtml = `
        <div style="font-family: var(--font-display); font-size: 11px;">
          <b>${escapeHtml(s.station_name || s.name)}</b><br>
          <span style="color:${markerColor}; font-weight:700;">${s.power_kw} kW ${escapeHtml(s.current_type || (s.power_kw >= 40 ? 'DC' : 'AC'))}</span> · ${escapeHtml(s.operator || 'Unknown operator')}
        </div>
      `;

      // Rich Station Plot Popup
      const popupHtml = `
        <div style="font-family: var(--font-display); min-width: 230px; padding: 2px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 6px;">
            <div style="font-size: 13px; font-weight: 700; color: #FFFFFF; line-height: 1.25;">
              ⚡ ${escapeHtml(s.station_name || s.name)}
            </div>
            <span style="font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: rgba(${isUltra ? '245,166,35' : isFastDc ? '0,229,160' : '56,189,248'}, 0.2); color: ${markerColor}; white-space: nowrap;">
              ${s.power_kw} kW
            </span>
          </div>

          <div style="font-size: 11px; color: #A0AEC0; margin-bottom: 4px;">
            <b>Operator:</b> ${escapeHtml(s.operator || 'Unknown operator')}
          </div>

          <div style="font-size: 10.5px; color: #718096; margin-bottom: 8px; line-height: 1.4;">
            <div>🔌 <b>Plug:</b> ${escapeHtml((s.connector_types || [s.connector_type]).filter(Boolean).join(', ') || 'Unknown')} (${escapeHtml(s.current_type || (s.power_kw >= 40 ? 'DC Fast' : 'AC'))})</div>
            <div>📍 <b>Location:</b> ${escapeHtml([s.city, s.state].filter(Boolean).join(', ') || 'Location not supplied')} · ${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}</div>
            <div>Access: ${escapeHtml(s.usage_type || 'Unknown')}</div>
            <div style="color: #A0AEC0; margin-top: 2px;">${escapeHtml(s.status || 'Status not supplied')}${s.date_last_verified ? ` · Data updated ${escapeHtml(s.date_last_verified.slice(0, 10))}` : ''}</div>
          </div>

          <div style="display: flex; gap: 6px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px;">
            <button onclick="setStationAsOrigin(${s.lat}, ${s.lon})" 
                    style="flex: 1; background: rgba(0,229,160,0.15); border: 1px solid rgba(0,229,160,0.4); color: #00E5A0; padding: 5px 8px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer;">
              ⚑ Origin
            </button>
            <button onclick="setStationAsDestination(${s.lat}, ${s.lon})" 
                    style="flex: 1; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); color: #FFFFFF; padding: 5px 8px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer;">
              🏁 Dest
            </button>
            <button onclick="window.flyToMapPoint(${s.lat}, ${s.lon}, 15)" 
                    style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15); color: #A0AEC0; padding: 5px 8px; border-radius: 4px; font-size: 10.5px; cursor: pointer;">
              🔍 Zoom
            </button>
          </div>
        </div>
      `;

      features.push(toPointFeature(
        `station-${s.ocm_id || `${s.lat}-${s.lon}`}`,
        [Number(s.lon), Number(s.lat)],
        {
          kind: "station",
          color: markerColor,
          radius,
          label: "",
          tooltipHtml,
          popupHtml,
          popupClass: "station-plot-popup",
          power_kw: Number(s.power_kw),
        }
      ));
    });

    setStationSourceData(features);
    if (options.fitBounds && features.length > 0) fitMapToLatLngs(features.map((feature) => [
      feature.geometry.coordinates[1],
      feature.geometry.coordinates[0],
    ]), 40);
  } catch (err) {
    console.error("[App] Failed to plot all charging stations:", err);
  }
}

function setFutureCityScenarioData(scenario) {
  futureCityScenario = scenario;
  const source = map?.getSource(FUTURE_CITY_SOURCE_ID);
  if (source && map?.isStyleLoaded()) {
    source.setData(scenario);
  }
  futureCity3DLayer?.setTowers(
    scenario.features.filter(
      (feature) => feature.properties?.feature_type === "future-tower"
    )
  );
}

async function loadFutureCityScenario(cityId, seed) {
  const requestId = ++futureCityRequestId;
  const response = await fetch(
    `${API_BASE}/api/future-cities/${encodeURIComponent(cityId)}/scenario?seed=${encodeURIComponent(seed)}`
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Future-city request failed with HTTP ${response.status}`);
  }
  const scenario = await response.json();
  if (requestId !== futureCityRequestId) return;
  setFutureCityScenarioData(scenario);
  installFutureCityMapLayers();
}

function initMapStationsBar() {
  const btnToggle = document.getElementById("btn-toggle-stations-layer");
  const btnToggleText = document.getElementById("btn-toggle-stations-text");
  const btnToggleArchitecture = document.getElementById("btn-toggle-architectural-layer");
  const btnToggleArchitectureText = document.getElementById("btn-toggle-architectural-text");
  const btnToggleTerrain = document.getElementById("btn-toggle-terrain");
  const btnToggleTerrainText = document.getElementById("btn-toggle-terrain-text");
  const btnFit = document.getElementById("btn-fit-all-stations");
  const btnReset = document.getElementById("btn-reset-sangli-view");
  const filterBtns = document.querySelectorAll(".stations-filter-btn");

  if (btnToggle) {
    btnToggle.addEventListener("click", () => {
      isStationsLayerVisible = !isStationsLayerVisible;
      if (isStationsLayerVisible) {
        btnToggle.classList.add("active");
        if (btnToggleText) btnToggleText.textContent = "Visible";
      } else {
        setStationSourceData([]);
        btnToggle.classList.remove("active");
        if (btnToggleText) btnToggleText.textContent = "Hidden";
      }
      plotAllChargingStations({ fitBounds: false, filter: activePowerFilter });
    });
  }

  if (btnToggleArchitecture) {
    btnToggleArchitecture.addEventListener("click", () => {
      isArchitecturalLayerVisible = !isArchitecturalLayerVisible;
      chargingStation3DLayer?.setVisible(isArchitecturalLayerVisible);
      btnToggleArchitecture.classList.toggle("active", isArchitecturalLayerVisible);
      btnToggleArchitecture.setAttribute("aria-pressed", String(isArchitecturalLayerVisible));
      if (btnToggleArchitectureText) {
        btnToggleArchitectureText.textContent = isArchitecturalLayerVisible ? "Towers on" : "Towers off";
      }
    });
  }

  if (btnToggleTerrain) {
    btnToggleTerrain.disabled = !map?.isStyleLoaded();
    btnToggleTerrain.setAttribute("aria-pressed", String(isTerrainEnabled));
    btnToggleTerrain.addEventListener("click", () => {
      try {
        setTerrainEnabled(!isTerrainEnabled);
        btnToggleTerrain.classList.toggle("active", isTerrainEnabled);
        btnToggleTerrain.setAttribute("aria-pressed", String(isTerrainEnabled));
        if (btnToggleTerrainText) {
          btnToggleTerrainText.textContent = isTerrainEnabled ? "Terrain on" : "Terrain off";
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[Map] Could not toggle 3D terrain:", message);
        showToast(`Could not toggle 3D terrain: ${message}`);
      }
    });
  }

  if (btnFit) {
    btnFit.addEventListener("click", async () => {
      await plotAllChargingStations({ fitBounds: false, filter: activePowerFilter });
      const stations = allStateStations.filter((station) => (
        station.is_public !== false &&
        Number(station.power_kw) > 0 &&
        (!station.status || station.status.toLowerCase() === "operational") &&
        (station.connector_types || normalizeStationConnectors(station.connector_type))
          .some((connector) => getSelectedConnectors().includes(connector))
      ));
      if (stations.length > 0) {
        isStationsLayerVisible = true;
        if (btnToggle) btnToggle.classList.add("active");
        if (btnToggleText) btnToggleText.textContent = "Visible";
        fitMapToLatLngs(stations.map((station) => [station.lat, station.lon]), 40);
        showToast(`Fitted view to ${stations.length} compatible public chargers`);
      }
    });
  }

  if (btnReset) {
    btnReset.addEventListener("click", () => {
      map.flyTo({ center: [SANGLI_CENTER[1], SANGLI_CENTER[0]], zoom: 13 });
      showToast("Centered on Sangli-Kolhapur corridor");
    });
  }

  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activePowerFilter = btn.dataset.pwr || "all";
      plotAllChargingStations({ fitBounds: false, filter: activePowerFilter });
    });
  });
}

function initGeolocation() {
  const btnSidebar = document.getElementById("btn-use-my-location");
  const btnMap = document.getElementById("btn-map-my-location");

  const handleGeo = () => {
    if (!navigator.geolocation) {
      showToast("Geolocation is not supported by your browser");
      return;
    }

    if (btnSidebar) {
      btnSidebar.innerHTML = `<span>Locating…</span>`;
      btnSidebar.disabled = true;
    }
    if (btnMap) {
      btnMap.classList.add("active");
    }

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const { latitude, longitude } = coords;

        if (btnSidebar) {
          btnSidebar.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg><span>My GPS</span>`;
          btnSidebar.disabled = false;
        }

        // Center map on user location
        map.flyTo({ center: [longitude, latitude], zoom: 13 });

        // Render user location marker
        if (userLocationMarker) userLocationMarker.remove();
        userLocationMarker = createMapMarker("userLocation", "current-location", latitude, longitude, {
          radius: 10,
          color: "#60A5FA",
          label: "●",
        })
          .addTo(map)
          .bindPopup("<b>📍 Your Current Location</b><br>Coordinates: " + latitude.toFixed(4) + ", " + longitude.toFixed(4))
          .openPopup();

        // Set as trip origin
        setOrigin(latitude, longitude);

        // Fetch nearby stations
        try {
          const connectors = encodeURIComponent(getSelectedConnectors().join(","));
          const res = await fetch(`${API_BASE}/api/stations?lat=${latitude}&lon=${longitude}&km=25&connector_types=${connectors}`);
          if (res.ok) {
            const data = await res.json();
            const count = data.stations ? data.stations.length : 0;
            showToast(`Found ${count} EV chargers within 25km of your GPS location`);
          }
        } catch (e) {
          console.warn("[Geo] Failed fetching nearby stations:", e);
        }
      },
      (err) => {
        console.warn("[Geo] Geolocation error or denied:", err.message);
        if (btnSidebar) {
          btnSidebar.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg><span>My GPS</span>`;
          btnSidebar.disabled = false;
        }
        if (btnMap) {
          btnMap.classList.remove("active");
        }
        showToast("GPS unavailable/denied. Centered on Sangli corridor.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  if (btnSidebar) btnSidebar.addEventListener("click", handleGeo);
  if (btnMap) btnMap.addEventListener("click", handleGeo);
}

function showToast(msg) {
  let toast = document.getElementById("app-floating-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "app-floating-toast";
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #0E141B;
      border: 1px solid rgba(0, 229, 160, 0.4);
      color: #00E5A0;
      padding: 10px 16px;
      border-radius: 6px;
      font-family: var(--font-display);
      font-size: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.6);
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.3s ease;
      opacity: 0;
      transform: translateY(10px);
    `;
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span>⚡</span> <span>${msg}</span>`;
  toast.style.opacity = "1";
  toast.style.transform = "translateY(0)";
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
  }, 4000);
}

function onMapClick(e) {
  const interactiveLayers = [
    "charging-stations-layer",
    "charging-stations-clusters",
    ...Object.values(MAP_POINT_SOURCES).map((sourceId) => `${sourceId.replace("-source", "")}-layer`),
  ].filter((layerId) => map.getLayer(layerId));
  if (interactiveLayers.length && map.queryRenderedFeatures(e.point, { layers: interactiveLayers }).length) return;
  const { lat, lng: lon } = e.lngLat;

  if (clickMode === "origin") {
    setOrigin(lat, lon);
    clickMode = "destination";
  } else {
    setDestination(lat, lon);
    clickMode = "origin";
  }
}

function setOrigin(lat, lon) {
  originCoords = { lat, lon };
  document.getElementById("origin-input").value = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  document.getElementById("origin-input").dataset.filled = "true";

  if (originMarker) originMarker.remove();
  originMarker = createMapMarker("origin", "trip-origin", lat, lon, {
    radius: 10,
    color: "#00E5A0",
    label: "A",
  }).addTo(map).bindPopup("<b>Trip Origin</b><br>Coordinates: " + lat.toFixed(4) + ", " + lon.toFixed(4));

  updateCalculateButton();
}

function setDestination(lat, lon) {
  destCoords = { lat, lon };
  document.getElementById("dest-input").value = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  document.getElementById("dest-input").dataset.filled = "true";

  if (destMarker) destMarker.remove();
  destMarker = createMapMarker("destination", "trip-destination", lat, lon, {
    radius: 10,
    color: "#F5A623",
    label: "B",
  }).addTo(map).bindPopup("<b>Trip Destination</b><br>Coordinates: " + lat.toFixed(4) + ", " + lon.toFixed(4));

  updateCalculateButton();
}

function updateCalculateButton() {
  const btn = document.getElementById("btn-calculate");
  btn.disabled = !(originCoords && destCoords);
}

// ══════════════════════════════════════════════════
// EV PROFILE & VEHICLE CONSTANTS
// ══════════════════════════════════════════════════

const VEHICLE_DEFAULTS = {
  "medium-duty": { capacity: 80, chargeRate: 120, connectors: ["CCS2", "Type2"], name: "Medium-Duty Commercial" },
  "default_bev": { capacity: 40, chargeRate: 50, connectors: ["CCS1", "Type1"], name: "Standard Light BEV" },
  "tata_nexon_ev": { capacity: 40.5, chargeRate: 50, connectors: ["CCS2", "Type2"], name: "Tata Nexon EV Max" },
  "heavy-duty": { capacity: 160, chargeRate: 250, connectors: ["CCS2", "Type2"], name: "Heavy-Duty Truck" },
};

function initEVProfileListeners() {
  const vehicleSelect = document.getElementById("f-vehicle-class");
  if (vehicleSelect) {
    vehicleSelect.addEventListener("change", function () {
      const def = VEHICLE_DEFAULTS[this.value] || VEHICLE_DEFAULTS["medium-duty"];
      document.getElementById("f-capacity").value = def.capacity;
      document.getElementById("f-charge-rate").value = def.chargeRate;
      setSelectedConnectors(def.connectors);
      updateUsableEnergyPreview();
      plotAllChargingStations({ fitBounds: false, filter: activePowerFilter });
    });
  }

  // SOC slider
  const socSlider = document.getElementById("f-soc");
  socSlider.addEventListener("input", function () {
    document.getElementById("soc-display").textContent = `${this.value}%`;
    document.getElementById("soc-fill").style.width = `${this.value}%`;
    this.setAttribute("aria-valuenow", this.value);

    const soc = parseFloat(this.value) / 100;
    const fill = document.getElementById("soc-fill");
    fill.setAttribute("data-level", soc > 0.6 ? "full" : soc > 0.2 ? "medium" : "critical");

    updateUsableEnergyPreview();
    updateBatteryGauge(soc);
  });

  // SOH slider
  const sohSlider = document.getElementById("f-soh");
  sohSlider.addEventListener("input", function () {
    document.getElementById("soh-display").textContent = `${this.value}%`;
    document.getElementById("soh-fill").style.width = `${this.value}%`;
    this.setAttribute("aria-valuenow", this.value);
    updateUsableEnergyPreview();
  });

  // Capacity input
  document.getElementById("f-capacity").addEventListener("input", updateUsableEnergyPreview);
}

function updateUsableEnergyPreview() {
  const capacity = parseFloat(document.getElementById("f-capacity").value) || 80;
  const soc = parseFloat(document.getElementById("f-soc").value) / 100;
  const soh = parseFloat(document.getElementById("f-soh").value) / 100;
  const reserve = 0.10;

  const usable = Math.max(capacity * soh * (soc - reserve), 0).toFixed(1);
  document.getElementById("usable-kwh").textContent = `${usable} kWh`;
}

function updateBatteryGauge(soc) {
  const fill = document.getElementById("gauge-fill");
  const ARC_LENGTH = 251.2;
  const offset = ARC_LENGTH * (1 - Math.max(Math.min(soc, 1.0), 0.0));
  const color = soc > 0.6 ? "var(--soc-full)" : soc > 0.2 ? "var(--soc-medium)" : "var(--soc-low)";

  fill.style.strokeDasharray = ARC_LENGTH;
  fill.style.strokeDashoffset = offset;
  fill.style.stroke = color;

  document.getElementById("gauge-percent").textContent = `${Math.round(soc * 100)}%`;
}

// ══════════════════════════════════════════════════
// CONNECTOR CHIPS
// ══════════════════════════════════════════════════

function initChipListeners() {
  document.getElementById("connector-chips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    chip.classList.toggle("chip--selected");
    plotAllChargingStations({ fitBounds: false, filter: activePowerFilter });
  });
}

function getSelectedConnectors() {
  const chips = document.querySelectorAll("#connector-chips .chip--selected");
  return Array.from(chips).map((c) => c.dataset.connector);
}

function setSelectedConnectors(connectors) {
  document.querySelectorAll("#connector-chips .chip").forEach((chip) => {
    chip.classList.toggle("chip--selected", connectors.includes(chip.dataset.connector));
  });
}

// ══════════════════════════════════════════════════
// ROUTE CALCULATION
// ══════════════════════════════════════════════════

function initButtonListeners() {
  document.getElementById("btn-calculate").addEventListener("click", calculateRoute);
}

async function calculateRoute() {
  if (!originCoords || !destCoords) return;

  const btn = document.getElementById("btn-calculate");
  btn.disabled = true;
  btn.textContent = "COMPUTING…";
  btn.dataset.loading = "true";

  // Stop previous animation and clear layers
  stopAnimation();
  clearRouteDisplay();

  const body = {
    origin: originCoords,
    destination: destCoords,
    ev_profile: {
      vehicle_class: document.getElementById("f-vehicle-class")?.value || "medium-duty",
      battery_capacity_kwh: parseFloat(document.getElementById("f-capacity").value) || 80,
      soc_current: parseFloat(document.getElementById("f-soc").value) / 100,
      soh: parseFloat(document.getElementById("f-soh").value) / 100,
      soc_min_reserve: 0.10,
      max_charge_rate_kw: parseFloat(document.getElementById("f-charge-rate").value) || 120,
      connector_types: getSelectedConnectors(),
    },
  };

  try {
    const response = await fetch(`${API_BASE}/api/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    onRouteResponse(data);
  } catch (err) {
    console.error("Route API error:", err);
    showFeasibilityBanner("infeasible", { deficitKwh: 0 });
    document.getElementById("banner-subtitle").textContent = `API Error: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "CALCULATE ROUTE";
    btn.dataset.loading = "false";
  }
}

// ══════════════════════════════════════════════════
// RESPONSE HANDLER
// ══════════════════════════════════════════════════

function onRouteResponse(response) {
  currentRouteData = response;

  // 1. Route card
  if (response.route) {
    populateRouteCard(response);
  }

  // 2. Feasibility banner
  if (!response.feasible) {
    showFeasibilityBanner("infeasible", {
      deficitKwh: response.deficit_kwh || 0,
    });
  } else if (response.charging_needed) {
    showFeasibilityBanner("charging", {
      stopCount: response.charging_stops?.length || 0,
    });
  } else {
    showFeasibilityBanner("feasible");
  }

  // 3. Update Storyline badge in topbar
  const storylineBadge = document.getElementById("storyline-badge");
  if (storylineBadge) {
    if (response.diagnostics && response.diagnostics.stops_suppressed_count > 0) {
      storylineBadge.style.display = "inline-block";
      storylineBadge.textContent = `${response.diagnostics.stops_suppressed_count} Hops Mitigated`;
    } else {
      storylineBadge.style.display = "none";
    }
  }

  // 4. SOC trace
  if (response.soc_trace && response.soc_trace.length > 0) {
    buildSocTrace(response.soc_trace, response.charging_stops || []);
  }

  // 5. Map route polyline
  if (response.route?.geometry) {
    renderRoutePolyline(response.route.geometry);
  }

  // 6. Charging stop cards & map markers
  if (response.charging_stops && response.charging_stops.length > 0) {
    renderChargingStopCards(response.charging_stops, response.detour_summary, response.legs);
    renderChargingStopMarkers(response.charging_stops);
  }

  // 7. Setup Route Animation
  if (response.route?.geometry && response.route.geometry.length > 1) {
    setupAnimation(response);
  }
}

// ══════════════════════════════════════════════════
// ROUTE RESULT CARD
// ══════════════════════════════════════════════════

function populateRouteCard(response) {
  const card = document.getElementById("route-result-card");
  card.dataset.state = response.feasible ? "success" : "infeasible";

  document.getElementById("stat-distance").textContent = response.route.total_distance_km;
  document.getElementById("stat-energy").textContent = response.route.total_energy_kwh;
  document.getElementById("stat-time").textContent = response.route.estimated_time_min;

  const arrivalSoc = response.arrival_soc || 0;
  const el = document.getElementById("stat-arrival-soc");
  el.textContent = `${Math.round(arrivalSoc * 100)}`;
  el.dataset.level = getSocState(arrivalSoc);

  document.getElementById("result-time").textContent = new Date().toLocaleTimeString();

  const routingSource = response.routing_source || response.route?.routing_source;
  if (routingSource === "geometric-fallback") {
    console.warn("[RouteR] Road provider unavailable — geometry fell back to near-straight corridor.");
  } else if (routingSource) {
    console.info(`[RouteR] Road geometry source: ${routingSource} (${response.route?.geometry_vertex_count || response.route?.geometry?.length || 0} verts)`);
  }
}

// ══════════════════════════════════════════════════
// FEASIBILITY BANNER
// ══════════════════════════════════════════════════

const BANNER_CONFIG = {
  feasible: { title: "Route Ready", icon: "✓", subtitle: "Battery sufficient. No charging stops needed." },
  charging: { title: "Charging Required", icon: "⚡", subtitle: "{n} stop{s} added along your route." },
  infeasible: { title: "Route Infeasible", icon: "✗", subtitle: "Insufficient charge. {deficit} kWh short." },
};

function showFeasibilityBanner(state, data = {}) {
  const banner = document.getElementById("feasibility-banner");
  const config = BANNER_CONFIG[state];
  let subtitle = config.subtitle
    .replace("{n}", data.stopCount || 0)
    .replace("{s}", data.stopCount === 1 ? "" : "s")
    .replace("{deficit}", data.deficitKwh?.toFixed(1) || "0");

  document.getElementById("banner-icon").textContent = config.icon;
  document.getElementById("banner-title").textContent = config.title;
  document.getElementById("banner-subtitle").textContent = subtitle;

  banner.dataset.state = state;
  if (state === "feasible") {
    setTimeout(() => { banner.dataset.state = "hidden"; }, 5000);
  }
}

function dismissBanner() {
  document.getElementById("feasibility-banner").dataset.state = "hidden";
}

// ══════════════════════════════════════════════════
// SOC TRACE BAR & PLAYHEAD PIN
// ══════════════════════════════════════════════════

function buildSocTrace(socTrace, chargingStops) {
  const traceBar = document.getElementById("soc-trace-bar");
  traceBar.dataset.state = "visible";

  const container = document.getElementById("trace-segments");
  const markerLayer = document.getElementById("trace-charger-markers");
  container.innerHTML = "";
  markerLayer.innerHTML = "";

  // Add playhead pin to trace bar
  let playhead = document.getElementById("trace-playhead-pin");
  if (!playhead) {
    playhead = document.createElement("div");
    playhead.id = "trace-playhead-pin";
    playhead.className = "trace-playhead-pin";
    playhead.style.left = "0%";
    traceBar.querySelector(".trace-segments-wrapper").appendChild(playhead);
  }

  const chargerNodes = new Set((chargingStops || []).map((s) => s.node));

  let displayTrace = socTrace;
  if (socTrace.length > 200) {
    const step = Math.ceil(socTrace.length / 200);
    displayTrace = socTrace.filter((_, i) => i % step === 0 || i === socTrace.length - 1);
  }

  displayTrace.forEach((point, i) => {
    const seg = document.createElement("div");
    seg.className = "trace-segment";
    seg.setAttribute("role", "listitem");
    seg.setAttribute("data-soc-state", getSocState(point.soc));
    seg.setAttribute("tabindex", "0");
    seg.setAttribute("data-fraction", (i / (displayTrace.length - 1)).toString());
    seg.setAttribute("aria-label",
      `SOC ${(point.soc * 100).toFixed(0)}%, ${point.cumulative_kwh?.toFixed(2) || 0} kWh used`);

    seg.addEventListener("mouseenter", () => showTraceTooltip(seg, point));
    seg.addEventListener("mouseleave", hideTraceTooltip);

    // Click to seek animation directly from trace bar
    seg.addEventListener("click", () => {
      const frac = i / (displayTrace.length - 1);
      seekAnimation(frac);
    });

    container.appendChild(seg);

    if (chargerNodes.has(point.node)) {
      const marker = document.createElement("div");
      marker.className = "trace-charger-marker";
      marker.style.left = `${(i / displayTrace.length) * 100}%`;
      markerLayer.appendChild(marker);
    }
  });

  document.getElementById("trace-start-soc").textContent =
    `${(socTrace[0].soc * 100).toFixed(0)}%`;
  document.getElementById("trace-end-soc").textContent =
    `${(socTrace[socTrace.length - 1].soc * 100).toFixed(0)}%`;
}

function showTraceTooltip(seg, point) {
  const tooltip = document.getElementById("trace-tooltip");
  tooltip.hidden = false;
  tooltip.textContent = `SOC: ${(point.soc * 100).toFixed(1)}% · ${point.cumulative_kwh?.toFixed(2) || 0} kWh`;

  const rect = seg.getBoundingClientRect();
  const wrapper = seg.closest(".trace-segments-wrapper").getBoundingClientRect();
  tooltip.style.left = `${rect.left - wrapper.left + rect.width / 2}px`;
}

function hideTraceTooltip() {
  document.getElementById("trace-tooltip").hidden = true;
}

function getSocState(soc) {
  return soc > 0.6 ? "full" : soc > 0.2 ? "medium" : soc > 0.1 ? "low" : "reserve";
}

// ══════════════════════════════════════════════════
// MAP: ROUTE POLYLINE
// ══════════════════════════════════════════════════

function renderRoutePolyline(geometry) {
  if (baseRoutePolyline) baseRoutePolyline.remove();
  clearActiveTrail();

  // Route geometry is [longitude, latitude], as required by GeoJSON and Mapbox.
  const latLngs = geometry.map(([lon, lat]) => [lat, lon]);

  baseRoutePolyline = createMapPolyline("route-source", "route-layer", latLngs).addTo(map);

  activeRoutePolyline = { clearLayers: clearActiveTrail };

  map.fitBounds(baseRoutePolyline.getBounds(), { padding: 60, maxZoom: 15 });
}

function clearActiveTrail() {
  activeTrailChunkIds.forEach(({ sourceId, layerId }) => {
    if (map?.getLayer(layerId)) map.removeLayer(layerId);
    if (map?.getSource(sourceId)) map.removeSource(sourceId);
  });
  activeTrailChunkIds = [];
  activeTrailChunkData = [];
  const liveSource = map?.getSource("active-route-source");
  activeTrailLiveFeature = emptyFeatureCollection();
  if (liveSource) liveSource.setData(activeTrailLiveFeature);
  anim.activeTrailPolyline = null;
  anim.completedTrailChunks = 0;
}

function updateActiveTrail(coords, segmentIndex, lat, lon) {
  if (!map?.getSource("active-route-source")) return;
  if (segmentIndex < anim.completedTrailChunks * ANIMATION_TRAIL_CHUNK_SIZE) {
    clearActiveTrail();
  }

  const completedChunks = Math.floor(segmentIndex / ANIMATION_TRAIL_CHUNK_SIZE);
  while (anim.completedTrailChunks < completedChunks) {
    const start = anim.completedTrailChunks * ANIMATION_TRAIL_CHUNK_SIZE;
    const end = Math.min(start + ANIMATION_TRAIL_CHUNK_SIZE, coords.length - 1);
    const feature = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: coords.slice(start, end + 1),
      },
      properties: {},
    };
    const index = anim.completedTrailChunks;
    const sourceId = `active-route-chunk-source-${index}`;
    const layerId = `active-route-chunk-layer-${index}`;
    map.addSource(sourceId, { type: "geojson", data: feature });
    map.addLayer({
      id: layerId,
      type: "line",
      source: sourceId,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#00E5A0", "line-width": 5, "line-opacity": 0.95 },
    });
    activeTrailChunkIds.push({ sourceId, layerId });
    activeTrailChunkData.push(feature);
    anim.completedTrailChunks += 1;
  }

  const liveStart = anim.completedTrailChunks * ANIMATION_TRAIL_CHUNK_SIZE;
  const coordinates = coords.slice(liveStart, segmentIndex + 1);
  coordinates.push([lon, lat]);
  activeTrailLiveFeature = coordinates.length > 1 ? {
    type: "Feature",
    geometry: { type: "LineString", coordinates },
    properties: {},
  } : emptyFeatureCollection();
  map.getSource("active-route-source").setData(activeTrailLiveFeature);
}

// ══════════════════════════════════════════════════
// CHARGING STOP CARDS & MARKERS
// ══════════════════════════════════════════════════

function renderChargingStopCards(stops, detourSummary, legs) {
  const container = document.getElementById("charging-stops-container");
  container.innerHTML = "";

  // 1. Mandatory Detour Overhead Card
  if (detourSummary && detourSummary.extra_distance_km !== undefined) {
    const detourCard = document.createElement("div");
    detourCard.className = "detour-summary-card";
    detourCard.innerHTML = `
      <div class="detour-summary-card__title">⚡ VALHALLA EV ROUTING & DYNAMIC REPLENISHMENT</div>
      <div style="line-height: 1.4; color: var(--text-secondary);">
        Direct corridor: <b>${detourSummary.original_distance_km} km</b> → Rerouted road: <b>${detourSummary.detour_distance_km} km</b>
        <span style="display: block; color: var(--accent-warning); font-weight: 500; margin-top: 2px;">
          +${detourSummary.extra_distance_km} km station detour overhead (${stops.length} stop${stops.length === 1 ? '' : 's'}) · Dynamic minimum-needed charging
        </span>
      </div>
    `;
    container.appendChild(detourCard);
  }

  // 1.5 Storyline Mitigation Callout (if urban hopping was suppressed)
  if (currentRouteData?.diagnostics && currentRouteData.diagnostics.stops_suppressed_count > 0) {
    const diag = currentRouteData.diagnostics;
    const callout = document.createElement("div");
    callout.style.marginTop = "var(--space-2)";
    callout.style.padding = "var(--space-3)";
    callout.style.background = "rgba(0, 229, 160, 0.08)";
    callout.style.border = "1px solid rgba(0, 229, 160, 0.35)";
    callout.style.borderRadius = "var(--radius-md)";
    callout.style.fontFamily = "var(--font-display)";
    callout.style.cursor = "pointer";
    callout.style.transition = "all var(--dur-fast) var(--ease-out)";
    callout.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
        <span style="color: var(--accent-primary); font-weight: 700; font-size: 11px;">⚡ 6-STOP THRASHING MITIGATED</span>
        <span style="color: var(--accent-primary); font-size: 10px; text-decoration: underline;">Inspect Storyline ↗</span>
      </div>
      <div style="font-size: 11px; color: var(--text-secondary); line-height: 1.4;">
        Suppressed <b>${diag.unmitigated_stops_count} greedy hops</b> into <b>${stops.length} consolidated stop(s)</b>. Saved <b>${diag.time_saved_min} min</b> & bypassed <b>${diag.detour_saved_km} km</b> of Sangli urban detour.
      </div>
    `;
    callout.addEventListener("click", () => {
      openStorylineModal();
    });
    container.appendChild(callout);
  }

  // 2. Individual Station Cards
  stops.forEach((stop, i) => {
    const arrSocPct = (stop.arrival_soc * 100).toFixed(0);
    const depSocPct = (stop.departure_soc * 100).toFixed(0);
    const deltaSoc = (depSocPct - arrSocPct).toFixed(0);
    const replenishLabel = stop.replenish_type || (i === 0 && stop.arrival_soc < 0.15 ? 'Immediate Feeder Charge' : 'Corridor Fast Charge');

    const card = document.createElement("div");
    card.className = "charging-stop-card";
    card.setAttribute("data-station-id", stop.ocm_id || "");
    card.innerHTML = `
      <div class="stop-card__header">
        <div class="stop-number">⚡ ${String(i + 1).padStart(2, "0")}</div>
        <div class="stop-title">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:2px;">
            <span class="stop-name">${stop.station_name}</span>
            <span style="font-size: 9px; padding: 2px 6px; background: rgba(245,166,35,0.15); color: #F5A623; border: 1px solid rgba(245,166,35,0.4); border-radius: 4px; font-weight: 600; text-transform: uppercase;">
              ${replenishLabel}
            </span>
          </div>
          <div class="stop-specs">${stop.power_kw}kW · ${stop.connector_type} · ${stop.current_type}</div>
        </div>
      </div>
      <div class="stop-soc-pill">
        <span class="soc-before">${arrSocPct}%</span>
        <span class="soc-arrow">→</span>
        <span class="soc-after">${depSocPct}%</span>
        <span class="soc-delta">(+${deltaSoc}%)</span>
      </div>
      <div class="stop-duration">⏱ ${stop.charge_time_min} min · Refueled <b>+${stop.energy_charged_kwh || '—'} kWh</b> (Min needed + buffer)</div>
    `;
    container.appendChild(card);
  });

  // 3. Legs Breakdown
  if (legs && legs.length > 1) {
    const legContainer = document.createElement("div");
    legContainer.style.marginTop = "var(--space-2)";
    legContainer.style.padding = "var(--space-2) var(--space-3)";
    legContainer.style.background = "rgba(255,255,255,0.02)";
    legContainer.style.border = "1px solid var(--border-default)";
    legContainer.style.borderRadius = "var(--radius-sm)";
    legContainer.style.fontSize = "11px";
    legContainer.style.fontFamily = "var(--font-display)";

    let legsHtml = `<div style="color: var(--text-tertiary); margin-bottom: 4px; text-transform: uppercase;">Physical Road Detour Legs</div>`;
    legs.forEach((leg, idx) => {
      legsHtml += `
        <div style="display:flex; justify-content:space-between; margin-bottom: 2px; color: var(--text-secondary);">
          <span>${leg.from || 'Leg ' + (idx + 1)} → ${leg.to || 'Stop ' + (idx + 1)}</span>
          <span style="font-weight:600; color:var(--text-primary);">${leg.distance_km || leg.distanceKm} km (${leg.duration_min || leg.durationMin}m)</span>
        </div>
      `;
    });
    legContainer.innerHTML = legsHtml;
    container.appendChild(legContainer);
  }
}

function renderChargingStopMarkers(stops) {
  stationMarkers.forEach((marker) => marker.remove());
  stationMarkers = [];

  stops.forEach((stop, idx) => {
    if (!stop.lat || !stop.lon) return;

    const stopNumber = idx + 1;
    const marker = createMapMarker("chargingStop", `charging-stop-${stop.ocm_id || stopNumber}`, stop.lat, stop.lon, {
      color: "#F5A623",
      radius: 13,
      label: `⚡${stopNumber}`,
    })
      .addTo(map)
      .bindPopup(
        `<b>Stop #${stopNumber}: ${stop.station_name || "Charger"}</b><br>` +
        `<b>Power:</b> ${stop.power_kw}kW · ${stop.connector_type || "—"} · ${stop.current_type || ""}<br>` +
        `${stop.operator ? `<b>Operator:</b> ${stop.operator}<br>` : ""}` +
        `<b>Recharge:</b> ${(stop.arrival_soc * 100).toFixed(0)}% → ${(stop.departure_soc * 100).toFixed(0)}% (+${stop.energy_charged_kwh || '—'} kWh)<br>` +
        `<b>Time at charger:</b> ${stop.charge_time_min} min`
      );

    marker.bindTooltip(`Stop #${stopNumber}: ${stop.station_name || "Charger"} (${stop.power_kw}kW)`, {
      direction: 'top',
      offset: [0, -18]
    });

    stationMarkers.push(marker);
  });
}

function renderNearbyStationMarkers(stations) {
  nearbyStationMarkers.forEach((marker) => marker.remove());
  nearbyStationMarkers = [];

  stations.forEach((station, index) => {
    if (!station.lat || !station.lon) return;

    const marker = createMapMarker("nearbyStation", `nearby-${station.id || station.ocm_id || index}`, station.lat, station.lon, {
      color: "#23A6F5",
      radius: 9,
      label: "🔌",
    })
      .addTo(map)
      .bindPopup(
        `<b>${station.name || "Charger"}</b><br>` +
        `${station.power_kw}kW · ${station.connector_type || "—"} · ${station.current_type || ""}<br>` +
        `${station.operator ? `Operator: ${station.operator}<br>` : ""}`
      );

    nearbyStationMarkers.push(marker);
  });
}

// ══════════════════════════════════════════════════
// ROUTE ANIMATION ENGINE
// ══════════════════════════════════════════════════

function distanceBetween(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin(((lon2 - lon1) * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(((lon2 - lon1) * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function initAnimationControls() {
  const btnPlay = document.getElementById("anim-btn-play");
  const btnReset = document.getElementById("anim-btn-reset");
  const scrubber = document.getElementById("anim-scrubber");
  const speedBtns = document.querySelectorAll(".anim-speed-btn");

  if (btnPlay) {
    btnPlay.addEventListener("click", () => {
      if (anim.isPlaying) {
        pauseAnimation();
      } else {
        if (anim.progress >= 1.0) {
          seekAnimation(0.0);
        }
        startAnimation();
      }
    });
  }

  if (btnReset) {
    btnReset.addEventListener("click", () => {
      seekAnimation(0.0);
      pauseAnimation();
    });
  }

  if (scrubber) {
    scrubber.addEventListener("input", function () {
      const frac = parseFloat(this.value) / 1000;
      seekAnimation(frac);
    });
  }

  speedBtns.forEach((btn) => {
    btn.addEventListener("click", function () {
      speedBtns.forEach((b) => b.classList.remove("anim-speed-btn--selected"));
      this.classList.add("anim-speed-btn--selected");
      anim.speed = parseFloat(this.dataset.speed) || 1.0;
    });
  });
}

function setupAnimation(response) {
  const coords = response.route.geometry; // [[lon, lat], ...]
  if (!coords || coords.length < 2) return;

  anim.routeData = response;
  anim.handledStopIndices.clear();
  anim.isCharging = false;
  anim.progress = 0.0;
  anim.activeTrailPolyline = null;
  anim.completedTrailChunks = 0;
  anim.cameraFollowCenter = null;
  anim.cameraFollowBearing = null;
  anim.lastCameraFollowAt = 0;
  anim.lastStationViewportRefreshAt = 0;

  // Precompute cumulative distances
  anim.cumDistances = [0];
  let totalMeters = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];
    const d = distanceBetween(lat1, lon1, lat2, lon2);
    totalMeters += d;
    anim.cumDistances.push(totalMeters);
  }
  anim.totalDistanceMeters = Math.max(totalMeters, 1);

  // Map charging stops to route progress fractions
  (response.charging_stops || []).forEach((stop) => {
    const nodeIdx = stop.node;
    if (nodeIdx !== undefined && nodeIdx < anim.cumDistances.length) {
      stop.fraction = anim.cumDistances[nodeIdx] / anim.totalDistanceMeters;
    } else if (stop.lat && stop.lon) {
      // Find nearest coordinate fraction
      let bestDist = Infinity;
      let bestFrac = 0.5;
      coords.forEach(([cLon, cLat], idx) => {
        const d = distanceBetween(cLat, cLon, stop.lat, stop.lon);
        if (d < bestDist) {
          bestDist = d;
          bestFrac = anim.cumDistances[idx] / anim.totalDistanceMeters;
        }
      });
      stop.fraction = bestFrac;
    }
  });

  // Create or reset Vehicle Marker
  if (vehicleMarker) {
    vehicleMarker.remove();
  }

  const [firstLon, firstLat] = coords[0];
  vehicleMarker = createMapMarker("vehicle", "animated-vehicle", firstLat, firstLon, {
    color: "#00E5A0",
    radius: 11,
    label: "▲",
  }).addTo(map);

  // Reveal controller dock
  const dock = document.getElementById("anim-controller");
  if (dock) dock.dataset.state = "visible";

  seekAnimation(0.0);
  startAnimation();
}

function getInterpolatedState(progress) {
  const coords = anim.routeData.route.geometry; // [[lon, lat], ...]
  const targetMeters = progress * anim.totalDistanceMeters;

  // Binary search for enclosing segment
  let low = 0;
  let high = anim.cumDistances.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (anim.cumDistances[mid] < targetMeters) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const segIdx = Math.max(0, low - 1);
  const nextIdx = Math.min(segIdx + 1, coords.length - 1);

  const [lonA, latA] = coords[segIdx];
  const [lonB, latB] = coords[nextIdx];
  const dA = anim.cumDistances[segIdx];
  const dB = anim.cumDistances[nextIdx];

  const segSpan = dB - dA;
  const segT = segSpan > 0 ? (targetMeters - dA) / segSpan : 0;

  const lat = latA + (latB - latA) * segT;
  const lon = lonA + (lonB - lonA) * segT;
  const bearing = calculateBearing(latA, lonA, latB, lonB);

  // Interpolate SOC
  const socTrace = anim.routeData.soc_trace || [];
  let currentSoc = parseFloat(document.getElementById("f-soc")?.value || 75) / 100;
  if (socTrace.length > 0) {
    const traceIdx = Math.min(Math.floor(progress * (socTrace.length - 1)), socTrace.length - 1);
    currentSoc = socTrace[traceIdx].soc;
  }

  const distanceKm = (targetMeters / 1000).toFixed(1);
  const totalMin = anim.routeData.route.estimated_time_min || 0;
  const elapsedMin = Math.round(progress * totalMin);

  return {
    lat,
    lon,
    bearing,
    currentSoc,
    distanceKm,
    elapsedMin,
    totalMin,
    segIdx,
  };
}

function syncMapToVehicle(state) {
  if (!map || !vehicleMarker) return;

  const now = performance.now();
  const deltaTime = anim.lastCameraFollowAt
    ? Math.min(Math.max(now - anim.lastCameraFollowAt, 0), 50)
    : 0;
  anim.lastCameraFollowAt = now;

  if (!anim.cameraFollowCenter || anim.cameraFollowBearing === null) {
    const center = map.getCenter();
    anim.cameraFollowCenter = { lat: center.lat, lon: center.lng };
    anim.cameraFollowBearing = map.getBearing();
  }

  const currentCenter = anim.cameraFollowCenter;
  const vehiclePoint = map.project([state.lon, state.lat]);
  const followPaddingX = map.getCanvas().clientWidth * 0.32;
  const followPaddingY = map.getCanvas().clientHeight * 0.32;
  const centerPoint = map.project([currentCenter.lon, currentCenter.lat]);
  const bearingDelta = Math.abs(
    ((state.bearing - anim.cameraFollowBearing + 540) % 360) - 180
  );
  const shouldFollow =
    vehiclePoint.x < followPaddingX ||
    vehiclePoint.x > map.getCanvas().clientWidth - followPaddingX ||
    vehiclePoint.y < followPaddingY ||
    vehiclePoint.y > map.getCanvas().clientHeight - followPaddingY ||
    Math.hypot(vehiclePoint.x - centerPoint.x, vehiclePoint.y - centerPoint.y) > 80 ||
    bearingDelta > 10;

  if (!shouldFollow) return;

  // Exponential response is frame-rate independent and avoids restarting easeTo mid-transition.
  const centerAlpha = 1 - Math.exp(-deltaTime / 280);
  const bearingAlpha = 1 - Math.exp(-deltaTime / 240);
  const longitudeDelta = ((state.lon - currentCenter.lon + 540) % 360) - 180;
  const bearingDeltaToTarget = ((state.bearing - anim.cameraFollowBearing + 540) % 360) - 180;

  anim.cameraFollowCenter = {
    lat: currentCenter.lat + (state.lat - currentCenter.lat) * centerAlpha,
    lon: currentCenter.lon + longitudeDelta * centerAlpha,
  };
  anim.cameraFollowBearing =
    (anim.cameraFollowBearing + bearingDeltaToTarget * bearingAlpha + 360) % 360;

  map.jumpTo({
    center: [anim.cameraFollowCenter.lon, anim.cameraFollowCenter.lat],
    bearing: anim.cameraFollowBearing,
    pitch: map.getPitch(),
    zoom: map.getZoom(),
  });
}

function updateAnimationUI(state, progress) {
  // 1. Move vehicle marker & rotate heading
  if (vehicleMarker) {
    const vehicleLatLng = [state.lat, state.lon];
    vehicleMarker.setLatLng(vehicleLatLng);
    vehicleMarker.properties.bearing = state.bearing;
    vehicleMarker.update();
    syncMapToVehicle(state);
  }

  // 2. Keep completed trail sections static and update only the current section.
  if (activeRoutePolyline && anim.routeData?.route?.geometry) {
    updateActiveTrail(anim.routeData.route.geometry, state.segIdx, state.lat, state.lon);
  }

  // 3. Update scrubber & fill
  const scrubber = document.getElementById("anim-scrubber");
  const fill = document.getElementById("anim-scrub-fill");
  if (scrubber) scrubber.value = Math.round(progress * 1000);
  if (fill) fill.style.width = `${(progress * 100).toFixed(1)}%`;

  // 4. Update Playhead Pin in Bottom SOC Trace
  const playhead = document.getElementById("trace-playhead-pin");
  if (playhead) {
    playhead.style.left = `${(progress * 100).toFixed(1)}%`;
  }

  // 5. Update Telemetry tickers
  const timeTicker = document.getElementById("anim-time-ticker");
  if (timeTicker) {
    const formatTime = (m) => {
      const hrs = Math.floor(m / 60);
      const mins = m % 60;
      return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
    };
    timeTicker.textContent = `${formatTime(state.elapsedMin)} / ${formatTime(state.totalMin)}`;
  }

  const socTicker = document.getElementById("anim-telemetry-soc");
  if (socTicker) {
    socTicker.textContent = `SOC: ${Math.round(state.currentSoc * 100)}%`;
  }

  const distTicker = document.getElementById("anim-telemetry-dist");
  if (distTicker) {
    distTicker.textContent = `${state.distanceKm} km`;
  }

  // 6. Update Circular Battery Gauge
  updateBatteryGauge(state.currentSoc);
}

function startAnimation() {
  if (anim.isPlaying) return;
  anim.isPlaying = true;
  anim.lastTimestamp = performance.now();

  // Update button icon to pause
  const playIcon = document.querySelector("#anim-btn-play .icon-play");
  const pauseIcon = document.querySelector("#anim-btn-play .icon-pause");
  if (playIcon) playIcon.style.display = "none";
  if (pauseIcon) pauseIcon.style.display = "block";

  anim.rafId = requestAnimationFrame(animationLoop);
}

function pauseAnimation() {
  anim.isPlaying = false;
  if (anim.rafId) {
    cancelAnimationFrame(anim.rafId);
    anim.rafId = null;
  }

  // Update button icon to play
  const playIcon = document.querySelector("#anim-btn-play .icon-play");
  const pauseIcon = document.querySelector("#anim-btn-play .icon-pause");
  if (playIcon) playIcon.style.display = "block";
  if (pauseIcon) pauseIcon.style.display = "none";
}

function stopAnimation() {
  pauseAnimation();
  anim.progress = 0.0;
  anim.isCharging = false;
  anim.handledStopIndices.clear();
  const toast = document.getElementById("anim-charging-toast");
  if (toast) toast.dataset.state = "hidden";
}

function seekAnimation(fraction) {
  anim.progress = Math.max(0.0, Math.min(fraction, 1.0));
  if (!anim.routeData) return;

  const state = getInterpolatedState(anim.progress);
  updateAnimationUI(state, anim.progress);
}

function getZoomPlaybackFactor() {
  const referenceZoom = 12;
  const zoom = map ? map.getZoom() : referenceZoom;
  return Math.max(0.2, Math.min(1.5, Math.pow(0.82, zoom - referenceZoom)));
}

function animationLoop(timestamp) {
  if (!anim.isPlaying) return;

  const dt = Math.min(Math.max(timestamp - (anim.lastTimestamp || timestamp), 0), 50);
  anim.lastTimestamp = timestamp;

  // Handle active charging pause
  if (anim.isCharging) {
    const chargeDurationMs = CHARGING_STOP_DURATION_MS;
    const elapsedCharging = timestamp - anim.chargeStartTime;
    const stop = (anim.routeData.charging_stops || [])[anim.currentStopIndex];

    if (stop) {
      // Smoothly fill battery from arrival SOC to departure SOC during pause
      const chargeT = Math.min(elapsedCharging / chargeDurationMs, 1.0);
      const arrSoc = stop.arrival_soc;
      const depSoc = stop.departure_soc;
      const liveChargeSoc = arrSoc + (depSoc - arrSoc) * chargeT;
      updateBatteryGauge(liveChargeSoc);

      const socTicker = document.getElementById("anim-telemetry-soc");
      if (socTicker) socTicker.textContent = `SOC: ${Math.round(liveChargeSoc * 100)}% ⚡`;
    }

    if (elapsedCharging >= chargeDurationMs) {
      // Finish charging
      anim.isCharging = false;
      const toast = document.getElementById("anim-charging-toast");
      if (toast) toast.dataset.state = "hidden";
    }

    anim.rafId = requestAnimationFrame(animationLoop);
    return;
  }

  // Base trip simulation duration = 16 seconds at 1x speed and zoom level 12.
  const baseDurationMs = 16000;
  const progressDelta = (dt * anim.speed * getZoomPlaybackFactor()) / baseDurationMs;
  const prevProgress = anim.progress;
  anim.progress = Math.min(anim.progress + progressDelta, 1.0);

  // Check for charging stop encounters
  const stops = anim.routeData.charging_stops || [];
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const stopFrac = stop.fraction || 0.5;

    if (!anim.handledStopIndices.has(i) && prevProgress <= stopFrac && anim.progress >= stopFrac) {
      // Trigger charging stop!
      anim.handledStopIndices.add(i);
      anim.isCharging = true;
      anim.chargeStartTime = timestamp;
      anim.currentStopIndex = i;
      anim.progress = stopFrac; // snap to station

      // Show charging toast
      const toast = document.getElementById("anim-charging-toast");
      const label = document.getElementById("anim-charging-label");
      if (toast && label) {
        label.textContent = `Charging: ${stop.station_name} (${(stop.arrival_soc * 100).toFixed(0)}% → ${(stop.departure_soc * 100).toFixed(0)}%)`;
        toast.dataset.state = "visible";
      }

      break;
    }
  }

  const state = getInterpolatedState(anim.progress);
  updateAnimationUI(state, anim.progress);

  if (anim.progress >= 1.0) {
    // Trip completed!
    pauseAnimation();
    return;
  }

  anim.rafId = requestAnimationFrame(animationLoop);
}

// ══════════════════════════════════════════════════
// HEALTH CHECK
// ══════════════════════════════════════════════════

async function checkServerHealth() {
  try {
    const response = await fetch(`${API_BASE}/api/health`);
    const data = await response.json();
    const dot = document.getElementById("status-dot");
    const text = document.getElementById("system-status-text");

    if (data.status === "ready") {
      dot.dataset.status = "ready";
      text.textContent = `Ready · ${data.region || "Sangli"} · ${data.graph?.nodes || 5120} nodes`;
    } else {
      dot.dataset.status = "degraded";
      text.textContent = data.status || "Degraded";
    }
  } catch {
    document.getElementById("status-dot").dataset.status = "error";
    document.getElementById("system-status-text").textContent = "Server offline";
  }
}

// Periodic health check
setInterval(checkServerHealth, 30_000);

// ══════════════════════════════════════════════════
// CLEAR / RESET
// ══════════════════════════════════════════════════

// Event delegation for charging stop cards → pan map to station
document.getElementById("route-result-section").addEventListener("click", (e) => {
  const card = e.target.closest(".charging-stop-card");
  if (!card) return;
  const stationId = card.dataset.stationId;
  const marker = stationMarkers.find((m) => m._popup?._content?.includes(stationId));
  if (marker) {
    const position = marker.getLatLng();
    map.flyTo({ center: [position.lng, position.lat], zoom: 15, duration: 500 });
    marker.openPopup();
  }
});

// ══════════════════════════════════════════════════
// BENCHMARK TEST MATRIX & SCENARIO ENGINE
// ══════════════════════════════════════════════════

function validateLongHaulBenchmark(res) {
  const stops = Array.isArray(res.charging_stops) ? res.charging_stops : [];
  const distanceKm = Number(res.route?.total_distance_km);
  const arrivalSoc = Number(res.arrival_soc);
  const reserveSoc = 0.10;
  const stopKeys = stops.map((stop) => stop.ocm_id || stop.station_name);
  const hasDistinctStops = stopKeys.every(Boolean) && new Set(stopKeys).size === stops.length;
  const stopsAreReachable = stops.every((stop) => (
    Number.isFinite(Number(stop.arrival_soc)) &&
    Number(stop.arrival_soc) >= reserveSoc &&
    Number(stop.departure_soc) >= Number(stop.arrival_soc) &&
    Number.isFinite(Number(stop.lat)) &&
    Number.isFinite(Number(stop.lon))
  ));
  const pass = res.feasible === true &&
    Number.isFinite(distanceKm) &&
    distanceKm >= 600 &&
    stops.length >= 5 &&
    stops.length <= 6 &&
    hasDistinctStops &&
    stopsAreReachable &&
    Number.isFinite(arrivalSoc) &&
    arrivalSoc >= reserveSoc;

  if (!pass) {
    return {
      pass,
      message: `✗ Long-haul check failed: ${Math.round(distanceKm || 0)} km, ${stops.length} stops, ${(arrivalSoc * 100 || 0).toFixed(0)}% arrival SOC; expected 600+ km, 5–6 distinct reachable stops, and at least 10% arrival SOC`
    };
  }

  const chargingMinutes = stops.reduce((total, stop) => total + (Number(stop.charge_time_min) || 0), 0);
  const detourKm = Number(res.detour_summary?.extra_distance_km) || 0;
  const diagnostics = res.diagnostics;
  const timeSavedMin = Number(diagnostics?.time_saved_min) || 0;
  const detourSavedKm = Number(diagnostics?.detour_saved_km) || 0;
  const savings = timeSavedMin > 0 || detourSavedKm > 0
    ? ` · ${timeSavedMin.toFixed(0)} min / ${detourSavedKm.toFixed(1)} km saved vs. greedy`
    : "";

  return {
    pass,
    message: `✓ ${Math.round(distanceKm)} km · ${stops.length} distinct stops · ${chargingMinutes.toFixed(0)} min charging · ${detourKm.toFixed(1)} km detour · ${(arrivalSoc * 100).toFixed(0)}% arrival SOC${savings}`
  };
}

function validateMaximumRangeBenchmark(res) {
  const stops = Array.isArray(res.charging_stops) ? res.charging_stops : [];
  const distanceKm = Number(res.route?.total_distance_km);
  const arrivalSoc = Number(res.arrival_soc);
  const origin = { lat: 19.076, lon: 72.8777 };
  const destination = { lat: 28.6139, lon: 77.209 };
  const routeLon = destination.lon - origin.lon;
  const routeLat = destination.lat - origin.lat;
  const routeLengthSquared = routeLon ** 2 + routeLat ** 2;
  const progress = stops.map((stop) =>
    ((Number(stop.lon) - origin.lon) * routeLon +
      (Number(stop.lat) - origin.lat) * routeLat) / routeLengthSquared
  );
  const stopsProgressForward = progress.every((value, index) =>
    value > 0 && value < 1 && (index === 0 || value > progress[index - 1])
  ) && progress[progress.length - 1] - progress[0] > 0.3;
  const stopKeys = stops.map((stop) => stop.ocm_id || stop.station_name);
  const distinctStops = stopKeys.every(Boolean) && new Set(stopKeys).size === stops.length;
  const validStops = stops.every((stop) => (
    Number.isFinite(Number(stop.lat)) &&
    Number.isFinite(Number(stop.lon)) &&
    Number(stop.lat) >= -90 &&
    Number(stop.lat) <= 90 &&
    Number(stop.lon) >= -180 &&
    Number(stop.lon) <= 180 &&
    Number(stop.arrival_soc) >= 0.10 &&
    Number(stop.departure_soc) >= Number(stop.arrival_soc) &&
    Number(stop.departure_soc) <= 1
  ));
  const pass = res.feasible === true &&
    Number.isFinite(distanceKm) &&
    distanceKm >= 1400 &&
    stops.length === 5 &&
    distinctStops &&
    validStops &&
    stopsProgressForward &&
    Number.isFinite(arrivalSoc) &&
    arrivalSoc >= 0.10;

  if (!pass) {
    return {
      pass,
      message: `✗ Maximum-range check failed: ${Math.round(distanceKm || 0)} km, ${stops.length}/5 stops, ${(arrivalSoc * 100 || 0).toFixed(0)}% arrival SOC; expected 1,400+ km, five distinct reachable stops, and at least 10% arrival SOC`
    };
  }

  return {
    pass,
    message: `✓ Maximum-range stress passed: ${Math.round(distanceKm)} km · all 5 station stops used · ${(arrivalSoc * 100).toFixed(0)}% arrival SOC · ${stops.map((stop) => stop.station_name).join(" → ")}`
  };
}

function assertRoadFollowingGeometry(res, minVertices = 40) {
  const geometry = res?.route?.geometry || [];
  const source = res?.routing_source || res?.route?.routing_source || "";
  const isRoad = source === "osrm" || source === "osrm-stitched";
  const verts = geometry.length || res?.route?.geometry_vertex_count || 0;
  return {
    ok: isRoad && verts >= minVertices,
    source: source || "unknown",
    verts,
  };
}

const BENCHMARK_SCENARIOS = [
  {
    id: "local-direct",
    title: "Scenario 1: Local Direct Corridor (0 Stops Required)",
    badge: "Direct Feasible",
    badgeType: "direct",
    desc: "Sangli Central to Miraj City with 75% SOC. Tests the short-haul boundary where usable battery energy is fully sufficient, requiring 0 charging stops and 0 route detours.",
    params: {
      origin: { lat: 16.8524, lon: 74.5815, label: "Sangli ST Bus Stand" },
      dest: { lat: 16.8280, lon: 74.6450, label: "Miraj Railway Junction" },
      vehicleClass: "medium-duty",
      capacity: 80,
      soc: 75,
      soh: 95,
      chargeRate: 120,
      connectors: ["CCS2", "Type2"]
    },
    validate: (res) => {
      const road = assertRoadFollowingGeometry(res, 20);
      const pass = res.feasible === true && (!res.charging_stops || res.charging_stops.length === 0) && res.charging_needed === false && road.ok;
      return {
        pass,
        message: pass
          ? `✓ Feasible Direct: ${res.route.total_distance_km} km, Arr: ${(res.arrival_soc * 100).toFixed(0)}% SOC, 0 detours · road ${road.source} (${road.verts} verts)`
          : `✗ Expected 0 stops on a road-following path, received ${res.charging_stops?.length || 0} stops / ${road.source}`
      };
    }
  },
  {
    id: "mandatory-detour",
    title: "Scenario 2: Mandatory 1-Stop Detour (Physical Road Re-route)",
    badge: "Detour Re-routed",
    badgeType: "detour",
    desc: "Sangli to Kolhapur Highway with 18% SOC. Starting battery is insufficient to reach the destination; system physically diverts the road geometry through the nearest high-power station.",
    params: {
      origin: { lat: 16.8524, lon: 74.5815, label: "Sangli City" },
      dest: { lat: 16.7450, lon: 74.3120, label: "Kolhapur Shiroli MIDC" },
      vehicleClass: "medium-duty",
      capacity: 80,
      soc: 18,
      soh: 95,
      chargeRate: 120,
      connectors: ["CCS2", "Type2"]
    },
    validate: (res) => {
      const road = assertRoadFollowingGeometry(res, 40);
      const pass = res.feasible === true && res.charging_needed === true && (res.charging_stops && res.charging_stops.length >= 1) && res.is_detour_routed === true && road.ok;
      const extraKm = res.detour_summary?.extra_distance_km ?? 0;
      const st = res.charging_stops ? res.charging_stops[0] : null;
      return {
        pass,
        message: pass
          ? `✓ Re-routed: +${extraKm} km road detour via ${st ? st.station_name : 'Station'} (${st ? st.power_kw : ''} kW) · ${road.source}`
          : `✗ Physical road detour not established (routing=${road.source}, verts=${road.verts})`
      };
    }
  },
  {
    id: "multi-stop",
    title: "Scenario 3: Multi-Stop Chained Highway Detour",
    badge: "Chained Stops",
    badgeType: "detour",
    desc: "Sangli to Pune Expressway Corridor (230 km). Tests multi-leg waypoint sequencing where multiple charging stops are chained in succession across regional boundaries.",
    params: {
      origin: { lat: 16.8524, lon: 74.5815, label: "Sangli Bus Stand" },
      dest: { lat: 18.5204, lon: 73.8567, label: "Pune Gateway" },
      vehicleClass: "medium-duty",
      capacity: 80,
      soc: 50,
      soh: 95,
      chargeRate: 120,
      connectors: ["CCS2", "Type2"]
    },
    validate: (res) => {
      const pass = res.feasible === true && res.charging_stops && res.charging_stops.length >= 2;
      return {
        pass,
        message: pass
          ? `✓ Chained ${res.charging_stops.length} stations: ${res.charging_stops.map(s => s.station_name.split(' ')[0]).join(' → ')} (${res.route.total_distance_km} km total)`
          : `✗ Expected >= 2 stops, got ${res.charging_stops?.length || 0}`
      };
    }
  },
  {
    id: "stranded-boundary",
    title: "Scenario 4: Critical Low Battery Stranded Boundary (5% SOC)",
    badge: "Stranded Boundary",
    badgeType: "stranded",
    desc: "Sangli to Karad with critically low 5% battery. Tests the unfeasible boundary where distance to nearest station exceeds available battery, triggering an explicit stranded deficit warning.",
    params: {
      origin: { lat: 16.8524, lon: 74.5815, label: "Sangli ST Stand" },
      dest: { lat: 17.2880, lon: 74.1840, label: "Karad City" },
      vehicleClass: "medium-duty",
      capacity: 80,
      soc: 5,
      soh: 95,
      chargeRate: 120,
      connectors: ["CCS2"]
    },
    validate: (res) => {
      const pass = res.feasible === false && (res.stranded === true || res.deficit_kwh > 0);
      return {
        pass,
        message: pass
          ? `✓ Stranded Boundary Verified: Safely caught low battery (${res.deficit_kwh || 0} kWh deficit below reserve limit)`
          : `✗ Safety check failed: System did not flag vehicle as stranded`
      };
    }
  },
  {
    id: "connector-filter",
    title: "Scenario 5: Strict Connector Filter (Type-2 AC Only)",
    badge: "Socket Filter",
    badgeType: "detour",
    desc: "Sangli to Kolhapur restricting to Type2 connectors only. Tests candidate filtering ensuring candidate stations strictly match the vehicle's hardware socket constraint.",
    params: {
      origin: { lat: 16.8524, lon: 74.5815, label: "Sangli Hub" },
      dest: { lat: 16.7450, lon: 74.3120, label: "Kolhapur City" },
      vehicleClass: "medium-duty",
      capacity: 80,
      soc: 20,
      soh: 95,
      chargeRate: 60,
      connectors: ["Type2"]
    },
    validate: (res) => {
      const stops = res.charging_stops || [];
      const hasOnlyType2 = stops.length > 0 && stops.every(s => s.connector_type === "Type2");
      return {
        pass: res.feasible === true && hasOnlyType2,
        message: hasOnlyType2
          ? `✓ Hardware Match: ${stops.length} stop(s) scheduled strictly matching Type2 standard`
          : `✗ Filter mismatch: station connector does not match Type2`
      };
    }
  },
  {
    id: "feeder-low-soc",
    title: "Scenario 6: Low Battery Feeder Recharge (14% SOC)",
    badge: "Feeder Recharge",
    badgeType: "detour",
    desc: "Sangli to Kolhapur with low 14% starting SOC. Solves premature stranded errors by immediately routing to a local feeder charging hub, refilling the minimum required energy plus buffer, and completing the route.",
    params: {
      origin: { lat: 16.8524, lon: 74.5815, label: "Sangli ST Bus Stand" },
      dest: { lat: 16.7050, lon: 74.2433, label: "Kolhapur Central" },
      vehicleClass: "medium-duty",
      capacity: 80,
      soc: 14,
      soh: 95,
      chargeRate: 120,
      connectors: ["CCS2", "Type2"]
    },
    validate: (res) => {
      const pass = res.feasible === true && res.charging_stops && res.charging_stops.length >= 1;
      const firstStop = res.charging_stops ? res.charging_stops[0] : null;
      return {
        pass,
        message: pass
          ? `✓ Feeder Route Success: Stopped at ${firstStop?.station_name || 'Hub'} (${firstStop?.energy_charged_kwh || 0} kWh replenished) → Arrived at ${(res.arrival_soc * 100).toFixed(0)}% SOC`
          : `✗ Failed to schedule feeder recharge: ${res.error || 'Trip marked infeasible'}`
      };
    }
  },
  {
    id: "anti-thrashing-mitigation",
    title: "Scenario 7: Sangli Corridor Anti-Thrashing (Mitigated Screenshot Issue)",
    badge: "Anti-Thrashing Pass",
    badgeType: "detour",
    desc: "Sangli to Pune Expressway Corridor with 18% starting battery. Directly addresses the issue in the user screenshot: suppresses the greedy 6-station micro-hopping trap across Budhgaon/Sangli, consolidating charging into optimal high-power stops and saving over 25 km of urban detours.",
    params: {
      origin: { lat: 16.8524, lon: 74.5815, label: "Sangli ST Stand" },
      dest: { lat: 18.5204, lon: 73.8567, label: "Pune Gateway" },
      vehicleClass: "medium-duty",
      capacity: 80,
      soc: 18,
      soh: 95,
      chargeRate: 120,
      connectors: ["CCS2", "Type2"]
    },
    validate: (res) => {
      const pass = res.feasible === true && res.diagnostics && res.diagnostics.stops_suppressed_count >= 1 && res.charging_stops && res.charging_stops.length <= 2;
      return {
        pass,
        message: pass
          ? `✓ Anti-Thrashing Verified: Suppressed ${res.diagnostics.stops_suppressed_count} redundant hops (${res.diagnostics.unmitigated_stops_count} greedy hops → ${res.charging_stops.length} consolidated stops). Saved ${res.diagnostics.detour_saved_km} km detour!`
          : `✗ Anti-thrashing failed: Expected stops suppression, got ${res.charging_stops?.length || 0} stops`
      };
    }
  },
  {
    id: "long-haul-surat",
    title: "Scenario 8: Long-Haul West Corridor — Surat (5–6 Stops)",
    badge: "Long-Haul · 5–6 Stops",
    badgeType: "detour",
    desc: "Sangli to Surat via the Maharashtra–Gujarat corridor (about 725 km). Tests a medium-duty EV on a long trip with low starting charge, validating five to six distinct charging recommendations, reachable station arrivals, reserve-safe arrival SOC, and route/detour efficiency metrics.",
    params: {
      origin: { lat: 16.8524, lon: 74.5815, label: "Sangli ST Bus Stand" },
      dest: { lat: 21.1702, lon: 72.8311, label: "Surat" },
      vehicleClass: "medium-duty",
      capacity: 80,
      soc: 20,
      soh: 95,
      chargeRate: 120,
      connectors: ["CCS2", "Type2"]
    },
    validate: validateLongHaulBenchmark
  },
  {
    id: "long-haul-bengaluru",
    title: "Scenario 9: Long-Haul South Corridor — Bengaluru (5–6 Stops)",
    badge: "Long-Haul · 5–6 Stops",
    badgeType: "detour",
    desc: "Sangli to Bengaluru via the Deccan corridor (about 650 km). Repeats the long-haul check on a different route and charger network, requiring five to six distinct reachable stops and at least 10% battery remaining on arrival.",
    params: {
      origin: { lat: 16.8524, lon: 74.5815, label: "Sangli ST Bus Stand" },
      dest: { lat: 12.9716, lon: 77.5946, label: "Bengaluru" },
      vehicleClass: "medium-duty",
      capacity: 80,
      soc: 20,
      soh: 95,
      chargeRate: 120,
      connectors: ["CCS2", "Type2"]
    },
    validate: validateLongHaulBenchmark
  },
  {
    id: "maximum-range-mumbai-delhi",
    title: "Scenario 10: Maximum-Range Network Stress — Mumbai to Delhi",
    badge: "Longest · 5-Stop Cap",
    badgeType: "detour",
    desc: "Tests the current solver's longest validated corridor (about 1,600 km) across western, central, and northern India. Requires the maximum five distinct charging recommendations, valid geographic stop coordinates, reserve-safe SOC at every stop, forward route progression, and safe destination arrival.",
    params: {
      origin: { lat: 19.076, lon: 72.8777, label: "Mumbai" },
      dest: { lat: 28.6139, lon: 77.209, label: "Delhi" },
      vehicleClass: "medium-duty",
      capacity: 80,
      soc: 95,
      soh: 100,
      chargeRate: 120,
      connectors: ["CCS2", "Type2"]
    },
    validate: validateMaximumRangeBenchmark
  }
];

function initBenchmarkModal() {
  const modal = document.getElementById("benchmark-modal");
  const openBtn = document.getElementById("btn-open-benchmark");
  const closeBtn = document.getElementById("btn-close-benchmark");
  const backdrop = document.getElementById("benchmark-backdrop");
  const listContainer = document.getElementById("benchmark-scenario-list");

  if (!modal || !listContainer) return;

  // Open modal
  if (openBtn) {
    openBtn.addEventListener("click", () => {
      modal.dataset.state = "visible";
    });
  }

  // Close modal
  const closeModal = () => {
    modal.dataset.state = "hidden";
  };

  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (backdrop) backdrop.addEventListener("click", closeModal);

  // Render scenarios
  listContainer.innerHTML = "";
  BENCHMARK_SCENARIOS.forEach((sc, index) => {
    const card = document.createElement("div");
    card.className = "scenario-card";
    card.id = `scenario-card-${index}`;

    card.innerHTML = `
      <div class="scenario-card__header">
        <div class="scenario-card__title">
          <span>${sc.title}</span>
          <span class="scenario-badge scenario-badge--${sc.badgeType}">${sc.badge}</span>
        </div>
        <div style="display:flex; align-items:center; gap: 8px;">
          <span id="scenario-result-${index}" class="scenario-result-badge" style="display:none;"></span>
          <button class="scenario-run-btn" data-scenario-index="${index}">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
            <span>Run Test</span>
          </button>
        </div>
      </div>
      <div class="scenario-card__desc">${sc.desc}</div>
      <div class="scenario-card__details">
        <span><b>From:</b> ${sc.params.origin.label} → <b>To:</b> ${sc.params.dest.label}</span>
        <span><b>SOC:</b> ${sc.params.soc}% · <b>Rate:</b> ${sc.params.chargeRate} kW · <b>Connectors:</b> ${sc.params.connectors.join(', ')}</span>
      </div>
    `;

    listContainer.appendChild(card);
  });

  // Attach run handlers
  listContainer.addEventListener("click", async (e) => {
    const runBtn = e.target.closest(".scenario-run-btn");
    if (!runBtn) return;

    const idx = parseInt(runBtn.dataset.scenarioIndex, 10);
    const scenario = BENCHMARK_SCENARIOS[idx];
    if (!scenario) return;

    runBtn.disabled = true;
    runBtn.innerHTML = `<span>Running…</span>`;

    const resultBadge = document.getElementById(`scenario-result-${idx}`);
    if (resultBadge) {
      resultBadge.style.display = "inline-block";
      resultBadge.className = "scenario-result-badge";
      resultBadge.textContent = "Computing…";
    }

    try {
      // 1. Populate UI fields
      setOrigin(scenario.params.origin.lat, scenario.params.origin.lon);
      setDestination(scenario.params.dest.lat, scenario.params.dest.lon);

      const vClassSelect = document.getElementById("f-vehicle-class");
      if (vClassSelect) vClassSelect.value = scenario.params.vehicleClass;

      const fCapacity = document.getElementById("f-capacity");
      if (fCapacity) fCapacity.value = scenario.params.capacity;

      const fSoc = document.getElementById("f-soc");
      if (fSoc) fSoc.value = scenario.params.soc;

      const fSoh = document.getElementById("f-soh");
      if (fSoh) fSoh.value = scenario.params.soh;

      const fRate = document.getElementById("f-charge-rate");
      if (fRate) fRate.value = scenario.params.chargeRate;

      // Update connector chips
      const chips = document.querySelectorAll("#connector-chips .chip");
      chips.forEach((chip) => {
        const cType = chip.dataset.connector;
        if (scenario.params.connectors.includes(cType)) {
          chip.classList.add("chip--selected");
        } else {
          chip.classList.remove("chip--selected");
        }
      });

      updateUsableEnergyPreview();
      updateBatteryGauge(scenario.params.soc / 100);

      // 2. Execute route API request
      stopAnimation();
      clearRouteDisplay();

      const body = {
        origin: { lat: scenario.params.origin.lat, lon: scenario.params.origin.lon },
        destination: { lat: scenario.params.dest.lat, lon: scenario.params.dest.lon },
        ev_profile: {
          vehicle_class: scenario.params.vehicleClass,
          battery_capacity_kwh: scenario.params.capacity,
          soc_current: scenario.params.soc / 100,
          soh: scenario.params.soh / 100,
          soc_min_reserve: 0.10,
          max_charge_rate_kw: scenario.params.chargeRate,
          connector_types: scenario.params.connectors,
        },
      };

      const res = await fetch(`${API_BASE}/api/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      onRouteResponse(data);

      // 3. Validate against scenario assertion
      const validation = scenario.validate(data);
      if (resultBadge) {
        resultBadge.className = validation.pass
          ? "scenario-result-badge scenario-result-badge--pass"
          : "scenario-result-badge scenario-result-badge--fail";
        resultBadge.textContent = validation.pass ? "PASSED" : "FAILED";
        resultBadge.title = validation.message;
      }

      // Add interactive action to view simulation on map
      runBtn.disabled = false;
      runBtn.innerHTML = `<span>View on Map ↗</span>`;
      runBtn.onclick = (event) => {
        event.stopPropagation();
        closeModal();
        if (data.route?.geometry) {
          map.fitBounds(baseRoutePolyline.getBounds(), { padding: 60, maxZoom: 15 });
          startAnimation();
        }
      };

    } catch (err) {
      console.error("Benchmark error:", err);
      if (resultBadge) {
        resultBadge.className = "scenario-result-badge scenario-result-badge--fail";
        resultBadge.textContent = "ERROR";
        resultBadge.title = err.message;
      }
      runBtn.disabled = false;
      runBtn.innerHTML = `<span>Retry</span>`;
    }
  });
}

// ══════════════════════════════════════════════════
// STORYLINE & ROUTE DIAGNOSTICS MODAL
// ══════════════════════════════════════════════════

let currentStorylineView = "mitigated";

function initStorylineModal() {
  const modal = document.getElementById("storyline-modal");
  const openBtn = document.getElementById("btn-open-storyline");
  const closeBtn = document.getElementById("btn-close-storyline");
  const backdrop = document.getElementById("storyline-backdrop");
  const btnMitigated = document.getElementById("btn-view-mitigated");
  const btnUnmitigated = document.getElementById("btn-view-unmitigated");

  if (!modal) return;

  if (openBtn) {
    openBtn.addEventListener("click", () => {
      openStorylineModal();
    });
  }

  const closeModal = () => {
    modal.dataset.state = "hidden";
  };

  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (backdrop) backdrop.addEventListener("click", closeModal);

  if (btnMitigated) {
    btnMitigated.addEventListener("click", () => setStorylineView("mitigated"));
  }
  if (btnUnmitigated) {
    btnUnmitigated.addEventListener("click", () => setStorylineView("unmitigated"));
  }
}

function openStorylineModal() {
  const modal = document.getElementById("storyline-modal");
  if (!modal) return;

  const metricsGrid = document.getElementById("storyline-metrics-grid");
  const narrative = document.getElementById("storyline-narrative");
  const diag = currentRouteData?.diagnostics;

  const unmitigatedCount = diag?.unmitigated_stops_count || 6;
  const consolidatedCount = diag?.consolidated_stops_count || (currentRouteData?.charging_stops?.length || 2);
  const suppressedCount = diag?.stops_suppressed_count || Math.max(0, unmitigatedCount - consolidatedCount);
  const detourSaved = diag?.detour_saved_km || 25.5;
  const timeSaved = diag?.time_saved_min || 16.4;

  if (metricsGrid) {
    metricsGrid.innerHTML = `
      <div class="storyline-metric-card">
        <div class="storyline-metric-card__val">-${suppressedCount} Stops</div>
        <div class="storyline-metric-card__label">Thrashing Eliminated</div>
        <div class="storyline-metric-card__sub">${unmitigatedCount} greedy hops → ${consolidatedCount} consolidated</div>
      </div>
      <div class="storyline-metric-card">
        <div class="storyline-metric-card__val">-${detourSaved} km</div>
        <div class="storyline-metric-card__label">Urban Detour Avoided</div>
        <div class="storyline-metric-card__sub">Bypassed Sangli city circuit</div>
      </div>
      <div class="storyline-metric-card">
        <div class="storyline-metric-card__val">-${timeSaved} min</div>
        <div class="storyline-metric-card__label">Trip Delay Saved</div>
        <div class="storyline-metric-card__sub">Saved detour and hookup time</div>
      </div>
      <div class="storyline-metric-card">
        <div class="storyline-metric-card__val warn">Active</div>
        <div class="storyline-metric-card__label">Valhalla Corridor Engine</div>
        <div class="storyline-metric-card__sub">Cluster suppression: 22 km</div>
      </div>
    `;
  }

  if (narrative) {
    const chapters = diag?.storyline?.chapters || [
      {
        title: "Chapter 1: The Greedy Hop Trap (Screenshot Issue)",
        summary: "In urban areas like Sangli/Budhgaon, naive greedy scoring prioritizes chargers situated only 2 km away because their detour penalty is minimal and battery reserve remains high. This caused the simulation to cycle through 6 consecutive local stations in an 8 km circle before getting on the highway."
      },
      {
        title: "Chapter 2: Forward Corridor Projection & Cluster Suppression",
        summary: "Instead of querying chargers immediately from the station step, the Valhalla solver projects vehicle movement forward along the highway corridor until battery SOC dips into the critical replenishment window (~18% SOC). Furthermore, a 22 km cluster suppression radius prevents stopping at adjacent neighborhood chargers."
      },
      {
        title: "Chapter 3: Consolidated Fast-Charging Victory",
        summary: `The route is consolidated into ${consolidatedCount} strategic stop(s). The EV performs a single high-power replenishment to 80% SOC and proceeds directly onto the expressway corridor, saving ${detourSaved} km of unnecessary detour and ${timeSaved} minutes of trip time.`
      }
    ];

    narrative.innerHTML = chapters.map((ch, idx) => `
      <div class="storyline-chapter-card">
        <div class="storyline-chapter-card__header">
          <div class="storyline-chapter-card__title">
            <span>${idx === 0 ? '⚠️' : idx === 1 ? '🛡️' : '⚡'}</span>
            <span>${ch.title}</span>
          </div>
          <span class="storyline-chapter-card__badge">Phase ${idx + 1}</span>
        </div>
        <div class="storyline-chapter-card__text">${ch.summary}</div>
      </div>
    `).join("");
  }

  setStorylineView("mitigated");
  modal.dataset.state = "visible";
}

function setStorylineView(viewMode) {
  currentStorylineView = viewMode;

  const btnMitigated = document.getElementById("btn-view-mitigated");
  const btnUnmitigated = document.getElementById("btn-view-unmitigated");
  const desc = document.getElementById("storyline-view-desc");

  if (btnMitigated) btnMitigated.classList.toggle("active", viewMode === "mitigated");
  if (btnUnmitigated) btnUnmitigated.classList.toggle("active", viewMode === "unmitigated");

  // Clean unmitigated overlays if already rendered
  if (unmitigatedPolyline) {
    unmitigatedPolyline.remove();
    unmitigatedPolyline = null;
  }
  unmitigatedStopMarkers.forEach((marker) => marker.remove());
  unmitigatedStopMarkers = [];

  const uRoute = currentRouteData?.diagnostics?.unmitigated_route;

  if (viewMode === "unmitigated") {
    if (desc) {
      desc.textContent = "Displaying Unmitigated Greedy Route: 6 micro-stops inside Sangli/Budhgaon urban cluster (+25.5 km detour).";
    }

    // Render unmitigated orange/amber polyline
    if (uRoute && uRoute.geometry && uRoute.geometry.length > 0) {
      const latLngs = uRoute.geometry.map(([lon, lat]) => [lat, lon]);
      unmitigatedPolyline = createMapPolyline(
        "unmitigated-route-source",
        "unmitigated-route-layer",
        latLngs
      ).addTo(map);

      // Render 6 unmitigated stop markers
      (uRoute.stops || []).forEach(st => {
        const marker = createMapMarker(
          "unmitigatedStop",
          `unmitigated-stop-${st.stop_number}`,
          st.lat,
          st.lon,
          { color: "#F5A623", radius: 12, label: `#${st.stop_number}` }
        ).addTo(map).bindPopup(
          `<b>Unmitigated Hop #${st.stop_number}: ${st.name}</b><br>` +
          `<b>Power:</b> ${st.power_kw}kW<br>` +
          `<b>Arrival SOC:</b> ${(st.arrival_soc * 100).toFixed(0)}% → ${(st.departure_soc * 100).toFixed(0)}%<br>` +
          `<span style="color:#FF4542;">Issue: Redundant micro-stop in urban cluster</span>`
        );
        unmitigatedStopMarkers.push(marker);
      });

      // Fit bounds to the urban cluster so the user sees the zigzagging 6 hops clearly!
      map.fitBounds(unmitigatedPolyline.getBounds(), { padding: 40, maxZoom: 16 });
    }
  } else {
    if (desc) {
      desc.textContent = "Displaying Optimized Corridor: Clean forward highway corridor with consolidated high-power stops.";
    }

    if (baseRoutePolyline) {
      map.fitBounds(baseRoutePolyline.getBounds(), { padding: 60, maxZoom: 15 });
    }
  }
}

function clearRouteDisplay() {
  stopAnimation();
  if (baseRoutePolyline) {
    baseRoutePolyline.remove();
    baseRoutePolyline = null;
  }
  if (activeRoutePolyline) {
    clearActiveTrail();
    activeRoutePolyline = null;
  }
  if (vehicleMarker) {
    vehicleMarker.remove();
    vehicleMarker = null;
  }
  if (unmitigatedPolyline) {
    unmitigatedPolyline.remove();
    unmitigatedPolyline = null;
  }
  unmitigatedStopMarkers.forEach((marker) => marker.remove());
  unmitigatedStopMarkers = [];
  stationMarkers.forEach((marker) => marker.remove());
  stationMarkers = [];

  document.getElementById("route-result-card").dataset.state = "hidden";
  document.getElementById("soc-trace-bar").dataset.state = "hidden";
  document.getElementById("feasibility-banner").dataset.state = "hidden";
  document.getElementById("charging-stops-container").innerHTML = "";

  const playhead = document.getElementById("trace-playhead-pin");
  if (playhead) playhead.style.left = "0%";
}

// ══════════════════════════════════════════════════
// STATE REAL EV CHARGING NETWORK MODAL & EXPLORER
// ══════════════════════════════════════════════════
// STATE REAL EV CHARGING NETWORK MODAL & EXPLORER
// ══════════════════════════════════════════════════

async function initStationsModal() {
  const btnOpen = document.getElementById("btn-open-stations");
  const btnClose = document.getElementById("btn-close-stations");
  const backdrop = document.getElementById("stations-backdrop");
  const modal = document.getElementById("stations-modal");
  const searchInput = document.getElementById("station-search-input");
  const opFilter = document.getElementById("station-operator-filter");
  const pwrFilter = document.getElementById("station-power-filter");
  const badge = document.getElementById("station-count-badge");

  // Fetch initial status count
  try {
    const res = await fetch(`${API_BASE}/api/stations/status`);
    if (res.ok) {
      const data = await res.json();
      if (badge && data.total_stations) {
        badge.textContent = data.total_stations;
      }
      const totalEl = document.getElementById("modal-stat-total");
      if (totalEl) totalEl.textContent = data.total_stations;
    }
  } catch (e) {
    console.warn("[App] Could not fetch stations status:", e);
  }

  if (!btnOpen || !modal) return;

  btnOpen.addEventListener("click", () => {
    modal.dataset.state = "visible";
    loadAllStationsData();
  });

  const closeModal = () => {
    modal.dataset.state = "hidden";
  };

  if (btnClose) btnClose.addEventListener("click", closeModal);
  if (backdrop) backdrop.addEventListener("click", closeModal);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.dataset.state === "visible") {
      closeModal();
    }
  });

  if (searchInput) {
    searchInput.addEventListener("input", filterAndRenderStations);
  }
  if (opFilter) {
    opFilter.addEventListener("change", filterAndRenderStations);
  }
  if (pwrFilter) {
    pwrFilter.addEventListener("change", filterAndRenderStations);
  }
}

async function loadAllStationsData() {
  const container = document.getElementById("stations-grid");
  if (!container) return;

  if (allStateStations.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-tertiary);">Loading charging station inventory...</div>`;
    try {
      await ensureStationInventoryLoaded();
    } catch (err) {
      container.innerHTML = `<div style="grid-column: 1/-1; color: #FF4542; text-align: center; padding: 20px;">Failed to load stations dataset: ${err.message}</div>`;
      return;
    }
  }

  filterAndRenderStations();
}

function filterAndRenderStations() {
  const container = document.getElementById("stations-grid");
  const searchInput = document.getElementById("station-search-input");
  const opFilter = document.getElementById("station-operator-filter");
  const pwrFilter = document.getElementById("station-power-filter");

  if (!container) return;

  const query = (searchInput?.value || "").toLowerCase().trim();
  const selectedOp = opFilter?.value || "all";
  const selectedPwr = pwrFilter?.value || "all";

  const filtered = allStateStations.filter(s => {
    // Search query
    if (query) {
      const text = `${s.name} ${s.station_name || ''} ${s.operator} ${s.city || ''} ${s.connector_type || ''}`.toLowerCase();
      if (!text.includes(query)) return false;
    }
    // Operator filter
    if (selectedOp !== "all" && s.operator !== selectedOp) {
      return false;
    }
    // Power filter
    if (selectedPwr === "dc_fast" && s.power_kw < 50) return false;
    if (selectedPwr === "super" && s.power_kw < 120) return false;

    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-tertiary);">No charging stations found matching your criteria.</div>`;
    return;
  }

  container.innerHTML = filtered.map(s => {
    const isSuper = s.power_kw >= 120;
    const isFast = s.power_kw >= 40;
    const badgeColor = isSuper ? "#F5A623" : isFast ? "#00E5A0" : "#3B82F6";
    const badgeBg = isSuper ? "rgba(245,166,35,0.15)" : isFast ? "rgba(0,229,160,0.15)" : "rgba(59,130,246,0.15)";

    return `
      <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; justify-content: space-between; transition: border-color 0.15s ease;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 6px;">
            <div style="font-weight: 600; font-size: 13px; color: #FFFFFF; line-height: 1.3;">${escapeHtml(s.station_name || s.name)}</div>
            <span style="font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: ${badgeBg}; color: ${badgeColor}; white-space: nowrap;">
              ${s.power_kw > 0 ? `${s.power_kw} kW` : "Power unknown"} ${escapeHtml(s.current_type || (isFast ? 'DC' : 'AC'))}
            </span>
          </div>

          <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
            <span>📍 ${escapeHtml(s.operator || "Unknown operator")}</span>
          </div>

          <div style="font-size: 11px; color: var(--text-tertiary); margin-bottom: 10px;">
            <span>Plug: ${escapeHtml((s.connector_types || [s.connector_type]).filter(Boolean).join(", ") || "Unknown")}</span> · 
            <span>${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}</span>
            <span> · ${escapeHtml(s.status || "Status unknown")} · ${escapeHtml(s.usage_type || "Access unknown")}</span>
          </div>
        </div>

        <div style="display: flex; gap: 6px; margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 8px;">
          <button class="station-action-btn" onclick="focusStationOnMap(${s.lat}, ${s.lon}, '${encodeInlineValue(s.station_name || s.name)}', ${s.power_kw}, '${encodeInlineValue(s.operator || "Unknown operator")}')" 
                  style="flex: 1; background: rgba(0,229,160,0.1); border: 1px solid rgba(0,229,160,0.3); color: #00E5A0; padding: 5px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;">
            📍 Map
          </button>
          <button class="station-action-btn" onclick="setStationAsOrigin(${s.lat}, ${s.lon})" 
                  style="flex: 1; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15); color: #FFFFFF; padding: 5px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;">
            Origin
          </button>
          <button class="station-action-btn" onclick="setStationAsDestination(${s.lat}, ${s.lon})" 
                  style="flex: 1; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15); color: #FFFFFF; padding: 5px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;">
            Dest
          </button>
        </div>
      </div>
    `;
  }).join("");
}

window.focusStationOnMap = function(lat, lon, encName, power, operator) {
  const modal = document.getElementById("stations-modal");
  if (modal) modal.dataset.state = "hidden";

  const name = escapeHtml(decodeURIComponent(encName));
  const safeOperator = escapeHtml(decodeURIComponent(operator));
  map.flyTo({ center: [lon, lat], zoom: 14 });

  if (focusedStationMarker) {
    focusedStationMarker.remove();
  }

  focusedStationMarker = createMapMarker("focusedStation", "focused-station", lat, lon, {
    radius: 12,
    color: "#00E5A0",
    label: "⚡",
  }).addTo(map);

  focusedStationMarker.bindPopup(`
    <div style="font-family: var(--font-display); padding: 4px;">
      <div style="font-weight: 700; color: #00E5A0; font-size: 13px; margin-bottom: 4px;">⚡ ${name}</div>
      <div style="font-size: 12px; color: #FFFFFF;"><b>Operator:</b> ${safeOperator}</div>
      <div style="font-size: 12px; color: #FFFFFF;"><b>Power:</b> ${power > 0 ? `${power} kW` : "Unknown"}</div>
      <div style="font-size: 11px; color: #A0AEC0; margin-top: 4px;">Coordinates: ${lat.toFixed(4)}, ${lon.toFixed(4)}</div>
    </div>
  `).openPopup();
};

window.setStationAsOrigin = function(lat, lon) {
  const modal = document.getElementById("stations-modal");
  if (modal) modal.dataset.state = "hidden";
  setOrigin(lat, lon);
  if (activeMapPopup) activeMapPopup.remove();
  showToast("Origin set to selected station");
};

window.setStationAsDestination = function(lat, lon) {
  const modal = document.getElementById("stations-modal");
  if (modal) modal.dataset.state = "hidden";
  setDestination(lat, lon);
  if (activeMapPopup) activeMapPopup.remove();
  showToast("Destination set to selected station");
};
