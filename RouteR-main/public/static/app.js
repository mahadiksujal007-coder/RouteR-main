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
let vehicleMarker = null;
let stationMarkers = [];
let nearbyStationMarkers = [];
let clickMode = "origin"; // "origin" | "destination"
let originCoords = null;
let destCoords = null;

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
};

// Sangli Default Center
const SANGLI_CENTER = [16.8524, 74.5815];

// ─── Initialize ───
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  initEVProfileListeners();
  initButtonListeners();
  initChipListeners();
  initAnimationControls();
  initBenchmarkModal();
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

function initMap() {
  // Sangli center
  map = L.map("map", {
    center: SANGLI_CENTER,
    zoom: 13,
    zoomControl: false,
  });

  // Standard OpenStreetMap with clear highway visibility
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);

  // Zoom control — bottom right
  L.control.zoom({ position: "bottomright" }).addTo(map);

  // Click handler
  map.on("click", onMapClick);

  // Load nearby chargers for Sangli by default
  fetchDefaultStations(SANGLI_CENTER[0], SANGLI_CENTER[1]);
}

async function fetchDefaultStations(lat, lon) {
  try {
    const res = await fetch(`${API_BASE}/api/stations?lat=${lat}&lon=${lon}&radius_km=25.0`);
    const data = await res.json();
    if (data.stations && data.stations.length > 0) {
      renderNearbyStationMarkers(data.stations);
    }
  } catch (e) {
    console.error("[App] Failed to load default stations:", e);
  }
}

function onMapClick(e) {
  const { lat, lng: lon } = e.latlng;

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

  if (originMarker) map.removeLayer(originMarker);
  originMarker = L.circleMarker([lat, lon], {
    radius: 9,
    color: "#00E5A0",
    fillColor: "#0D0F11",
    fillOpacity: 1,
    weight: 3,
  }).addTo(map).bindPopup("<b>Trip Origin</b><br>Coordinates: " + lat.toFixed(4) + ", " + lon.toFixed(4));

  updateCalculateButton();
}

