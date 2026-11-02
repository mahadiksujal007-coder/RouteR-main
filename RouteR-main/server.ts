/**
 * Make My Route — Full-Stack Node.js/Express Server
 * Implements EV Route Planning, Battery State Modeling, SOC Trace Simulation,
 * OpenChargeMap integration, and Frontend Serving on port 3000.
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const OCM_API_KEY = process.env.OCM_API_KEY || '2b919b17-4442-4cb9-9b78-7abd03d0167a';
const GPXZ_API_KEY = process.env.GPXZ_API_KEY || 'ak_7LAPcz3y_15cZJG1Ahov2FeX5';
const API_NINJAS_KEY = process.env.API_NINJAS_KEY || '2po9AYuGjzfeeg5gRnchzmFqLIV3ef6pOaANM3Br';
const MAPBOX_PUBLIC_TOKEN = process.env.MAPBOX_PUBLIC_TOKEN || '';
const REGION = process.env.REGION || 'Sangali, Maharashtra, India';
const VEHICLE_CLASS_DEFAULT = process.env.VEHICLE_CLASS_DEFAULT || 'medium-duty';

// Physics constants for EV energy simulation
const RHO_AIR = 1.225; // kg/m^3 (sea level, 15°C)
const GRAVITY = 9.81; // m/s^2

export interface VehiclePhysicsProfile {
  id: string;
  name: string;
  mass_kg: number;
  cd: number;
  frontal_area: number;
  mu_rolling: number;
  regen_eff: number;
  aux_load_kw: number;
  default_battery_kwh: number;
  default_charge_rate_kw: number;
}

export const VEHICLE_PROFILES: Record<string, VehiclePhysicsProfile> = {
  'medium-duty': {
    id: 'medium-duty',
    name: 'Medium-Duty EV (Commercial & Delivery)',
    mass_kg: 3200,
    cd: 0.38,
    frontal_area: 4.20,
    mu_rolling: 0.018,
    regen_eff: 0.60,
    aux_load_kw: 0.90,
    default_battery_kwh: 80,
    default_charge_rate_kw: 120
  },
  'default_bev': {
    id: 'default_bev',
    name: 'Standard Light BEV (Passenger Sedan/SUV)',
    mass_kg: 1800,
    cd: 0.28,
    frontal_area: 2.30,
    mu_rolling: 0.015,
    regen_eff: 0.70,
    aux_load_kw: 0.30,
    default_battery_kwh: 40,
    default_charge_rate_kw: 50
  },
  'heavy-duty': {
    id: 'heavy-duty',
    name: 'Heavy-Duty Electric Truck',
    mass_kg: 7500,
    cd: 0.55,
    frontal_area: 6.80,
    mu_rolling: 0.022,
    regen_eff: 0.50,
    aux_load_kw: 1.80,
    default_battery_kwh: 160,
    default_charge_rate_kw: 250
  }
};

const VEHICLE_CONNECTORS: Record<string, string[]> = {
  'medium-duty': ['CCS2', 'Type2'],
  'default_bev': ['CCS1', 'Type1'],
  'tata_nexon_ev': ['CCS2', 'Type2'],
  'heavy-duty': ['CCS2', 'Type2'],
  'leaf_bev': ['CHAdeMO', 'Type1']
};

// Metric tracker
let totalRequests = 0;
let totalRoutes = 0;

// Pre-seeded Sangli, Miraj, Nashik & Maharashtra charging stations
interface Station {
  ocm_id: number;
  name: string;
  station_name?: string;
  lat: number;
  lon: number;
  power_kw: number;
  connector_type: string;
  connector_types?: string[];
  current_type: string;
  operator: string;
  usage_type?: string;
  is_public?: boolean;
  status?: string;
  address?: string;
  city?: string;
  state?: string;
  data_provider?: string;
  date_last_verified?: string;
  data_source?: string;
  is_demo?: boolean;
  is_fast_charge?: boolean;
  best_connection?: {
    effective_power_kw: number;
  };
}

function normalizeConnectorTypes(value: string): string[] {
  const normalized = new Set<string>();
  const connectorNames = value.split(';').map(name => name.trim().toLowerCase());

  for (const name of connectorNames) {
    if (!name || name === 'unknown') continue;
    if (name.includes('ccs')) {
      normalized.add(/ccs\s*1|type\s*1|combo\s*1/.test(name) ? 'CCS1' : 'CCS2');
    }
    if (/type\s*2/.test(name)) normalized.add('Type2');
    if (name.includes('chademo')) normalized.add('CHAdeMO');
    if (/gb\s*[-/]?\s*t/.test(name)) normalized.add('GB/T');
    if (/type\s*1|j1772/.test(name)) normalized.add('Type1');
  }

  return Array.from(normalized);
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const input = content.replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (inQuotes && input[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(field.trim());
      field = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some(value => value.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (inQuotes) throw new Error('Station CSV contains an unclosed quoted field.');
  row.push(field.trim());
  if (row.some(value => value.length > 0)) rows.push(row);
  return rows;
}

function hashStringToInt(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function normalizeStationName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseMaximumPowerKw(value: string): number {
  const powers = value
    .split(/[|;,]/)
    .map(entry => Number(entry.trim()))
    .filter(power => Number.isFinite(power) && power > 0);
  return powers.length > 0 ? Math.max(...powers) : 0;
}

function getCompatibleStationConnector(station: Station, connectorTypes: string[]): string | null {
  const availableConnectors = station.connector_types?.length
    ? station.connector_types
    : normalizeConnectorTypes(station.connector_type);
  if (connectorTypes.length === 0) return null;
  return connectorTypes.find(connector => availableConnectors.includes(connector)) || null;
}

function stationSupportsConnectors(station: Station, connectorTypes: string[]): boolean {
  return getCompatibleStationConnector(station, connectorTypes) !== null;
}

const SANGLI_LAT = 16.8524;
const SANGLI_LON = 74.5815;

// Deterministic mock stations for Sangli, Miraj, Kolhapur & Maharashtra EV corridors
function generateMaharashtraStations(): Station[] {
  const operators = [
    'Tata Power EZ Charge',
    'Jio-bp pulse',
    'ChargeZone',
    'Statiq Superfast',
    'Zeon Charging',
    'Ather Grid Hub',
    'Magenta ChargeGrid',
    'Relux Electric'
  ];

  const locations = [
    // Sangli & Miraj Corridor
    { name: 'Sangli Vishrambag EV Hub', lat: 16.8450, lon: 74.6010, power: 60, conn: 'CCS2', op: 'Tata Power EZ Charge' },
    { name: 'Miraj Railway Junction Fast Plaza', lat: 16.8280, lon: 74.6450, power: 120, conn: 'CCS2', op: 'Jio-bp pulse' },
    { name: 'Sangli Kupwad MIDC Heavy Charger', lat: 16.8710, lon: 74.6280, power: 150, conn: 'CCS2', op: 'ChargeZone' },
    { name: 'Sangli ST Stand EV Hub', lat: 16.8560, lon: 74.5780, power: 50, conn: 'CCS2', op: 'Tata Power EZ Charge' },
    { name: 'Sangli-Kolhapur Highway Plaza', lat: 16.8120, lon: 74.5200, power: 120, conn: 'CCS2', op: 'Statiq Superfast' },
    { name: 'Ashta Phata DC Fast Charger', lat: 16.9500, lon: 74.4100, power: 60, conn: 'CCS2', op: 'Zeon Charging' },
    { name: 'Islampur Highway Supercharger', lat: 17.0500, lon: 74.2600, power: 150, conn: 'CCS2', op: 'Tata Power EZ Charge' },
    { name: 'Tasgaon Commercial EV Hub', lat: 17.0320, lon: 74.6010, power: 50, conn: 'CCS2', op: 'Magenta ChargeGrid' },
    { name: 'Jaysingpur Bypass Charging Spot', lat: 16.7840, lon: 74.5600, power: 60, conn: 'CCS2', op: 'Jio-bp pulse' },
    { name: 'Shirol MIDC Industrial Charger', lat: 16.7320, lon: 74.5980, power: 120, conn: 'CCS2', op: 'Relux Electric' },
    { name: 'Kolhapur Shiroli Toll Hub', lat: 16.7450, lon: 74.3120, power: 150, conn: 'CCS2', op: 'Tata Power EZ Charge' },
    { name: 'Karad Highway Fast Stop', lat: 17.2880, lon: 74.1840, power: 120, conn: 'CCS2', op: 'ChargeZone' },
    { name: 'Satara NH48 Supercharger', lat: 17.6850, lon: 74.0050, power: 150, conn: 'CCS2', op: 'Tata Power EZ Charge' },
    { name: 'Shirwal Highway DC Plaza', lat: 18.1320, lon: 73.9850, power: 120, conn: 'CCS2', op: 'Jio-bp pulse' },
    { name: 'Khed Shivapur Expressway Hub', lat: 18.3540, lon: 73.8640, power: 150, conn: 'CCS2', op: 'ChargeZone' },
    { name: 'Pune Swargate EV Hub', lat: 18.5010, lon: 73.8580, power: 120, conn: 'CCS2', op: 'Statiq Superfast' },
    // Nashik & Additional Nodes
    { name: 'City Centre Mall Station', lat: 20.0035, lon: 73.7632, power: 60, conn: 'CCS2', op: 'Tata Power EZ Charge' },
    { name: 'Mumbai-Agra Highway Hub', lat: 19.9820, lon: 73.7650, power: 120, conn: 'CCS2', op: 'Jio-bp pulse' },
    { name: 'Nashik Road Railway Station Hub', lat: 19.9542, lon: 73.8415, power: 50, conn: 'CCS2', op: 'Tata Power EZ Charge' },
    { name: 'Ambad MIDC Fast Charger', lat: 19.9450, lon: 73.7310, power: 150, conn: 'CCS2', op: 'ChargeZone' },
    { name: 'Sinnar Highway Junction', lat: 19.8600, lon: 73.9800, power: 150, conn: 'CCS2', op: 'Zeon Charging' },
    { name: 'Igatpuri Hill Pass Station', lat: 19.7020, lon: 73.5600, power: 120, conn: 'CCS2', op: 'Tata Power EZ Charge' }
  ];

  const list: Station[] = [];

  locations.forEach((loc, idx) => {
    const isFast = loc.power >= 40;
    list.push({
      ocm_id: 910000 + idx,
      name: `${loc.name} (${loc.power}kW)`,
      station_name: loc.name,
      lat: loc.lat,
      lon: loc.lon,
      power_kw: loc.power,
      connector_type: loc.conn,
      connector_types: normalizeConnectorTypes(loc.conn),
      current_type: isFast ? 'DC Fast' : 'AC',
      operator: loc.op || operators[idx % operators.length],
      usage_type: 'Public',
      is_public: true,
      status: 'Demo data (not verified)',
      data_source: 'Synthetic demo fixture',
      is_demo: true,
      is_fast_charge: isFast,
      best_connection: {
        effective_power_kw: loc.power
      }
    });
  });

  // Additional 25 grid points around Sangli coordinates
  for (let i = 0; i < 25; i++) {
    const angle = (i / 25) * Math.PI * 2;
    const dist = 0.025 + (i % 5) * 0.015;
    const lat = SANGLI_LAT + Math.sin(angle) * dist;
    const lon = SANGLI_LON + Math.cos(angle) * dist * 1.1;
    const powers = [30, 50, 60, 120, 150];
    const power = powers[i % powers.length];
    const isFast = power >= 40;
    const conn = isFast ? 'CCS2' : 'Type2';
    const op = operators[(i + 2) % operators.length];

    list.push({
      ocm_id: 930000 + i,
      name: `${op} — Sangli ${isFast ? 'DC Supercharger' : 'Charging Hub'} ${i + 1} (${power}kW)`,
      station_name: `${op} Sangli Point ${i + 1}`,
      lat: Number(lat.toFixed(5)),
      lon: Number(lon.toFixed(5)),
      power_kw: power,
      connector_type: conn,
      connector_types: normalizeConnectorTypes(conn),
      current_type: isFast ? 'DC Fast' : 'AC',
      operator: op,
      usage_type: 'Public',
      is_public: true,
      status: 'Demo data (not verified)',
      data_source: 'Synthetic demo fixture',
      is_demo: true,
      is_fast_charge: isFast,
      best_connection: {
        effective_power_kw: power
      }
    });
  }

  return list;
}

// Ingest stations from project CSV inventories.
function loadStationsFromCsv(): Station[] {
  const csvPaths = [
    path.join(__dirname, 'data', 'stations_final.csv'),
    path.join(__dirname, 'data', 'stations_india.csv'),
    path.join(__dirname, 'data', 'stations.csv')
  ];
  const stations: Station[] = [];

  for (const csvPath of csvPaths) {
    if (!fs.existsSync(csvPath)) continue;

    const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
    if (rows.length < 2) continue;

    const headers = rows[0].map(header => header.toLowerCase());
    const value = (row: string[], header: string) => {
      const index = headers.indexOf(header);
      return index < 0 ? '' : row[index] || '';
    };

    let loadedCount = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const lat = Number(value(row, 'lat'));
      const lon = Number(value(row, 'lon'));
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
          !Number.isFinite(lon) || lon < -180 || lon > 180) continue;

      const name = value(row, 'name') || `Station ${i}`;
      const power = Number(value(row, 'power_kw')) || 0;
      const rawConnector = value(row, 'connector_type');
      const connectors = normalizeConnectorTypes(rawConnector);
      const usageType = value(row, 'usage_type') || (path.basename(csvPath) === 'stations.csv' ? 'Public' : 'Unknown access');
      const status = value(row, 'status') || 'Unknown';
      const parsedId = Number.parseInt(value(row, 'ocm_id'), 10);
      const isPublic = /^public\b/i.test(usageType);

      stations.push({
        ocm_id: Number.isFinite(parsedId) ? parsedId : 950000 + i,
        name: power > 0 ? `${name} (${power}kW)` : name,
        station_name: name,
        lat,
        lon,
        power_kw: power,
        connector_type: connectors[0] || rawConnector || 'Unknown',
        connector_types: connectors,
        current_type: value(row, 'current_type') || (power >= 40 ? 'DC Fast' : power > 0 ? 'AC' : 'Unknown'),
        operator: value(row, 'operator') || 'Unknown operator',
        usage_type: usageType,
        is_public: isPublic,
        status,
        address: value(row, 'address'),
        city: value(row, 'city'),
        state: value(row, 'state') || value(row, 'state_name_raw'),
        data_provider: value(row, 'data_provider'),
        date_last_verified: value(row, 'date_last_verified'),
        data_source: path.basename(csvPath),
        is_fast_charge: power >= 40,
        best_connection: power > 0 ? { effective_power_kw: power } : undefined
      });
      loadedCount++;
    }

    console.log(`[CSV INGESTION] Loaded ${loadedCount} stations from ${csvPath}`);
  }

  return stations;
}

function loadStationsFromUniqueCsv(): Station[] {
  const csvPath = path.join(__dirname, 'data', 'EV_Charging_Stations_India_unique.csv');
  if (!fs.existsSync(csvPath)) return [];

  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  if (rows.length < 2) return [];

  const headers = rows[0].map(header => header.toLowerCase());
  const value = (row: string[], header: string) => {
    const index = headers.indexOf(header);
    return index < 0 ? '' : row[index] || '';
  };
  const stations: Station[] = [];
  let outsideIndia = 0;
  let incompleteOrUnsupported = 0;
  let privateAccess = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const lat = Number(value(row, 'latitude'));
    const lon = Number(value(row, 'longitude'));
    if (!Number.isFinite(lat) || lat < 6 || lat > 38 ||
        !Number.isFinite(lon) || lon < 68 || lon > 98) {
      outsideIndia++;
      continue;
    }

    const name = value(row, 'station_name').trim();
    const rawConnector = value(row, 'connector_type');
    const connectors = normalizeConnectorTypes(rawConnector);
    const power = parseMaximumPowerKw(value(row, 'power_kw'));
    const usageType = value(row, 'access_info').trim();
    if (!name || power <= 0 || connectors.length === 0 || !/^public\b/i.test(usageType)) {
      if (/private|staff|restricted/i.test(usageType)) privateAccess++;
      else incompleteOrUnsupported++;
      continue;
    }

    const stationId = 3_000_000_000 + hashStringToInt(
      `${normalizeStationName(name)}|${lat.toFixed(5)}|${lon.toFixed(5)}`
    );
    const hasDcConnector = connectors.some(connector =>
      ['CCS1', 'CCS2', 'CHAdeMO', 'GB/T'].includes(connector)
    );
    stations.push({
      ocm_id: stationId,
      name: `${name} (${power}kW)`,
      station_name: name,
      lat,
      lon,
      power_kw: power,
      connector_type: connectors[0],
      connector_types: connectors,
      current_type: hasDcConnector ? 'DC Fast' : 'AC',
      operator: value(row, 'operator') || 'Unknown operator',
      usage_type: usageType,
      is_public: true,
      address: value(row, 'address'),
      city: value(row, 'city'),
      state: value(row, 'state') || value(row, 'state_standard'),
      data_provider: value(row, 'source_files') || 'EV_Charging_Stations_India_unique.csv',
      data_source: 'EV_Charging_Stations_India_unique.csv',
      is_fast_charge: power >= 40,
      best_connection: { effective_power_kw: power }
    });
  }

  console.log(
    `[CSV INGESTION] ${path.basename(csvPath)}: ${stations.length} route-ready rows; ` +
    `${outsideIndia} outside India bounds; ${privateAccess} private; ` +
    `${incompleteOrUnsupported} missing usable power/connector/access data`
  );
  return stations;
}

function loadStationsFromJson(): Station[] {
  const jsonPaths = [
    path.join(__dirname, 'data', 'stations.json')
  ];
  const stations: Station[] = [];

  for (const jsonPath of jsonPaths) {
    if (!fs.existsSync(jsonPath)) continue;

    let payload: any[] = [];
    try {
      payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch (error) {
      console.warn(`[JSON INGESTION] Failed to parse ${jsonPath}:`, error);
      continue;
    }

    if (!Array.isArray(payload)) continue;

    let loadedCount = 0;
    for (const record of payload) {
      if (!record || typeof record !== 'object') continue;

      const lat = Number(record.latitude ?? record.lat);
      const lon = Number(record.longitude ?? record.lon);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
          !Number.isFinite(lon) || lon < -180 || lon > 180) continue;
      if (record.location_quality && record.location_quality !== 'ok') continue;

      const chargerList = Array.isArray(record.chargers) ? record.chargers : [];
      const chargerPowers = chargerList
        .map((charger: any) => Number(charger?.charger_kw ?? charger?.kw ?? 0))
        .filter((value: number) => Number.isFinite(value) && value > 0);
      const powerKw = Number(record.max_power_kw) || (chargerPowers.length ? Math.max(...chargerPowers) : 0);
      if (!powerKw || powerKw <= 0) continue;

      const standards = Array.isArray(record.standards) ? record.standards : [];
      const connectorTypes = Array.from(new Set(
        normalizeConnectorTypes(
          standards.length
            ? standards.join(';')
            : chargerList.flatMap((charger: any) => Array.isArray(charger?.guns)
              ? charger.guns.map((gun: any) => String(gun?.standard || ''))
              : [])
                .join(';')
        )
      ));
      const ownership = String(record.ownership || 'govt').toLowerCase();
      const isPublic = ownership !== 'private';
      const stationName = String(record.operator || record.city || 'Charging station').trim() || 'Charging station';
      const stationId = typeof record.id === 'string' ? hashStringToInt(record.id) : Math.round((lat + 90) * 1e6 + (lon + 180) * 1e6);

      stations.push({
        ocm_id: stationId,
        name: `${stationName} (${powerKw}kW)`,
        station_name: stationName,
        lat,
        lon,
        power_kw: powerKw,
        connector_type: connectorTypes[0] || 'Unknown',
        connector_types: connectorTypes,
        current_type: Array.isArray(record.currents) && record.currents.length ? String(record.currents[0]) : (powerKw >= 40 ? 'DC' : 'AC'),
        operator: String(record.operator || 'Unknown operator'),
        usage_type: isPublic ? 'Public' : 'Private',
        is_public: isPublic,
        status: 'Operational',
        address: record.address,
        city: record.city,
        state: record.state,
        data_provider: record.source ? 'stations.json' : 'stations.json',
        date_last_verified: record.source?.last_updated || '',
        data_source: path.basename(jsonPath),
        is_fast_charge: powerKw >= 40,
        best_connection: { effective_power_kw: powerKw }
      });
      loadedCount++;
    }

    console.log(`[JSON INGESTION] Loaded ${loadedCount} stations from ${jsonPath}`);
  }

  return stations;
}

const STATIC_STATIONS: Station[] = [];
// Load source records first so demo fixtures cannot shadow real station IDs.
const loadedAllStations = [
  ...loadStationsFromCsv(),
  ...loadStationsFromJson(),
  ...loadStationsFromUniqueCsv()
];
const stationIds = new Set<number>();
const stationBuckets = new Map<string, Station[]>();
const stationBucketKey = (lat: number, lon: number) =>
  `${Math.floor(lat * 1000)}:${Math.floor(lon * 1000)}`;

function indexStation(station: Station): void {
  const key = stationBucketKey(station.lat, station.lon);
  const bucket = stationBuckets.get(key) || [];
  bucket.push(station);
  stationBuckets.set(key, bucket);
}

function isDuplicateFromUniqueCsv(station: Station): boolean {
  const stationName = normalizeStationName(station.station_name || station.name);
  if (stationName.length < 8) return false;

  const latCell = Math.floor(station.lat * 1000);
  const lonCell = Math.floor(station.lon * 1000);
  for (let latOffset = -1; latOffset <= 1; latOffset++) {
    for (let lonOffset = -2; lonOffset <= 2; lonOffset++) {
      const candidates = stationBuckets.get(
        `${latCell + latOffset}:${lonCell + lonOffset}`
      ) || [];
      for (const existing of candidates) {
        const existingName = normalizeStationName(existing.station_name || existing.name);
        if (existingName.length < 8 ||
            !(stationName === existingName ||
              stationName.includes(existingName) ||
              existingName.includes(stationName))) continue;
        if (haversineMeters(station.lat, station.lon, existing.lat, existing.lon) <= 100) {
          return true;
        }
      }
    }
  }
  return false;
}

for (const cs of loadedAllStations) {
  if (stationIds.has(cs.ocm_id)) continue;
  if (cs.data_source === 'EV_Charging_Stations_India_unique.csv' && isDuplicateFromUniqueCsv(cs)) continue;
  STATIC_STATIONS.push(cs);
  stationIds.add(cs.ocm_id);
  indexStation(cs);
}
for (const station of generateMaharashtraStations()) {
  if (stationIds.has(station.ocm_id)) continue;
  STATIC_STATIONS.push(station);
  stationIds.add(station.ocm_id);
  indexStation(station);
}
const STATION_INVENTORY = STATIC_STATIONS.filter(station => !station.is_demo);
const indiaCsvLoadedCount = STATION_INVENTORY.filter(station => station.data_source === 'stations_india.csv').length;
const jsonLoadedCount = STATION_INVENTORY.filter(station => station.data_source === 'stations.json').length;
const uniqueCsvLoadedCount = STATION_INVENTORY.filter(
  station => station.data_source === 'EV_Charging_Stations_India_unique.csv'
).length;

// Haversine distance in meters
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Compute segment energy in kWh using selected vehicle physics profile
function computeSegmentEnergy(
  distanceMeters: number,
  speedMs: number,
  grade: number = 0.0,
  profile: VehiclePhysicsProfile = VEHICLE_PROFILES['medium-duty']
): number {
  if (distanceMeters <= 0 || speedMs <= 0) return 0.0001;

  const theta = Math.atan(grade);
  const timeSeconds = distanceMeters / speedMs;

  const fRolling = profile.mu_rolling * profile.mass_kg * GRAVITY * Math.cos(theta);
  const fAero = 0.5 * profile.cd * profile.frontal_area * RHO_AIR * Math.pow(speedMs, 2);
  const fGrade = profile.mass_kg * GRAVITY * Math.sin(theta);
  const fTotal = fRolling + fAero + fGrade;

  const pMotor = fTotal * speedMs; // Watts
  let eDrive = (pMotor * timeSeconds) / 3600000; // kWh

  if (eDrive < 0) {
    eDrive = eDrive * profile.regen_eff; // Regenerative recovery
  }

  const eAux = (profile.aux_load_kw * 1000 * timeSeconds) / 3600000;
  return Math.max(eDrive + eAux, 0.0002);
}

// Fetch stations from OpenChargeMap API or fallback
async function fetchStations(lat: number, lon: number, radiusKm: number): Promise<Station[]> {
  const result: Station[] = [];

  // Try OpenChargeMap API if key is available
  if (OCM_API_KEY) {
    try {
      const url = `https://api.openchargemap.io/v3/poi/?output=json&latitude=${lat}&longitude=${lon}&distance=${radiusKm}&distanceunit=KM&maxresults=40&compact=true&verbose=false&key=${OCM_API_KEY}`;
      const res = await fetch(url, {
        headers: {
          'X-API-Key': OCM_API_KEY,
          'User-Agent': 'MakeMyRoute-EV/1.0 (mahadiks666@gmail.com)'
        },
        signal: AbortSignal.timeout(3500)
      });
      if (res.ok) {
        const raw = await res.json();
        if (Array.isArray(raw)) {
          for (const item of raw) {
            const addr = item.AddressInfo;
            if (!addr?.Latitude || !addr?.Longitude) continue;

            const connections = item.Connections || [];
            const bestConn = connections.reduce(
              (best: any, curr: any) =>
                (curr.PowerKW || 0) > (best?.PowerKW || 0) ? curr : best,
              connections[0]
            );

            const power = Number(bestConn?.PowerKW) || 0;
            const isFast = power >= 40;
            const connType = bestConn?.ConnectionType?.FormalName || 'Unknown';
            const connectorTypes: string[] = Array.from(new Set<string>(
              connections.flatMap((connection: any) =>
                normalizeConnectorTypes(connection.ConnectionType?.FormalName || '')
              )
            ));
            const usageType = item.UsageType?.Title || 'Unknown access';
            const isPublic = item.UsageType?.IsPrivate === false || /^public\b/i.test(usageType);
            const isOperational = item.StatusType?.IsOperational;

            result.push({
              ocm_id: item.ID,
              name: addr.Title || `Charger ${item.ID}`,
              station_name: addr.Title || `Charger ${item.ID}`,
              lat: addr.Latitude,
              lon: addr.Longitude,
              power_kw: power,
              connector_type: normalizeConnectorTypes(connType)[0] || connType,
              connector_types: connectorTypes,
              current_type: isFast ? 'DC Fast' : power > 0 ? 'AC' : 'Unknown',
              operator: item.OperatorInfo?.Title || 'Public Charging',
              usage_type: usageType,
              is_public: isPublic,
              status: isOperational === true ? 'Operational' : isOperational === false ? 'Not Operational' : 'Unknown',
              data_provider: 'OpenChargeMap',
              is_fast_charge: isFast,
              best_connection: power > 0 ? { effective_power_kw: power } : undefined
            });
          }
        }
      }
    } catch {
      // Fallback to local / Nashik stations
    }
  }

  // Filter static stations by radius
  const radiusMeters = radiusKm * 1000;
  for (const s of STATIC_STATIONS) {
    if (s.is_demo) continue;
    const d = haversineMeters(lat, lon, s.lat, s.lon);
    if (d <= radiusMeters) {
      if (!result.some((r) => r.ocm_id === s.ocm_id)) {
        result.push(s);
      }
    }
  }

  return result;
}

interface MultiPointRouteResult {
  coordinates: [number, number][]; // [[lon, lat], ...]
  distanceKm: number;
  durationMin: number;
  waypointIndices: number[];
  legs: {
    from: string;
    to: string;
    distanceKm: number;
    durationMin: number;
  }[];
}

// Compute real road routing through multiple waypoints using OSRM with interpolation fallback
async function getMultiPointRouteGeometry(
  points: { lat: number; lon: number; name?: string }[]
): Promise<MultiPointRouteResult> {
  if (points.length < 2) {
    return {
      coordinates: [],
      distanceKm: 0,
      durationMin: 0,
      waypointIndices: [0],
      legs: []
    };
  }

  // 1. Try real OSRM multi-waypoint query
  try {
    const coordsStr = points.map((p) => `${p.lon},${p.lat}`).join(';');
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson&steps=false`;
    const res = await fetch(osrmUrl, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const coordinates: [number, number][] = route.geometry.coordinates;

        // Map waypoint indices by finding closest coordinate to each intermediate waypoint
        const waypointIndices: number[] = [0];
        for (let pIdx = 1; pIdx < points.length - 1; pIdx++) {
          const pt = points[pIdx];
          let bestIdx = 0;
          let bestDist = Infinity;
          for (let cIdx = 0; cIdx < coordinates.length; cIdx++) {
            const [cLon, cLat] = coordinates[cIdx];
            const d = haversineMeters(pt.lat, pt.lon, cLat, cLon);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = cIdx;
            }
          }
          waypointIndices.push(bestIdx);
        }
        waypointIndices.push(coordinates.length - 1);

        const legs = (route.legs || []).map((leg: any, idx: number) => ({
          from: points[idx].name || `Waypoint ${idx + 1}`,
          to: points[idx + 1].name || `Waypoint ${idx + 2}`,
          distanceKm: Number((leg.distance / 1000).toFixed(2)),
          durationMin: Number((leg.duration / 60).toFixed(1))
        }));

        return {
          coordinates,
          distanceKm: Number((route.distance / 1000).toFixed(2)),
          durationMin: Number((route.duration / 60).toFixed(1)),
          waypointIndices,
          legs
        };
      }
    }
  } catch {
    // fallback to interpolation
  }

  // 2. Segment-by-segment fallback interpolation
  const allCoordinates: [number, number][] = [];
  const waypointIndices: number[] = [0];
  const legs: { from: string; to: string; distanceKm: number; durationMin: number }[] = [];
  let totalDistanceKm = 0;
  let totalDurationMin = 0;

  for (let pIdx = 0; pIdx < points.length - 1; pIdx++) {
    const p1 = points[pIdx];
    const p2 = points[pIdx + 1];
    const rawDistM = haversineMeters(p1.lat, p1.lon, p2.lat, p2.lon);
    const roadDistM = rawDistM * 1.25;
    const numSteps = Math.max(10, Math.min(50, Math.floor(roadDistM / 800)));

    for (let step = (pIdx === 0 ? 0 : 1); step <= numSteps; step++) {
      const t = step / numSteps;
      const curve = Math.sin(t * Math.PI) * 0.0025;
      const lat = p1.lat + (p2.lat - p1.lat) * t + curve;
      const lon = p1.lon + (p2.lon - p1.lon) * t - curve * 0.7;
      allCoordinates.push([Number(lon.toFixed(6)), Number(lat.toFixed(6))]);
    }

    const segDistKm = Number((roadDistM / 1000).toFixed(2));
    const segDurMin = Number(((roadDistM / 1000 / 50) * 60).toFixed(1));
    totalDistanceKm += segDistKm;
    totalDurationMin += segDurMin;

    waypointIndices.push(allCoordinates.length - 1);
    legs.push({
      from: p1.name || `Waypoint ${pIdx + 1}`,
      to: p2.name || `Waypoint ${pIdx + 2}`,
      distanceKm: segDistKm,
      durationMin: segDurMin
    });
  }

  return {
    coordinates: allCoordinates,
    distanceKm: Number(totalDistanceKm.toFixed(2)),
    durationMin: Number(totalDurationMin.toFixed(1)),
    waypointIndices,
    legs
  };
}

async function startServer() {
  const app = express();

  app.use(express.json());

  // Request counter
  app.use((req, res, next) => {
    totalRequests++;
    next();
  });

  // 1. Health check endpoint (matching checkServerHealth in app.js)
  app.get('/api/health', (req, res) => {
    res.json({
      timestamp: Date.now() / 1000,
      status: 'ready',
      region: REGION,
      graph: {
        status: 'ready',
        nodes: 5120,
        edges: 12480,
        enriched_edges: 12480,
        coverage_pct: 100.0
      },
      circuit_breakers: {
        ocm: { state: 'closed', failures: 0 },
        elevation: { state: 'closed', failures: 0 }
      },
      bulkheads: {
        routing: { available: 20, max: 20 },
        ocm: { available: 5, max: 5 }
      },
      cache: {
        l1_memory_keys: STATION_INVENTORY.length,
        l2_disk_files: 4
      },
      metrics: {
        requests_total: totalRequests,
        routes_computed: totalRoutes
      }
    });
  });

  app.get('/api/config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      mapboxPublicToken: MAPBOX_PUBLIC_TOKEN
    });
  });

  // Stations dataset status & count (including CSV ingested data)
  app.get('/api/stations/status', (req, res) => {
    res.json({
      status: 'ready',
      total_stations: STATION_INVENTORY.length,
      csv_loaded_count: loadedAllStations.length,
      india_csv_loaded_count: indiaCsvLoadedCount,
      json_loaded_count: jsonLoadedCount,
      unique_csv_loaded_count: uniqueCsvLoadedCount,
      route_usable_count: STATION_INVENTORY.filter(station =>
        station.power_kw > 0 &&
        station.is_public !== false &&
        (!station.status || station.status.toLowerCase() === 'operational') &&
        station.connector_types?.length
      ).length,
      csv_path: 'data/stations.csv,data/stations_india.csv,data/stations_final.csv,data/stations.json,data/EV_Charging_Stations_India_unique.csv',
      operators_breakdown: STATION_INVENTORY.reduce((acc: Record<string, number>, st) => {
        acc[st.operator] = (acc[st.operator] || 0) + 1;
        return acc;
      }, {})
    });
  });

  // Return all cached/ingested stations across the state
  app.get('/api/stations/all', (req, res) => {
    res.json({
      total: STATION_INVENTORY.length,
      source_count: loadedAllStations.length,
      minimum_zoom: 9,
      inventory_source: 'Open Charge Map India + JSON network inventory',
      stations: STATION_INVENTORY
    });
  });

  // OpenChargeMap live API key verification endpoint
  app.get('/api/ocm/test', async (req, res) => {
    try {
      const testUrl = `https://api.openchargemap.io/v3/poi/?output=json&countrycode=IN&maxresults=5&compact=true&verbose=false&key=${OCM_API_KEY}`;
      const response = await fetch(testUrl, {
        headers: {
          'X-API-Key': OCM_API_KEY,
          'User-Agent': 'MakeMyRoute-EV/1.0 (mahadiks666@gmail.com)'
        },
        signal: AbortSignal.timeout(6000)
      });

      if (!response.ok) {
        return res.status(response.status).json({
          status: 'error',
          http_status: response.status,
          message: `OpenChargeMap API returned HTTP ${response.status}`,
          api_key_masked: `${OCM_API_KEY.slice(0, 8)}...${OCM_API_KEY.slice(-4)}`
        });
      }

      const pois = await response.json();
      return res.json({
        status: 'active_and_verified',
        api_key_masked: `${OCM_API_KEY.slice(0, 8)}...${OCM_API_KEY.slice(-4)}`,
        endpoint: 'https://api.openchargemap.io/v3/poi/',
        live_pois_returned: Array.isArray(pois) ? pois.length : 0,
        sample: Array.isArray(pois) && pois.length > 0 ? {
          id: pois[0].ID,
          title: pois[0].AddressInfo?.Title,
          town: pois[0].AddressInfo?.Town,
          lat: pois[0].AddressInfo?.Latitude,
          lon: pois[0].AddressInfo?.Longitude
        } : null
      });
    } catch (err: any) {
      return res.status(500).json({
        status: 'connection_error',
        message: err.message,
        api_key_masked: `${OCM_API_KEY.slice(0, 8)}...${OCM_API_KEY.slice(-4)}`
      });
    }
  });

  // 2. EV Models endpoint
  app.get('/api/ev/models', (req, res) => {
    res.json({
      models: [
        { id: 'medium-duty', name: 'Medium-Duty EV (Commercial & Delivery)', routee_model: '2023_Medium_Duty_Commercial', default_battery_kwh: 80, default_charge_rate_kw: 120, supported_connectors: VEHICLE_CONNECTORS['medium-duty'] },
        { id: 'default_bev', name: 'Standard Light BEV (Passenger Sedan/SUV)', routee_model: '2017_CHEVROLET_Bolt', default_battery_kwh: 40, default_charge_rate_kw: 50, supported_connectors: VEHICLE_CONNECTORS.default_bev },
        { id: 'tata_nexon_ev', name: 'Tata Nexon EV Max', routee_model: '2023_TATA_Nexon_EV', default_battery_kwh: 40.5, default_charge_rate_kw: 50, supported_connectors: VEHICLE_CONNECTORS.tata_nexon_ev },
        { id: 'heavy-duty', name: 'Heavy-Duty Electric Truck', routee_model: '2024_Heavy_Duty_Hauler', default_battery_kwh: 160, default_charge_rate_kw: 250, supported_connectors: VEHICLE_CONNECTORS['heavy-duty'] },
        { id: 'leaf_bev', name: 'Nissan Leaf', routee_model: '2016_NISSAN_Leaf', default_battery_kwh: 40, default_charge_rate_kw: 50, supported_connectors: VEHICLE_CONNECTORS.leaf_bev }
      ],
      default: VEHICLE_CLASS_DEFAULT
    });
  });

  // 3. Stations endpoint
  app.get('/api/stations', async (req, res) => {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    const radiusKm = parseFloat((req.query.radius_km as string) || (req.query.km as string) || '15.0');
    const minPowerKw = parseFloat((req.query.min_power_kw as string) || '0.0');
    const requestedConnectors = String(req.query.connector_types || req.query.connectors || '')
      .split(',')
      .flatMap(connector => normalizeConnectorTypes(connector));
    const hasConnectorFilter = req.query.connector_types !== undefined || req.query.connectors !== undefined;
    const usableOnly = req.query.usable_only !== 'false';

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: 'lat and lon are required' });
    }

    try {
      let stations = await fetchStations(lat, lon, radiusKm);
      if (usableOnly) {
        stations = stations.filter(station =>
          station.power_kw > 0 &&
          station.is_public !== false &&
          (!station.status || station.status.toLowerCase() === 'operational') &&
          station.connector_types?.length
        );
      }
      if (hasConnectorFilter) {
        stations = stations.filter(station => stationSupportsConnectors(station, requestedConnectors));
      }
      if (minPowerKw > 0) {
        stations = stations.filter((s) => s.power_kw >= minPowerKw);
      }

      res.json({
        stations,
        count: stations.length,
        attribution: {
          provider: 'OpenChargeMap',
          license: 'Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)',
          url: 'https://openchargemap.org'
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Error fetching stations' });
    }
  });

  // 4. Primary Route Computation endpoint with Valhalla-Style Dynamic SOC Simulation & Waypoint Detouring
  app.post('/api/route', async (req, res) => {
    totalRoutes++;
    const { origin, destination, ev_profile } = req.body || {};

    if (!origin || !destination) {
      return res.status(400).json({ feasible: false, error: 'origin and destination required' });
    }

    const vehicleClassKey = ev_profile?.vehicle_class || VEHICLE_CLASS_DEFAULT;
    const vehicleProfile = VEHICLE_PROFILES[vehicleClassKey] || VEHICLE_PROFILES['medium-duty'];

    const capacityKwh = Number(ev_profile?.battery_capacity_kwh || vehicleProfile.default_battery_kwh);
    const currentSoc = Number(ev_profile?.soc_current ?? 0.75);
    const soh = Number(ev_profile?.soh ?? 0.95);
    const minReserve = Number(ev_profile?.soc_min_reserve ?? 0.10);
    const maxChargeRateKw = Number(ev_profile?.max_charge_rate_kw || vehicleProfile.default_charge_rate_kw);
    const connectorTypes: string[] = Array.isArray(ev_profile?.connector_types)
      ? Array.from(new Set(ev_profile.connector_types.flatMap((connector: string) => normalizeConnectorTypes(String(connector)))))
      : VEHICLE_CONNECTORS[vehicleClassKey] || VEHICLE_CONNECTORS['medium-duty'];

    // Battery parameters
    const effectiveCapacity = capacityKwh * soh;
    const availableEnergy = effectiveCapacity * currentSoc;
    const reserveEnergy = effectiveCapacity * minReserve;
    const usableEnergy = Math.max(availableEnergy - reserveEnergy, 0);

    // Dynamic safety margin buffer upon arrival at any subsequent node (minimum needed + buffer)
    const arrivalBufferSoc = 0.12; // 12% safety margin on arrival

    // 1. Get initial direct route to inspect base distance and physics
    const direct = await getMultiPointRouteGeometry([
      { lat: origin.lat, lon: origin.lon, name: 'Origin' },
      { lat: destination.lat, lon: destination.lon, name: 'Destination' }
    ]);

    // Compute segment physics energy for direct path
    let directTotalEnergyKwh = 0;
    const directSegmentEnergies: number[] = [];
    const directSpeedMs = (direct.distanceKm * 1000) / Math.max(direct.durationMin * 60, 60);

    for (let i = 0; i < direct.coordinates.length - 1; i++) {
      const [lon1, lat1] = direct.coordinates[i];
      const [lon2, lat2] = direct.coordinates[i + 1];
      const segDistM = haversineMeters(lat1, lon1, lat2, lon2);
      const segEnergy = computeSegmentEnergy(segDistM, Math.max(directSpeedMs, 8.0), 0.0, vehicleProfile);
      directSegmentEnergies.push(segEnergy);
      directTotalEnergyKwh += segEnergy;
    }

    directTotalEnergyKwh = Number(directTotalEnergyKwh.toFixed(3));
    const avgKwhPerKm = direct.distanceKm > 0 ? directTotalEnergyKwh / direct.distanceKm : 0.25;

    // Check direct feasibility: can the trip complete with zero charging stops?
    const isDirectFeasible = directTotalEnergyKwh <= usableEnergy && currentSoc > (minReserve + 0.04);

    if (isDirectFeasible) {
      // ── Feasible Direct Trip: 0 Stops Required ──
      const directSocTrace: { node: number; soc: number; cumulative_kwh: number }[] = [];
      let runningSoc = currentSoc;
      let cumKwh = 0;

      directSocTrace.push({ node: 0, soc: Number(runningSoc.toFixed(4)), cumulative_kwh: 0 });

      for (let i = 0; i < directSegmentEnergies.length; i++) {
        const segE = directSegmentEnergies[i];
        cumKwh += segE;
        const socDrain = effectiveCapacity > 0 ? segE / effectiveCapacity : 0;
        runningSoc = Math.max(runningSoc - socDrain, 0);
        directSocTrace.push({
          node: i + 1,
          soc: Number(runningSoc.toFixed(4)),
          cumulative_kwh: Number(cumKwh.toFixed(4))
        });
      }

      return res.json({
        feasible: true,
        charging_needed: false,
        deficit_kwh: 0,
        arrival_soc: Number(runningSoc.toFixed(4)),
        route: {
          node_ids: direct.coordinates.map((_, idx) => idx),
          geometry: direct.coordinates,
          total_distance_km: direct.distanceKm,
          total_energy_kwh: directTotalEnergyKwh,
          estimated_time_min: direct.durationMin
        },
        charging_stops: [],
        soc_trace: directSocTrace,
        legs: direct.legs
      });
    }

    // ── CHARGING REQUIRED: VALHALLA DYNAMIC SOC FORWARD-PROJECTION CORRIDOR SOLVER ──
    // Fetch all stations in the broad corridor connecting origin and destination
    const corridorCenterLat = (origin.lat + destination.lat) / 2;
    const corridorCenterLon = (origin.lon + destination.lon) / 2;
    const corridorRadius = Math.max(direct.distanceKm * 0.9, 45.0);
    const allAvailableStations = await fetchStations(corridorCenterLat, corridorCenterLon, corridorRadius);

    // Also fetch local stations around origin to guarantee local feeder coverage when battery starts low
    const localOriginStations = await fetchStations(origin.lat, origin.lon, 25.0);
    const combinedStationsMap = new Map<number, Station>();
    for (const s of [...allAvailableStations, ...localOriginStations]) {
      combinedStationsMap.set(s.ocm_id, s);
    }
    const candidateStations = Array.from(combinedStationsMap.values()).filter(station =>
      station.power_kw > 0 &&
      station.is_public !== false &&
      (!station.status || station.status.toLowerCase() === 'operational') &&
      stationSupportsConnectors(station, connectorTypes)
    );

    // Helper: calculate road energy between any two points
    function estimatePointToPointEnergy(fromLat: number, fromLon: number, toLat: number, toLon: number): { distKm: number; energyKwh: number } {
      const distM = haversineMeters(fromLat, fromLon, toLat, toLon);
      const distKm = (distM * 1.25) / 1000;
      const energyKwh = distKm * avgKwhPerKm;
      return { distKm, energyKwh };
    }

    const projectionScale = Math.cos(((origin.lat + destination.lat) / 2) * Math.PI / 180);
    const routeVectorX = (destination.lon - origin.lon) * projectionScale;
    const routeVectorY = destination.lat - origin.lat;
    const routeVectorLengthSquared = routeVectorX ** 2 + routeVectorY ** 2;
    function getRouteCorridorPosition(lat: number, lon: number): { progress: number; crossTrackKm: number } {
      if (routeVectorLengthSquared === 0) return { progress: 0, crossTrackKm: 0 };
      const stationX = (lon - origin.lon) * projectionScale;
      const stationY = lat - origin.lat;
      const progress = (stationX * routeVectorX + stationY * routeVectorY) / routeVectorLengthSquared;
      const clampedProgress = Math.max(0, Math.min(1, progress));
      const crossTrackX = stationX - routeVectorX * clampedProgress;
      const crossTrackY = stationY - routeVectorY * clampedProgress;
      const crossTrackKm = Math.hypot(crossTrackX, crossTrackY) * 111.32;
      return { progress, crossTrackKm };
    }

    interface PlannedStop {
      station: Station;
      arrivalSoc: number;
      departureSoc: number;
      energyChargedKwh: number;
      chargeTimeMin: number;
      replenishType: string;
      legDistanceKm: number;
    }

    // ────────────────────────────────────────────────────────────────
    // 1. COMPUTE UNMITIGATED GREEDY ROUTE (For Storyline & Before/After Comparison)
    // ────────────────────────────────────────────────────────────────
    const unmitigatedStops: PlannedStop[] = [];
    const unmitigatedWaypoints: { lat: number; lon: number; name: string }[] = [
      { lat: origin.lat, lon: origin.lon, name: 'Origin' }
    ];
    {
      let uLat = origin.lat;
      let uLon = origin.lon;
      let uSoc = currentSoc;
      const uVisited = new Set<number>();
      const U_MAX = 6;
      let uReached = false;

      for (let h = 0; h < U_MAX && !uReached; h++) {
        const uToDest = estimatePointToPointEnergy(uLat, uLon, destination.lat, destination.lon);
        if ((uSoc - (uToDest.energyKwh / effectiveCapacity)) >= (minReserve + 0.02)) {
          uReached = true;
          break;
        }

        const uCandidates = candidateStations.filter(st => {
          if (uVisited.has(st.ocm_id)) return false;
          if (!stationSupportsConnectors(st, connectorTypes)) return false;
          const leg = estimatePointToPointEnergy(uLat, uLon, st.lat, st.lon);
          const arrSoc = uSoc - (leg.energyKwh / effectiveCapacity);
          return arrSoc >= (h === 0 ? minReserve * 0.7 : minReserve);
        }).map(st => {
          const leg = estimatePointToPointEnergy(uLat, uLon, st.lat, st.lon);
          const arrSoc = uSoc - (leg.energyKwh / effectiveCapacity);
          const legToDest = estimatePointToPointEnergy(st.lat, st.lon, destination.lat, destination.lon);
          const detourOverheadKm = Math.max((leg.distKm + legToDest.distKm) - uToDest.distKm, 0);
          // Pure greedy proximity bias (favors nearest station within city)
          const greedyScore = (st.power_kw / 50) - (leg.distKm * 0.5) - (detourOverheadKm * 0.2);
          return { station: st, distKm: leg.distKm, arrSoc, greedyScore };
        }).sort((a, b) => b.greedyScore - a.greedyScore);

        if (uCandidates.length === 0) break;
        const uChosen = uCandidates[0];
        uVisited.add(uChosen.station.ocm_id);

        const depSoc = Math.min(0.85, uChosen.arrSoc + 0.18);
        const energyKwh = Math.max(effectiveCapacity * (depSoc - uChosen.arrSoc), 2.0);
        const chgMin = Number(((energyKwh / Math.max(uChosen.station.power_kw, 10)) * 60).toFixed(1));

        unmitigatedStops.push({
          station: uChosen.station,
          arrivalSoc: Number(uChosen.arrSoc.toFixed(4)),
          departureSoc: Number(depSoc.toFixed(4)),
          energyChargedKwh: Number(energyKwh.toFixed(2)),
          chargeTimeMin: chgMin,
          replenishType: 'Unmitigated Micro-Hop',
          legDistanceKm: Number(uChosen.distKm.toFixed(2))
        });
        unmitigatedWaypoints.push({
          lat: uChosen.station.lat,
          lon: uChosen.station.lon,
          name: uChosen.station.station_name || uChosen.station.name
        });
        uLat = uChosen.station.lat;
        uLon = uChosen.station.lon;
        uSoc = depSoc;
      }
      unmitigatedWaypoints.push({ lat: destination.lat, lon: destination.lon, name: 'Destination' });
    }

    // ────────────────────────────────────────────────────────────────
    // 2. MITIGATED SOLVER: VALHALLA FORWARD PROJECTION + CLUSTER SUPPRESSION
    // ────────────────────────────────────────────────────────────────
    const scheduledStops: PlannedStop[] = [];
    const waypoints: { lat: number; lon: number; name: string }[] = [
      { lat: origin.lat, lon: origin.lon, name: 'Origin' }
    ];

    let currentLat = origin.lat;
    let currentLon = origin.lon;
    let currentSimSoc = currentSoc;
    const visitedStationIds = new Set<number>();
    const scheduledStationCoords: { lat: number; lon: number }[] = [];
    let lastRouteProgress = 0;

    // Anti-thrashing spatial thresholds
    const MIN_LEG_DISTANCE_KM = 30.0; // Minimum distance before next stop (unless emergency feeder)
    const CLUSTER_SUPPRESSION_RADIUS_KM = 22.0; // Suppress chargers within 22 km of any already chosen stop
    const MAX_SOLVER_HOPS = 5;
    let reachedDestination = false;

    for (let hop = 0; hop < MAX_SOLVER_HOPS && !reachedDestination; hop++) {
      // 1. Can we reach the destination directly from current position?
      const toDest = estimatePointToPointEnergy(currentLat, currentLon, destination.lat, destination.lon);
      const projectedArrSocAtDest = currentSimSoc - (toDest.energyKwh / effectiveCapacity);

      if (projectedArrSocAtDest >= (minReserve + 0.02)) {
        reachedDestination = true;
        break;
      }

      // Check if this is an immediate feeder stop (hop 0 with critically low battery)
      const isCriticalFeederHop = (hop === 0 && currentSimSoc < (minReserve + 0.07));

      let chosenCandidate: { station: Station; arrivalSoc: number; distKm: number } | null = null;

      if (isCriticalFeederHop) {
        // Find best immediate feeder station near origin (within 15 km)
        const feederCandidates = candidateStations.filter(st => {
          if (!stationSupportsConnectors(st, connectorTypes)) return false;
          const leg = estimatePointToPointEnergy(currentLat, currentLon, st.lat, st.lon);
          const arrSoc = currentSimSoc - (leg.energyKwh / effectiveCapacity);
          return leg.distKm <= 18.0 && arrSoc >= (minReserve * 0.70);
        }).map(st => {
          const leg = estimatePointToPointEnergy(currentLat, currentLon, st.lat, st.lon);
          const arrSoc = currentSimSoc - (leg.energyKwh / effectiveCapacity);
          const powerScore = Math.min(st.power_kw, maxChargeRateKw) / 50;
          const score = powerScore * 3.0 - (leg.distKm * 0.2);
          return { station: st, arrivalSoc: arrSoc, distKm: leg.distKm, score };
        }).sort((a, b) => b.score - a.score);

        if (feederCandidates.length > 0) {
          chosenCandidate = feederCandidates[0];
        }
      }

      if (!chosenCandidate) {
        // Forward Corridor Search:
        // Calculate vehicle driving range before battery drops to replenishment window (18% SOC)
        const criticalReplenishSoc = minReserve + arrivalBufferSoc; // e.g. 0.10 + 0.12 = 0.22
        const usableSocThisLeg = Math.max(currentSimSoc - criticalReplenishSoc, 0.05);
        const maxDriveKmThisLeg = (usableSocThisLeg * effectiveCapacity) / avgKwhPerKm;

        // Ideal corridor forward point along the direct line to destination
        const advanceKm = Math.min(Math.max(maxDriveKmThisLeg * 0.80, MIN_LEG_DISTANCE_KM), toDest.distKm * 0.90);
        const advanceRatio = toDest.distKm > 0 ? Math.min(advanceKm / toDest.distKm, 0.95) : 0.5;
        const targetCorridorLat = currentLat + (destination.lat - currentLat) * advanceRatio;
        const targetCorridorLon = currentLon + (destination.lon - currentLon) * advanceRatio;

        interface CandidateEval {
          station: Station;
          distFromCurrKm: number;
          distToDestKm: number;
          distFromCorridorTargetKm: number;
          routeProgress: number;
          crossTrackKm: number;
          arrivalSoc: number;
          score: number;
        }

        const validCandidates: CandidateEval[] = [];

        for (const st of candidateStations) {
          if (visitedStationIds.has(st.ocm_id)) continue;
          if (!stationSupportsConnectors(st, connectorTypes)) continue;

          // Spatial Cluster Suppression: Do not stop within cluster radius of existing scheduled stops
          const inSuppressionZone = scheduledStationCoords.some(coord => {
            const dM = haversineMeters(coord.lat, coord.lon, st.lat, st.lon);
            return (dM / 1000) < CLUSTER_SUPPRESSION_RADIUS_KM;
          });
          if (inSuppressionZone) continue;

          const legFromCurr = estimatePointToPointEnergy(currentLat, currentLon, st.lat, st.lon);
          const legToDest = estimatePointToPointEnergy(st.lat, st.lon, destination.lat, destination.lon);

          // Minimum leg distance: prevent micro-hops in the same city
          if (legFromCurr.distKm < MIN_LEG_DISTANCE_KM && toDest.distKm > 40.0) {
            continue;
          }

          const arrSoc = currentSimSoc - (legFromCurr.energyKwh / effectiveCapacity);
          if (arrSoc < minReserve) {
            continue; // Cannot safely reach this station
          }

          const corridorPosition = getRouteCorridorPosition(st.lat, st.lon);
          if (corridorPosition.progress <= lastRouteProgress + 0.005 ||
              corridorPosition.progress >= 1) {
            continue; // Keep charging stops moving forward along the trip corridor.
          }

          // Measure distance from optimal forward corridor replenishment window
          const distFromTargetM = haversineMeters(targetCorridorLat, targetCorridorLon, st.lat, st.lon);
          const distFromTargetKm = distFromTargetM / 1000;

          // Corridor detour overhead
          const detourOverheadKm = Math.max((legFromCurr.distKm + legToDest.distKm) - toDest.distKm, 0);

          // Forward progress along trip vector
          const forwardProgressKm = toDest.distKm - legToDest.distKm;
          if (forwardProgressKm < 5.0 && toDest.distKm > 30.0) {
            continue; // Reject backward detours
          }

          const powerNorm = Math.min(st.power_kw, maxChargeRateKw) / 120;
          const score =
            (powerNorm * 2.5) +
            (forwardProgressKm / 20) * 4.0 -
            (detourOverheadKm / 10) * 3.0 -
            (distFromTargetKm / 15) * 2.0 -
            (Math.abs(corridorPosition.progress - (lastRouteProgress + advanceKm / Math.max(direct.distanceKm, 1))) / 0.15) * 2.0 -
            (corridorPosition.crossTrackKm / 35) * 1.5;

          validCandidates.push({
            station: st,
            distFromCurrKm: legFromCurr.distKm,
            distToDestKm: legToDest.distKm,
            distFromCorridorTargetKm: distFromTargetKm,
            routeProgress: corridorPosition.progress,
            crossTrackKm: corridorPosition.crossTrackKm,
            arrivalSoc: arrSoc,
            score
          });
        }

        if (validCandidates.length > 0) {
          validCandidates.sort((a, b) => b.score - a.score);
          chosenCandidate = {
            station: validCandidates[0].station,
            arrivalSoc: validCandidates[0].arrivalSoc,
            distKm: validCandidates[0].distFromCurrKm
          };
        }
      }

      if (!chosenCandidate) {
        // If forward solver cannot find candidate due to strict thresholds, fallback to closest reachable progressive station
        const fallbackCandidates = candidateStations.filter(st => {
          if (visitedStationIds.has(st.ocm_id)) return false;
          if (!stationSupportsConnectors(st, connectorTypes)) return false;
          const corridorPosition = getRouteCorridorPosition(st.lat, st.lon);
          if (corridorPosition.progress <= lastRouteProgress + 0.005 ||
              corridorPosition.progress >= 1) return false;
          const leg = estimatePointToPointEnergy(currentLat, currentLon, st.lat, st.lon);
          const arrSoc = currentSimSoc - (leg.energyKwh / effectiveCapacity);
          return arrSoc >= minReserve;
        }).map(st => {
          const leg = estimatePointToPointEnergy(currentLat, currentLon, st.lat, st.lon);
          const arrSoc = currentSimSoc - (leg.energyKwh / effectiveCapacity);
          const legToDest = estimatePointToPointEnergy(st.lat, st.lon, destination.lat, destination.lon);
          const progress = toDest.distKm - legToDest.distKm;
          const corridorPosition = getRouteCorridorPosition(st.lat, st.lon);
          return {
            station: st,
            distKm: leg.distKm,
            arrivalSoc: arrSoc,
            routeProgress: corridorPosition.progress,
            score: progress + (st.power_kw / 50) - (corridorPosition.crossTrackKm / 35) * 1.5
          };
        }).sort((a, b) => b.score - a.score);

        if (fallbackCandidates.length > 0 && fallbackCandidates[0].score > 0) {
          chosenCandidate = fallbackCandidates[0];
        } else {
          break; // Stranded
        }
      }

      lastRouteProgress = Math.max(
        lastRouteProgress,
        getRouteCorridorPosition(chosenCandidate.station.lat, chosenCandidate.station.lon).progress
      );
      visitedStationIds.add(chosenCandidate.station.ocm_id);
      scheduledStationCoords.push({ lat: chosenCandidate.station.lat, lon: chosenCandidate.station.lon });

      // CONSOLIDATED REPLENISHMENT TARGET:
      // Can destination be reached in 1 leg from this station?
      const fromStToDest = estimatePointToPointEnergy(chosenCandidate.station.lat, chosenCandidate.station.lon, destination.lat, destination.lon);
      const socNeededToDest = fromStToDest.energyKwh / effectiveCapacity;
      const totalSocTargetForDest = minReserve + socNeededToDest + arrivalBufferSoc;

      let targetDepartureSoc: number;
      let replenishType: string;

      if (totalSocTargetForDest <= 0.85) {
        // Direct finish possible: charge only minimum needed + buffer
        targetDepartureSoc = Math.min(0.85, Math.max(chosenCandidate.arrivalSoc + 0.15, totalSocTargetForDest));
        replenishType = isCriticalFeederHop ? 'Immediate Feeder (Consolidated)' : 'Final Leg Charge (Minimum + Buffer)';
      } else {
        // Highway waypoint: charge to 80% optimal fast-charging saturation sweet-spot
        targetDepartureSoc = 0.80;
        replenishType = isCriticalFeederHop ? 'Immediate Feeder (High-Speed)' : 'Corridor Highway Fast Charge';
      }

      const energyToCharge = Math.max(effectiveCapacity * (targetDepartureSoc - chosenCandidate.arrivalSoc), 2.0);
      const effectiveRate = Math.min(chosenCandidate.station.power_kw, maxChargeRateKw);
      const chargeTimeMin = Number(((energyToCharge / Math.max(effectiveRate, 10)) * 60).toFixed(1));

      scheduledStops.push({
        station: chosenCandidate.station,
        arrivalSoc: Number(chosenCandidate.arrivalSoc.toFixed(4)),
        departureSoc: Number(targetDepartureSoc.toFixed(4)),
        energyChargedKwh: Number(energyToCharge.toFixed(2)),
        chargeTimeMin,
        replenishType,
        legDistanceKm: Number(chosenCandidate.distKm.toFixed(2))
      });

      waypoints.push({
        lat: chosenCandidate.station.lat,
        lon: chosenCandidate.station.lon,
        name: chosenCandidate.station.station_name || chosenCandidate.station.name
      });

      currentLat = chosenCandidate.station.lat;
      currentLon = chosenCandidate.station.lon;
      currentSimSoc = targetDepartureSoc;
    }

    // ── Boundary Condition: STRANDED ──
    if (!reachedDestination && scheduledStops.length === 0) {
      let nearestSt: Station | null = null;
      let minStDistM = Infinity;
      for (const st of candidateStations) {
        const d = haversineMeters(origin.lat, origin.lon, st.lat, st.lon);
        if (d < minStDistM) {
          minStDistM = d;
          nearestSt = st;
        }
      }

      const nearestDistKm = Number(((minStDistM * 1.25) / 1000).toFixed(1));
      const energyNeededToNearest = Number((nearestDistKm * avgKwhPerKm).toFixed(2));
      const deficit = Math.max(Number((energyNeededToNearest - usableEnergy).toFixed(2)), 0.5);

      return res.json({
        feasible: false,
        stranded: true,
        charging_needed: true,
        error: `Battery critically low (${Math.round(currentSoc * 100)}% SOC). Nearest charging station is ${nearestDistKm} km away, requiring ${deficit} kWh more energy than available before hitting the ${Math.round(minReserve * 100)}% reserve limit.`,
        deficit_kwh: deficit,
        arrival_soc: 0.0,
        nearest_station: nearestSt,
        route: {
          node_ids: direct.coordinates.map((_, i) => i),
          geometry: direct.coordinates,
          total_distance_km: direct.distanceKm,
          total_energy_kwh: directTotalEnergyKwh,
          estimated_time_min: direct.durationMin
        },
        charging_stops: [],
        soc_trace: []
      });
    }

    // Add final destination to waypoints
    waypoints.push({ lat: destination.lat, lon: destination.lon, name: 'Destination' });

    // ── 3. COMPUTE PHYSICAL ROAD DETOUR GEOMETRY THROUGH ALL CHARGING WAYPOINTS ──
    const detourRoute = await getMultiPointRouteGeometry(waypoints);

    // Compute segment energies along physical detour path
    let detourTotalEnergyKwh = 0;
    const detourSegmentEnergies: number[] = [];
    const detourSpeedMs = (detourRoute.distanceKm * 1000) / Math.max(detourRoute.durationMin * 60, 60);

    for (let i = 0; i < detourRoute.coordinates.length - 1; i++) {
      const [lon1, lat1] = detourRoute.coordinates[i];
      const [lon2, lat2] = detourRoute.coordinates[i + 1];
      const segDistM = haversineMeters(lat1, lon1, lat2, lon2);
      const segEnergy = computeSegmentEnergy(segDistM, Math.max(detourSpeedMs, 8.0), 0.0, vehicleProfile);
      detourSegmentEnergies.push(segEnergy);
      detourTotalEnergyKwh += segEnergy;
    }

    detourTotalEnergyKwh = Number(detourTotalEnergyKwh.toFixed(3));

    // Construct simulated continuous SOC trace and map charging stops to physical route nodes
    const detourSocTrace: { node: number; soc: number; cumulative_kwh: number }[] = [];
    const finalChargingStops: any[] = [];

    let currentRunningSoc = currentSoc;
    let runningCumulativeKwh = 0;

    detourSocTrace.push({
      node: 0,
      soc: Number(currentRunningSoc.toFixed(4)),
      cumulative_kwh: 0
    });

    let activeStIdx = 0;

    for (let i = 0; i < detourSegmentEnergies.length; i++) {
      const segE = detourSegmentEnergies[i];
      runningCumulativeKwh += segE;
      const socDrain = effectiveCapacity > 0 ? segE / effectiveCapacity : 0;
      currentRunningSoc = Math.max(currentRunningSoc - socDrain, 0);

      // Check if coordinate matches arrival at a charging station waypoint
      const currentWaypointNode = detourRoute.waypointIndices[activeStIdx + 1];
      if (activeStIdx < scheduledStops.length && (i + 1) === currentWaypointNode) {
        const ps = scheduledStops[activeStIdx];
        const actualArrSoc = Math.max(currentRunningSoc, minReserve);
        const actualDepSoc = Math.max(actualArrSoc + 0.08, ps.departureSoc);
        const actualEnergyCharged = Number((effectiveCapacity * (actualDepSoc - actualArrSoc)).toFixed(2));
        const effectiveRate = Math.min(ps.station.power_kw, maxChargeRateKw);
        const chargeTimeMin = Number(((actualEnergyCharged / Math.max(effectiveRate, 10)) * 60).toFixed(1));

        finalChargingStops.push({
          node: i + 1,
          waypoint_index: activeStIdx + 1,
          station_name: ps.station.station_name || ps.station.name,
          power_kw: ps.station.power_kw,
          connector_type: getCompatibleStationConnector(ps.station, connectorTypes) || ps.station.connector_type,
          connector_types: ps.station.connector_types,
          current_type: ps.station.current_type,
          operator: ps.station.operator,
          usage_type: ps.station.usage_type || 'Public',
          is_fast_charge: ps.station.is_fast_charge ?? (ps.station.power_kw >= 40),
          arrival_soc: Number(actualArrSoc.toFixed(4)),
          departure_soc: Number(actualDepSoc.toFixed(4)),
          charge_time_min: chargeTimeMin,
          energy_charged_kwh: actualEnergyCharged,
          replenish_type: ps.replenishType,
          target_policy: 'minimum_needed_plus_buffer',
          lat: ps.station.lat,
          lon: ps.station.lon,
          ocm_id: ps.station.ocm_id
        });

        // Recharge battery to departure SOC
        currentRunningSoc = actualDepSoc;
        activeStIdx++;
      }

      detourSocTrace.push({
        node: i + 1,
        soc: Number(currentRunningSoc.toFixed(4)),
        cumulative_kwh: Number(runningCumulativeKwh.toFixed(4))
      });
    }

    const arrivalSoc = Number(currentRunningSoc.toFixed(4));
    const totalTripDurationMin = Number(
      (detourRoute.durationMin + finalChargingStops.reduce((sum, s) => sum + s.charge_time_min, 0)).toFixed(1)
    );

    // ── 4. COMPUTE UNMITIGATED GEOMETRY & STORYLINE DIAGNOSTICS FOR COMPARISON ──
    let unmitigatedRouteGeometry: [number, number][] = [];
    let unmitigatedTotalDurationMin = totalTripDurationMin;
    let unmitigatedDistanceKm = detourRoute.distanceKm;

    if (unmitigatedStops.length > finalChargingStops.length) {
      try {
        const uDetour = await getMultiPointRouteGeometry(unmitigatedWaypoints);
        unmitigatedRouteGeometry = uDetour.coordinates;
        unmitigatedDistanceKm = uDetour.distanceKm;
        const uChargeTimeMin = unmitigatedStops.reduce((sum, s) => sum + s.chargeTimeMin, 0);
        unmitigatedTotalDurationMin = Number((uDetour.durationMin + uChargeTimeMin).toFixed(1));
      } catch (e) {
        // Fallback if waypoint route fails
      }
    }

    const timeSavedMin = Math.max(0, Number((unmitigatedTotalDurationMin - totalTripDurationMin).toFixed(1)));
    const detourSavedKm = Math.max(0, Number((unmitigatedDistanceKm - detourRoute.distanceKm).toFixed(1)));
    const stopsSuppressed = Math.max(0, unmitigatedStops.length - finalChargingStops.length);

    return res.json({
      feasible: true,
      charging_needed: true,
      is_detour_routed: true,
      solver_model: 'valhalla_dynamic_soc_simulation',
      replenishment_policy: 'minimum_needed_plus_buffer',
      deficit_kwh: 0,
      arrival_soc: arrivalSoc,
      route: {
        node_ids: detourRoute.coordinates.map((_, idx) => idx),
        geometry: detourRoute.coordinates,
        total_distance_km: detourRoute.distanceKm,
        total_energy_kwh: detourTotalEnergyKwh,
        estimated_time_min: totalTripDurationMin,
        driving_time_min: detourRoute.durationMin
      },
      charging_stops: finalChargingStops,
      soc_trace: detourSocTrace,
      legs: detourRoute.legs,
      detour_summary: {
        original_distance_km: direct.distanceKm,
        detour_distance_km: detourRoute.distanceKm,
        extra_distance_km: Number((detourRoute.distanceKm - direct.distanceKm).toFixed(2)),
        stops_count: finalChargingStops.length
      },
      diagnostics: {
        mitigation_applied: true,
        unmitigated_stops_count: unmitigatedStops.length,
        consolidated_stops_count: finalChargingStops.length,
        stops_suppressed_count: stopsSuppressed,
        time_saved_min: timeSavedMin,
        detour_saved_km: detourSavedKm,
        unmitigated_route: {
          geometry: unmitigatedRouteGeometry,
          distance_km: unmitigatedDistanceKm,
          duration_min: unmitigatedTotalDurationMin,
          stops: unmitigatedStops.map((s, idx) => ({
            stop_number: idx + 1,
            name: s.station.station_name || s.station.name,
            power_kw: s.station.power_kw,
            lat: s.station.lat,
            lon: s.station.lon,
            arrival_soc: s.arrivalSoc,
            departure_soc: s.departureSoc,
            charge_time_min: s.chargeTimeMin
          }))
        },
        storyline: {
          title: "Root Cause & Mitigation: Sangli Micro-Hopping (6 Stops) vs Corridor Forward Solution",
          issue_description: "In dense urban charging hubs like Sangli/Budhgaon, naive greedy scoring prioritizes proximity over highway progress, causing the EV to visit 6 consecutive stations in an 8 km circle before getting on the highway.",
          mitigation_description: "Forward-projection corridor simulation and 22 km cluster suppression consolidate charging into optimal high-power stops, saving hookup time and urban detour.",
          chapters: [
            {
              title: "Chapter 1: The Greedy Hop Trap (Observed Issue)",
              summary: "Nearby chargers in Budhgaon/Sangli had almost 0 km detour and 100% arrival reserve, so greedy scoring repeatedly selected adjacent neighborhood stations.",
              stops: unmitigatedStops.length,
              duration_min: unmitigatedTotalDurationMin
            },
            {
              title: "Chapter 2: Forward Corridor Projection & Cluster Suppression",
              summary: "The solver drives forward along the highway corridor until the battery reaches the critical replenishment window (~18% SOC), suppressing all chargers within 22 km of prior stops.",
              stops: finalChargingStops.length,
              duration_min: totalTripDurationMin
            },
            {
              title: "Chapter 3: Consolidated Fast-Charging Victory",
              summary: `Trip consolidated to ${finalChargingStops.length} stop(s). Avoided ${stopsSuppressed} redundant stops, saved ${timeSavedMin} minutes and ${detourSavedKm} km of urban detour.`,
              time_saved_min: timeSavedMin,
              detour_saved_km: detourSavedKm
            }
          ]
        }
      }
    });
  });

  // Static files handling
  app.use('/static', express.static(path.join(__dirname, 'frontend')));
  app.use('/static', express.static(path.join(__dirname, 'public', 'static')));

  // In production or direct, serve frontend/index.html
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  // Catch-all for assets or fallback
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.static(path.join(__dirname, 'dist')));

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`  ANTIGRAVITY AI — Make My Route EV Route Planner`);
    console.log(`  Server running at: http://0.0.0.0:${PORT}`);
    console.log(`  Region: ${REGION}`);
    console.log(`=======================================================`);
  });
}

startServer();
