#!/usr/bin/env node
/**
 * Enrich every station in data/ with diverse capacity categories:
 *   40 kW  (~45%) — light BEV / high-constraint slow charging
 *   80 kW  (~35%) — medium-duty
 *  160 kW  (~20%) — heavy-duty / ultra-fast hubs
 *
 * Makes the full ~30k inventory usable for constrained routing demos.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');

const CAPACITIES = [40, 80, 160];
const WEIGHTS = [0.45, 0.35, 0.20]; // cumulative used via thresholds

function stableHash(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickCapacity(key) {
  const r = (stableHash(key) % 10000) / 10000;
  if (r < WEIGHTS[0]) return 40;
  if (r < WEIGHTS[0] + WEIGHTS[1]) return 80;
  return 160;
}

function capacityMeta(power) {
  if (power >= 160) {
    return {
      power,
      type_raw: 'CCS-II Ultra',
      standards: ['CCS2'],
      currents: ['DC'],
      vehicle_classes: ['car', 'bus', 'truck'],
      connector_type: 'CCS2',
      current_type: 'DC Fast',
    };
  }
  if (power >= 80) {
    return {
      power,
      type_raw: 'CCS-II',
      standards: ['CCS2', 'TYPE2_AC'],
      currents: ['DC', 'AC'],
      vehicle_classes: ['car'],
      connector_type: 'CCS2',
      current_type: 'DC Fast',
    };
  }
  return {
    power,
    type_raw: 'CCS-II / Type2',
    standards: ['CCS2', 'TYPE2_AC'],
    currents: ['DC', 'AC'],
    vehicle_classes: ['car', 'two_three_wheeler'],
    connector_type: 'CCS2',
    current_type: 'DC Fast',
  };
}

function enrichJsonStation(station) {
  const key = station.id || `${station.latitude},${station.longitude},${station.address || ''}`;
  const meta = capacityMeta(pickCapacity(key));
  const guns = [{ standard: 'CCS2', kw: meta.power }];
  if (meta.standards.includes('TYPE2_AC')) {
    guns.push({ standard: 'TYPE2_AC', kw: Math.min(22, meta.power) });
  }

  station.max_power_kw = meta.power;
  station.capacity_category_kwh = meta.power; // aligned with 40/80/160 vehicle battery tiers
  station.standards = meta.standards;
  station.currents = meta.currents;
  station.vehicle_classes = meta.vehicle_classes;
  station.max_kw_by_standard = Object.fromEntries(
    meta.standards.map((std) => [std, std === 'TYPE2_AC' ? Math.min(22, meta.power) : meta.power])
  );
  station.chargers = [
    {
      type_raw: meta.type_raw,
      standards: meta.standards,
      lev_variant: null,
      charger_kw: meta.power,
      connectors_per_charger: guns.length,
      guns,
      count: 1,
    },
  ];
  station.total_chargers = 1;
  station.total_connectors = guns.length;
  // Keep ownership, but ensure stations are route-usable via public access flag in loader.
  station.access = 'Public';
  station.capacity_enriched = true;
  return station;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch === '\r') {
      // skip
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function escapeCsv(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function enrichCsvFile(filePath, opts) {
  if (!fs.existsSync(filePath)) {
    console.warn(`skip missing ${filePath}`);
    return { total: 0, filled: 0 };
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsv(raw);
  if (rows.length < 2) return { total: 0, filled: 0 };

  rows[0] = rows[0].map((h) => h.trim());
  const headers = rows[0];
  const lower = () => headers.map((h) => h.toLowerCase());
  const idx = (name) => lower().indexOf(name);

  let powerIdx = idx(opts.powerCol);
  let connectorIdx = idx(opts.connectorCol);
  let currentIdx = idx(opts.currentCol);
  let latIdx = idx(opts.latCol);
  let lonIdx = idx(opts.lonCol);
  let idIdx = idx(opts.idCol);
  let nameIdx = idx(opts.nameCol);

  // Ensure power column exists
  if (powerIdx < 0) {
    headers.push('power_kw');
    powerIdx = headers.length - 1;
    for (let i = 1; i < rows.length; i++) rows[i].push('');
  }
  // capacity category column
  let catIdx = idx('capacity_category_kwh');
  if (catIdx < 0) {
    headers.push('capacity_category_kwh');
    catIdx = headers.length - 1;
    for (let i = 1; i < rows.length; i++) rows[i].push('');
  }

  const statusIdx = idx('status');
  let filled = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    while (row.length < headers.length) row.push('');
    if (row.length > headers.length) row.length = headers.length;
    const id =
      (idIdx >= 0 ? row[idIdx] : '') ||
      (nameIdx >= 0 ? row[nameIdx] : '') ||
      `${row[latIdx] || ''},${row[lonIdx] || ''},${i}`;
    const meta = capacityMeta(pickCapacity(id));
    row[powerIdx] = String(meta.power);
    row[catIdx] = String(meta.power);
    if (connectorIdx >= 0) {
      const existing = (row[connectorIdx] || '').trim();
      if (!existing || existing.toUpperCase() === 'NONE' || existing.toLowerCase() === 'unknown') {
        row[connectorIdx] = meta.connector_type;
      } else if (!/ccs|type\s*2|chademo/i.test(existing)) {
        row[connectorIdx] = `${existing}; ${meta.connector_type}`;
      }
    }
    if (currentIdx >= 0) {
      row[currentIdx] = meta.current_type;
    }
    if (statusIdx >= 0 && !(row[statusIdx] || '').trim()) {
      row[statusIdx] = 'Operational';
    }
    filled++;
  }

  const out = rows.map((r) => r.map(escapeCsv).join(',')).join('\n') + '\n';
  fs.writeFileSync(filePath, out, 'utf8');
  return { total: rows.length - 1, filled };
}

console.log('Enriching stations.json …');
const jsonPath = path.join(DATA, 'stations.json');
const stations = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const counts = { 40: 0, 80: 0, 160: 0 };
for (const s of stations) {
  enrichJsonStation(s);
  counts[s.max_power_kw]++;
}
fs.writeFileSync(jsonPath, JSON.stringify(stations));
console.log(`  stations.json: ${stations.length} → 40kW=${counts[40]} 80kW=${counts[80]} 160kW=${counts[160]}`);

const csvJobs = [
  {
    file: 'stations_final.csv',
    powerCol: 'power_kw',
    connectorCol: 'connector_type',
    currentCol: 'current_type',
    latCol: 'lat',
    lonCol: 'lon',
    idCol: 'ocm_id',
    nameCol: 'name',
  },
  {
    file: 'stations_india.csv',
    powerCol: 'power_kw',
    connectorCol: 'connector_type',
    currentCol: 'current_type',
    latCol: 'lat',
    lonCol: 'lon',
    idCol: 'ocm_id',
    nameCol: 'name',
  },
  {
    file: 'stations.csv',
    powerCol: 'power_kw',
    connectorCol: 'connector_type',
    currentCol: 'current_type',
    latCol: 'lat',
    lonCol: 'lon',
    idCol: 'ocm_id',
    nameCol: 'name',
  },
  {
    file: 'EV_Charging_Stations_India_unique.csv',
    powerCol: 'power_kw',
    connectorCol: 'connector_type',
    currentCol: 'current_type',
    latCol: 'latitude',
    lonCol: 'longitude',
    idCol: 'station_name',
    nameCol: 'station_name',
  },
];

for (const job of csvJobs) {
  const filePath = path.join(DATA, job.file);
  console.log(`Enriching ${job.file} …`);
  const result = enrichCsvFile(filePath, job);
  console.log(`  ${job.file}: updated ${result.filled}/${result.total}`);
}

console.log('Done. Capacity categories 40 / 80 / 160 applied across data/.');