function setDestination(lat, lon) {
  destCoords = { lat, lon };
  document.getElementById("dest-input").value = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  document.getElementById("dest-input").dataset.filled = "true";

  if (destMarker) map.removeLayer(destMarker);
  destMarker = L.circleMarker([lat, lon], {
    radius: 9,
    color: "#00E5A0",
    fillColor: "#00E5A0",
    fillOpacity: 1,
    weight: 3,
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
  "medium-duty": { capacity: 80, chargeRate: 120, name: "Medium-Duty Commercial" },
  "default_bev": { capacity: 40, chargeRate: 50, name: "Standard Light BEV" },
  "tata_nexon_ev": { capacity: 40.5, chargeRate: 50, name: "Tata Nexon EV Max" },
  "heavy-duty": { capacity: 160, chargeRate: 250, name: "Heavy-Duty Truck" },
};

function initEVProfileListeners() {
  const vehicleSelect = document.getElementById("f-vehicle-class");
  if (vehicleSelect) {
    vehicleSelect.addEventListener("change", function () {
      const def = VEHICLE_DEFAULTS[this.value] || VEHICLE_DEFAULTS["medium-duty"];
      document.getElementById("f-capacity").value = def.capacity;
      document.getElementById("f-charge-rate").value = def.chargeRate;
      updateUsableEnergyPreview();
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
  });
}

function getSelectedConnectors() {
  const chips = document.querySelectorAll("#connector-chips .chip--selected");
  return Array.from(chips).map((c) => c.dataset.connector);
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

  // 3. SOC trace
  if (response.soc_trace && response.soc_trace.length > 0) {
    buildSocTrace(response.soc_trace, response.charging_stops || []);
  }

  // 4. Map route polyline
  if (response.route?.geometry) {
    renderRoutePolyline(response.route.geometry);
  }

  // 5. Charging stop cards & map markers
  if (response.charging_stops && response.charging_stops.length > 0) {
    renderChargingStopCards(response.charging_stops, response.detour_summary, response.legs);
    renderChargingStopMarkers(response.charging_stops);
  }

  // 6. Setup Route Animation
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
  if (baseRoutePolyline) map.removeLayer(baseRoutePolyline);
  if (activeRoutePolyline) map.removeLayer(activeRoutePolyline);

  // geometry is [[lon, lat], ...] — Leaflet uses [lat, lon]
  const latLngs = geometry.map(([lon, lat]) => [lat, lon]);

  // Base polyline (unreached route)
  baseRoutePolyline = L.polyline(latLngs, {
    color: "#00E5A0",
    weight: 4,
    opacity: 0.25,
    smoothFactor: 1,
  }).addTo(map);

  // Active polyline (traveled glowing path)
  activeRoutePolyline = L.polyline([], {
    color: "#00E5A0",
    weight: 5,
    opacity: 0.95,
    smoothFactor: 1,
  }).addTo(map);

  map.fitBounds(baseRoutePolyline.getBounds(), { padding: [60, 60] });
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
  stationMarkers.forEach((m) => map.removeLayer(m));
  stationMarkers = [];

  stops.forEach((stop, idx) => {
    if (!stop.lat || !stop.lon) return;

    const stopNumber = idx + 1;
    const marker = L.marker([stop.lat, stop.lon], {
      icon: L.divIcon({
        className: "",
        html: `<div style="
          background: #F5A623;
          color: #0D0F11;
          min-width: 34px; height: 34px;
          padding: 0 4px;
          border-radius: 17px;
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-display, sans-serif);
          font-size: 13px; font-weight: 800;
          border: 2px solid #0D0F11;
          box-shadow: 0 0 18px rgba(245,166,35,0.85);
        ">⚡ #${stopNumber}</div>`,
        iconSize: [40, 34],
        iconAnchor: [20, 17],
      }),
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
  nearbyStationMarkers.forEach((m) => map.removeLayer(m));
  nearbyStationMarkers = [];

  stations.forEach((station) => {
    if (!station.lat || !station.lon) return;

    const marker = L.marker([station.lat, station.lon], {
      icon: L.divIcon({
        className: "",
        html: `<div style="
          background: #23A6F5;
          color: #0D0F11;
          width: 22px; height: 22px;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: bold;
          border: 2px solid #0D0F11;
          box-shadow: 0 0 10px rgba(35,166,245,0.5);
        ">🔌</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
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
    map.removeLayer(vehicleMarker);
  }

  const [firstLon, firstLat] = coords[0];
  const vehicleIcon = L.divIcon({
    className: "ev-anim-marker-wrapper",
    html: `
      <div class="ev-anim-marker">
        <div class="ev-marker-pulse"></div>
        <div class="ev-marker-body" id="ev-marker-rotator">
          <span class="ev-marker-arrow">▲</span>
        </div>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });

  vehicleMarker = L.marker([firstLat, firstLon], {
    icon: vehicleIcon,
    zIndexOffset: 1000,
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

function updateAnimationUI(state, progress) {
  // 1. Move vehicle marker & rotate heading
  if (vehicleMarker) {
    vehicleMarker.setLatLng([state.lat, state.lon]);
    const rotator = document.getElementById("ev-marker-rotator");
    if (rotator) {
      rotator.style.transform = `rotate(${state.bearing}deg)`;
    }
  }

  // 2. Update active polyline trail
  if (activeRoutePolyline && anim.routeData?.route?.geometry) {
    const coords = anim.routeData.route.geometry;
    const traveled = [];
    for (let i = 0; i <= state.segIdx; i++) {
      traveled.push([coords[i][1], coords[i][0]]);
    }
    traveled.push([state.lat, state.lon]);
    activeRoutePolyline.setLatLngs(traveled);
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

function animationLoop(timestamp) {
  if (!anim.isPlaying) return;

  const dt = timestamp - (anim.lastTimestamp || timestamp);
  anim.lastTimestamp = timestamp;

  // Handle active charging pause
  if (anim.isCharging) {
    const chargeDurationMs = 2800 / anim.speed;
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

  // Base trip simulation duration = 16 seconds at 1x speed
  const baseDurationMs = 16000;
  const progressDelta = (dt / (baseDurationMs / anim.speed));
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

      // Pan slightly to charger
      if (stop.lat && stop.lon) {
        map.panTo([stop.lat, stop.lon], { animate: true, duration: 0.5 });
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

function clearRouteDisplay() {
  stopAnimation();
  if (baseRoutePolyline) { map.removeLayer(baseRoutePolyline); baseRoutePolyline = null; }
  if (activeRoutePolyline) { map.removeLayer(activeRoutePolyline); activeRoutePolyline = null; }
  if (vehicleMarker) { map.removeLayer(vehicleMarker); vehicleMarker = null; }

  stationMarkers.forEach((m) => map.removeLayer(m));
  stationMarkers = [];

  document.getElementById("route-result-card").dataset.state = "hidden";
  document.getElementById("soc-trace-bar").dataset.state = "hidden";
  document.getElementById("feasibility-banner").dataset.state = "hidden";
  document.getElementById("charging-stops-container").innerHTML = "";

  const playhead = document.getElementById("trace-playhead-pin");
  if (playhead) playhead.style.left = "0%";
}

// Event delegation for charging stop cards → pan map to station
document.getElementById("route-result-section").addEventListener("click", (e) => {
  const card = e.target.closest(".charging-stop-card");
  if (!card) return;
  const stationId = card.dataset.stationId;
  const marker = stationMarkers.find((m) => m._popup?._content?.includes(stationId));
  if (marker) {
    map.flyTo(marker.getLatLng(), 15, { duration: 0.5 });
    marker.openPopup();
  }
});

// ══════════════════════════════════════════════════
// BENCHMARK TEST MATRIX & SCENARIO ENGINE
// ══════════════════════════════════════════════════

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
      const pass = res.feasible === true && (!res.charging_stops || res.charging_stops.length === 0) && res.charging_needed === false;
      return {
        pass,
        message: pass
          ? `✓ Feasible Direct: ${res.route.total_distance_km} km, Arr: ${(res.arrival_soc * 100).toFixed(0)}% SOC, 0 detours`
          : `✗ Expected 0 stops, received ${res.charging_stops?.length || 0}`
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
      const pass = res.feasible === true && res.charging_needed === true && (res.charging_stops && res.charging_stops.length >= 1) && res.is_detour_routed === true;
      const extraKm = res.detour_summary?.extra_distance_km ?? 0;
      const st = res.charging_stops ? res.charging_stops[0] : null;
      return {
        pass,
        message: pass
          ? `✓ Re-routed: +${extraKm} km road detour via ${st ? st.station_name : 'Station'} (${st ? st.power_kw : ''} kW DC)`
          : `✗ Physical detour not established`
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
          map.fitBounds(baseRoutePolyline.getBounds(), { padding: [60, 60] });
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

