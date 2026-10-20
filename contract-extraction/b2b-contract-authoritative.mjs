import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_NC_JSON = path.join(here, 'b2b-contract-authoritative-ncs-16-10-2026.json');
const SEGUIMIENTO_NC_JSON = path.join(here, 'b2b-seguimiento-ncs-20-10-2026.json');

let cachedSet = null;
let cachedAllB2bSet = null;

export function loadB2bContractAuthoritativeNcs(jsonPath = DEFAULT_NC_JSON) {
  if (cachedSet && jsonPath === DEFAULT_NC_JSON) return cachedSet;
  const nums = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const set = new Set(nums.map((n) => Number(n)).filter(Number.isFinite));
  if (jsonPath === DEFAULT_NC_JSON) cachedSet = set;
  return set;
}

export function loadAllB2bNcs() {
  if (cachedAllB2bSet) return cachedAllB2bSet;
  const a = loadB2bContractAuthoritativeNcs();
  const b = fs.existsSync(SEGUIMIENTO_NC_JSON)
    ? JSON.parse(fs.readFileSync(SEGUIMIENTO_NC_JSON, 'utf8')).map((n) => Number(n))
    : [];
  cachedAllB2bSet = new Set([...a, ...b].filter(Number.isFinite));
  return cachedAllB2bSet;
}

export function ncLabel(n) {
  return `NC_${String(n).padStart(4, '0')}`;
}

export function isMamaCumbeRow(row) {
  if (!row) return false;
  const parts = [
    row['Partner Company'],
    row['Company Id'],
    row['Last Name(*)'],
    row['First Name'],
    row['Reservation Notes'],
    row['Internal Guest Notes'],
  ]
    .map((v) => (v == null ? '' : String(v).trim()))
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /mama\s*cumb|fundacion mama cumbe/.test(parts);
}

export function parseMoney(v) {
  const raw = v == null ? '' : String(v).trim();
  if (!raw || raw === '/' || raw === '-') return null;
  let s = raw.replace(/[^\d.,-]/g, '');
  if (!s) return null;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function rentAmountFromRow(row) {
  if (!row) return null;
  for (const field of ['Allocated Rate', 'Per Night Prices', 'Total Price']) {
    const n = parseMoney(row[field]);
    if (n != null) return n;
  }
  return null;
}

/** Contract rent for B2B authoritative NCs (incl. Mamá Cumbé 1441 → 1310). */
export function contractRentFromCustomer(c) {
  const rc = rentAmountFromRow(c);
  if (isMamaCumbeRow(c) && rc === 1441) return 1310;
  return rc;
}

export function formatMoney(n) {
  if (n == null) return null;
  if (Math.abs(n - Math.round(n)) < 0.001) return String(Math.round(n));
  return n.toFixed(2);
}

export function isB2bContractAuthoritativeNc(nc, allowlist = loadB2bContractAuthoritativeNcs()) {
  return nc != null && allowlist.has(Number(nc));
}

export function contractAuthoritativeForNc(c, nc, allowlist = loadB2bContractAuthoritativeNcs()) {
  if (isB2bContractAuthoritativeNc(nc, allowlist)) return true;
  return Boolean(c) && isMamaCumbeRow(c);
}

/** Fields copied from Final_Format customers → HM / Seguimiento for B2B NCs. */
export const B2B_SYNC_FIELDS = [
  'Group Code',
  'Internal Guest Notes',
  'First Name',
  'Last Name(*)',
  'Second Last Name',
  'Document Number',
  'Tax Identification Number',
  'Arrival Date(*)',
  'Departure Date(*)',
  'Allocated Room Category(*)',
  'Allocated Rate',
  'Per Night Prices',
  'Prepaid Amount',
  'Partner Company',
  'Company Id',
  'Reservation Notes',
];

export function customerRowForB2bSync(c) {
  if (!c) return null;
  const rent = contractRentFromCustomer(c);
  const out = {};
  for (const f of B2B_SYNC_FIELDS) {
    out[f] = c[f] ?? null;
  }
  const code = out['Group Code'];
  if (code) out['Internal Guest Notes'] = code;
  if (rent != null) {
    const s = formatMoney(rent);
    out['Allocated Rate'] = s;
    out['Per Night Prices'] = s;
  }
  const notes = cleanSyncNote(out['Reservation Notes']);
  out['Reservation Notes'] = notes
    ? `${notes} | B2B: aligned to contract extraction 16-10-2026`
    : 'B2B: aligned to contract extraction 16-10-2026';
  return out;
}

function cleanSyncNote(v) {
  const s = v == null ? '' : String(v).trim();
  if (!s) return '';
  return s.replace(/\s*\|\s*B2B: aligned to contract extraction 16-10-2026/g, '').trim();
}
