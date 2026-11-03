import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const arr = JSON.parse(fs.readFileSync(path.join(DATA, 'stations.json'), 'utf8'));
const c = { 40: 0, 80: 0, 160: 0 };
let ok = 0;
for (const s of arr) {
  c[s.max_power_kw] = (c[s.max_power_kw] || 0) + 1;
  if (s.max_power_kw > 0 && s.standards?.includes('CCS2') && s.access === 'Public') ok++;
}
console.log('json categories', c, 'usable', ok, 'total', arr.length);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const n = text[i + 1];
    if (q) {
      if (ch === '"' && n === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const rows = parseCsv(fs.readFileSync(path.join(DATA, 'EV_Charging_Stations_India_unique.csv'), 'utf8'));
const h = rows[0].map((x) => x.toLowerCase());
const ix = (n) => h.indexOf(n);
let india = 0;
const powers = {};
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  const lat = +r[ix('latitude')];
  const lon = +r[ix('longitude')];
  const p = +r[ix('power_kw')] || 0;
  if (lat >= 6 && lat <= 38 && lon >= 68 && lon <= 98 && p > 0) {
    india++;
    powers[p] = (powers[p] || 0) + 1;
  }
}
console.log('unique india-bounded with power', india, powers);

const finalHead = fs.readFileSync(path.join(DATA, 'stations_final.csv'), 'utf8').split(/\n/).slice(0, 2);
console.log('stations_final header/sample:\n' + finalHead.join('\n'));
