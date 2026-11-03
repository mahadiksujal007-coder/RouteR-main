const API = 'http://127.0.0.1:3000/api/route';

const scenarios = [
  {
    id: 7, name: 'Anti-thrashing Sangli-Pune 18%',
    origin: { lat: 16.8524, lon: 74.5815 },
    destination: { lat: 18.5204, lon: 73.8567 },
    ev_profile: { vehicle_class: 'medium-duty', battery_capacity_kwh: 80, soc_current: 0.18, soh: 0.95, soc_min_reserve: 0.1, max_charge_rate_kw: 120, connector_types: ['CCS2', 'Type2'] },
  },
  {
    id: 8, name: 'Long-haul Surat',
    origin: { lat: 16.8524, lon: 74.5815 },
    destination: { lat: 21.1702, lon: 72.8311 },
    ev_profile: { vehicle_class: 'medium-duty', battery_capacity_kwh: 80, soc_current: 0.20, soh: 0.95, soc_min_reserve: 0.1, max_charge_rate_kw: 120, connector_types: ['CCS2', 'Type2'] },
  },
  {
    id: 9, name: 'Long-haul Bengaluru',
    origin: { lat: 16.8524, lon: 74.5815 },
    destination: { lat: 12.9716, lon: 77.5946 },
    ev_profile: { vehicle_class: 'medium-duty', battery_capacity_kwh: 80, soc_current: 0.20, soh: 0.95, soc_min_reserve: 0.1, max_charge_rate_kw: 120, connector_types: ['CCS2', 'Type2'] },
  },
  {
    id: 10, name: 'Mumbai-Delhi',
    origin: { lat: 19.076, lon: 72.8777 },
    destination: { lat: 28.6139, lon: 77.209 },
    ev_profile: { vehicle_class: 'medium-duty', battery_capacity_kwh: 80, soc_current: 0.95, soh: 1.0, soc_min_reserve: 0.1, max_charge_rate_kw: 120, connector_types: ['CCS2', 'Type2'] },
  },
];

function summarize(res) {
  const geom = res.route?.geometry || [];
  const stops = (res.charging_stops || []).map((s) => `${s.station_name} ${s.power_kw}kW ${s.connector_type} arr=${Math.round(s.arrival_soc * 100)}%`);
  return {
    feasible: res.feasible,
    stranded: res.stranded,
    charging_needed: res.charging_needed,
    detour: res.is_detour_routed,
    source: res.routing_source || res.route?.routing_source,
    verts: res.route?.geometry_vertex_count || geom.length,
    km: res.route?.total_distance_km,
    arrival: res.arrival_soc,
    stops: stops.length,
    stopDetail: stops,
    suppressed: res.diagnostics?.stops_suppressed_count,
    unmitigated: res.diagnostics?.unmitigated_stops_count,
    extraKm: res.detour_summary?.extra_distance_km,
    error: res.error,
  };
}

const only = process.argv[2];
const slice = only ? scenarios.filter((s) => String(s.id) === only) : scenarios;

for (const sc of slice) {
  const t = Date.now();
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: sc.origin, destination: sc.destination, ev_profile: sc.ev_profile }),
      signal: AbortSignal.timeout(180000),
    });
    const res = await r.json();
    console.log(`\n=== ${sc.id} ${sc.name} (${Date.now() - t}ms, HTTP ${r.status}) ===`);
    console.log(JSON.stringify(summarize(res), null, 2));
  } catch (e) {
    console.log(`\n=== ${sc.id} ${sc.name} FAILED ${e.message} (${Date.now() - t}ms) ===`);
  }
}
