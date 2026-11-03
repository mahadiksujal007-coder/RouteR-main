const API = 'http://127.0.0.1:3000/api/route';

const scenarios = [
  {
    id: 1, name: 'Local Direct',
    origin: { lat: 16.8524, lon: 74.5815 },
    destination: { lat: 16.8280, lon: 74.6450 },
    ev_profile: { vehicle_class: 'medium-duty', battery_capacity_kwh: 80, soc_current: 0.75, soh: 0.95, soc_min_reserve: 0.1, max_charge_rate_kw: 120, connector_types: ['CCS2', 'Type2'] },
  },
  {
    id: 2, name: 'Mandatory 1-stop detour',
    origin: { lat: 16.8524, lon: 74.5815 },
    destination: { lat: 16.7450, lon: 74.3120 },
    ev_profile: { vehicle_class: 'medium-duty', battery_capacity_kwh: 80, soc_current: 0.18, soh: 0.95, soc_min_reserve: 0.1, max_charge_rate_kw: 120, connector_types: ['CCS2', 'Type2'] },
  },
  {
    id: 3, name: 'Multi-stop Pune',
    origin: { lat: 16.8524, lon: 74.5815 },
    destination: { lat: 18.5204, lon: 73.8567 },
    ev_profile: { vehicle_class: 'medium-duty', battery_capacity_kwh: 80, soc_current: 0.50, soh: 0.95, soc_min_reserve: 0.1, max_charge_rate_kw: 120, connector_types: ['CCS2', 'Type2'] },
  },
  {
    id: 4, name: 'Stranded 5% SOC',
    origin: { lat: 16.8524, lon: 74.5815 },
    destination: { lat: 17.2880, lon: 74.1840 },
    ev_profile: { vehicle_class: 'medium-duty', battery_capacity_kwh: 80, soc_current: 0.05, soh: 0.95, soc_min_reserve: 0.1, max_charge_rate_kw: 120, connector_types: ['CCS2'] },
  },
  {
    id: 5, name: 'Type2 filter',
    origin: { lat: 16.8524, lon: 74.5815 },
    destination: { lat: 16.7450, lon: 74.3120 },
    ev_profile: { vehicle_class: 'medium-duty', battery_capacity_kwh: 80, soc_current: 0.20, soh: 0.95, soc_min_reserve: 0.1, max_charge_rate_kw: 60, connector_types: ['Type2'] },
  },
  {
    id: 6, name: 'Feeder 14% SOC',
    origin: { lat: 16.8524, lon: 74.5815 },
    destination: { lat: 16.7050, lon: 74.2433 },
    ev_profile: { vehicle_class: 'medium-duty', battery_capacity_kwh: 80, soc_current: 0.14, soh: 0.95, soc_min_reserve: 0.1, max_charge_rate_kw: 120, connector_types: ['CCS2', 'Type2'] },
  },
];

function summarize(res) {
  const geom = res.route?.geometry || [];
  let pathM = 0;
  for (let i = 1; i < geom.length; i++) {
    const [lon1, lat1] = geom[i - 1];
    const [lon2, lat2] = geom[i];
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    pathM += 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  const stops = (res.charging_stops || []).map((s) => `${s.station_name} ${s.power_kw}kW ${s.connector_type}`);
  return {
    feasible: res.feasible,
    stranded: res.stranded,
    charging_needed: res.charging_needed,
    detour: res.is_detour_routed,
    source: res.routing_source || res.route?.routing_source,
    verts: res.route?.geometry_vertex_count || geom.length,
    km: res.route?.total_distance_km,
    pathKm: Number((pathM / 1000).toFixed(1)),
    arrival: res.arrival_soc,
    stops: stops.length,
    stopDetail: stops,
    connectors: (res.charging_stops || []).map((s) => s.connector_type),
    error: res.error,
  };
}

const slice = process.argv[2] ? scenarios.filter((s) => String(s.id) === process.argv[2]) : scenarios;

for (const sc of slice) {
  const t = Date.now();
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: sc.origin, destination: sc.destination, ev_profile: sc.ev_profile }),
      signal: AbortSignal.timeout(120000),
    });
    const res = await r.json();
    console.log(`\n=== ${sc.id} ${sc.name} (${Date.now() - t}ms, HTTP ${r.status}) ===`);
    console.log(JSON.stringify(summarize(res), null, 2));
  } catch (e) {
    console.log(`\n=== ${sc.id} ${sc.name} FAILED ${e.message} (${Date.now() - t}ms) ===`);
  }
}
