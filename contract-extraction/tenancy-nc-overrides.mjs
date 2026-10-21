/**
 * HouseMonk Tenancy export keyed by NC (last column).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { clean } from './room-number-to-category.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Shipped copy for Render; local dev may use External Data Sources via fallback. */
export const DEFAULT_TENANCY_CSV = path.join(here, 'data', 'Tenancy-14-10-2026-044225.csv');
const TENANCY_CSV_FALLBACK = path.join(
  here,
  '../contract-analysis/External Data Sources/Tenancy-14-10-2026-044225.csv',
);

export const TENANCY_GUEST_MEWS_FIELDS = [
  'First Name',
  'Last Name(*)',
  'Second Last Name',
  'Email',
  'Telephone',
  'Document Number',
  'Document Type',
  'Allocated Room Number',
];

/** When B2B guest is forced from tenancy, do not overwrite contract commercial fields. */
const TENANCY_B2B_COMMERCIAL_SKIP = new Set([
  'Partner Company',
  'Company Id',
  'Tax Identification Number',
  'Arrival Date(*)',
  'Departure Date(*)',
  'Allocated Rate',
  'Per Night Prices',
  'Prepaid Amount',
  'Allocated Room Category(*)',
  'Included Products',
  'Adult Count(*)',
  'Child Count(*)',
]);

/** NC → manual billing / lifecycle overrides (user-confirmed HouseMonk profiles). */
export const TENANCY_MANUAL_BY_NC = {
  989: {
    'Address Line 1': 'Urbanización del Monte León, 69',
    City: 'Sariegos',
    'Postal Code': '24196',
    'Country Code': 'ES',
  },
  1047: {
    excludeFromV2: true,
    reason: 'Moved out',
    Email: 'schcolnikjorge3@gmail.com',
    Telephone: '+52 6121572704',
    'Address Line 1': 'Piramides 124',
    City: 'Baja California Sur',
    'Postal Code': '23090',
    'Country Code': 'MX',
  },
  1091: {
    'Address Line 1': 'Avda. Olímpica 34 Bajo',
    City: 'Torrente',
    'Postal Code': '46900',
    'Country Code': 'ES',
  },
  1123: {
    Email: 'lui.gph@gmail.com',
    Telephone: '+52 5614022660',
    'Document Number': 'Z0718781J',
    'Document Type': 'IdentityCard',
    'Address Line 1': 'Calle Juan Tinoco 124 Colonia Merced Gómez Alcaldía Álvaro Obregón',
    City: 'Ciudad de Mexico',
    'Postal Code': '01600',
    'Country Code': 'MX',
  },
  1308: {
    'Address Line 1': 'Calle Sahara 71',
    City: 'Madrid',
    'Postal Code': '28001',
    'Country Code': 'ES',
  },
  1307: {
    Email: 'yumary@yumaryguerra.com',
    Telephone: '+507 68670231',
    'First Name': 'Yumary',
    'Last Name(*)': 'Guerra Escalona',
    'Address Line 1': 'Ph terramar san francisco',
    City: 'Panamá',
    'Postal Code': '0000',
    'Country Code': 'PA',
  },
  1313: {
    excludeFromV2: true,
    reason: 'HouseMonk cancelled',
  },
  1403: {
    excludeFromV2: true,
    reason: 'HouseMonk moved out',
  },
  1477: {
    'Address Line 1': 'tulipero 6',
    City: 'Madrid',
    'Postal Code': '28044',
    'Country Code': 'ES',
  },
  1520: {
    excludeFromV2: true,
    reason: 'HouseMonk cancelled',
  },
  1566: integraBilling(),
  1567: integraBilling(),
  1568: integraBilling(),
  1569: integraBilling(),
  1570: integraBilling(),
  1571: integraBilling(),
  1572: integraBilling(),
  1573: integraBilling(),
  1574: {
    'Allocated Room Category(*)':
      '1x The Comfort; 2 x The Two Bedroom (Double Single)',
  },
  1575: {
    'Partner Company': 'OTIS Mobility SA',
    'Company Id': 'OTIS Mobility SA',
    'Address Line 1': 'Calle Tomás Redondo 2',
    City: 'Madrid',
    'Postal Code': '28044',
    'Country Code': 'ES',
    'Document Number': 'A08015422',
    'Document Type': 'TaxIdentificationNumber',
    'Tax Identification Number': 'A08015422',
  },
  1505: {
    excludeFromV2: true,
    reason: 'HouseMonk moved out',
  },
  1516: {
    excludeFromV2: true,
    reason: 'HouseMonk cancelled (desistimiento)',
  },
  1535: {
    Email: 'jlgampu@gmail.com',
    Telephone: '+34 606248038',
    'First Name': 'Juan Luis',
    'Last Name(*)': 'Garcia Ampudia',
    'Document Number': '10860064Q',
    'Document Type': 'IdentityCard',
    'Address Line 1': 'Corin Tellado, 26, 1 b',
    City: 'Gijón',
    'Postal Code': '33204',
    'Country Code': 'ES',
    'Allocated Room Number': '1167',
    'Nationality Code': 'ES',
  },
  1604: {
    excludeFromV2: true,
    reason: 'HouseMonk moved out',
  },
  1606: {
    'Postal Code': '00000',
    City: 'Willemstad',
    'Country Code': 'CW',
  },
  1716: {
    'Address Line 1': 'calle tulipero 6',
    City: 'Madrid',
    'Postal Code': '28014',
    'Country Code': 'ES',
  },
  1771: {
    'Address Line 1': '15 mount eustace crescent,tyrellstown',
    City: 'Dublin',
    'Postal Code': 'd15c1k8',
    'Country Code': 'IE',
  },
  1902: {
    'Address Line 1':
      'paseo de coches 33a, residencial el dorado, tlalnepantla de baz, estado de mexico',
    City: 'Tlalnepantla, Estado De Mexico',
    'Postal Code': '54020',
    'Country Code': 'MX',
  },
  1922: {
    City: 'Caracas',
    'Postal Code': '1071',
    'Country Code': 'VE',
  },
  1944: {
    'Postal Code': '00',
    City: 'Lima',
    'Country Code': 'PE',
  },
  2081: {
    'Address Line 1': 'istanbul kucuk cekmece atakent',
    City: 'Istanbul',
    'Postal Code': '0090',
    'Country Code': 'TR',
  },
  2095: {
    'Address Line 1': 'kesterkamp 31',
    City: 'Bochum',
    'Postal Code': '44879',
    'Country Code': 'DE',
  },
  2098: {
    'Address Line 1': 'Carrera 6 n15a-134',
    City: 'Cajicá',
    'Postal Code': '250240',
    'Country Code': 'CO',
  },
  2101: {
    excludeFromV2: true,
    reason: 'HouseMonk cancelled',
  },
  2110: {
    'Address Line 1': 'Calle Juan Tinoco 124 Colonia Merced Gómez Alcaldía Álvaro Obregón',
    City: 'Ciudad de Mexico',
    'Postal Code': '01600',
    'Country Code': 'MX',
  },
  1646: integraBilling(),
  1890: integraBilling(),
  1891: integraBilling(),
};

function integraBilling() {
  return {
    'Address Line 1': 'Calle Tomás Redondo 2',
    City: 'Madrid',
    'Postal Code': '28044',
    'Country Code': 'ES',
    'Partner Company': 'Integra Ascensores S.L',
    'Company Id': 'Integra Ascensores SL',
    'Tax Identification Number': 'B83336891',
    'Document Number': 'B83336891',
    'Document Type': 'TaxIdentificationNumber',
  };
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => clean(c))) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((c) => clean(c))) rows.push(row);
  }
  return rows;
}

function splitPipeField(raw) {
  const c = clean(raw);
  if (!c) return [];
  return c.split(/\s*\|\s*/).map((p) => clean(p)).filter(Boolean);
}

/** HouseMonk: Tenant Type/ID often pipe-separated; names/emails/phones often comma-separated. */
function tenantColumnsFromRow(tenancyRow) {
  const types = splitPipeField(tenancyRow['Tenant Type']);
  const n = Math.max(types.length, 1);
  const splitMixed = (raw) => {
    const c = clean(raw);
    if (!c) return [];
    if (/\s\|\s/.test(c) || (c.includes('|') && !c.includes(','))) return splitPipeField(c);
    if (n > 1 && c.includes(',')) return c.split(/\s*,\s*/).map((p) => clean(p)).filter(Boolean);
    return [c];
  };
  return {
    types: types.length ? types : ['Individual'],
    ids: splitMixed(tenancyRow['Tenant ID']),
    names: splitMixed(tenancyRow['Tenant Name']),
    emails: splitMixed(tenancyRow['Tenant Email']),
    phones: splitMixed(tenancyRow['Tenant Phone Number']),
  };
}

function firstPipePart(raw) {
  const parts = splitPipeField(raw);
  return parts[0] || clean(raw) || null;
}

function parseDdMmYyyy(raw) {
  const c = clean(raw);
  const m = c.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

let cachedLookup = null;
let cachedLookupPath = null;

const EMPTY_TENANCY_LOOKUP = Object.freeze({
  byNc: new Map(),
  byNcDoor: new Map(),
  rowsByNc: new Map(),
  byTenantId: new Map(),
  rows: [],
});

/** Match Mews room / HouseMonk Door (0129, 129, -1049). */
export function doorLookupKeys(raw) {
  const s = clean(raw);
  if (!s) return [];
  const keys = new Set([s]);
  if (/^-?\d+$/.test(s)) {
    const n = parseInt(s, 10);
    keys.add(String(n));
    if (n >= 0) keys.add(String(n).padStart(4, '0'));
    if (s.startsWith('0') && s.length > 1) keys.add(s.replace(/^0+/, '') || '0');
  }
  return [...keys];
}

function parseIsoOrDmyDate(raw) {
  const c = clean(raw);
  if (!c) return null;
  const iso = c.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return parseDdMmYyyy(c);
}

export function shouldPreferIndividualB2bGuest(tenancyRow, customerCtx) {
  if (!tenancyRow) return true;
  const st = clean(tenancyRow['Tenancy Status']).toLowerCase();
  if (st === 'occupied' || st === 'shifted') return true;
  const today = (process.env.AUDIT_TODAY || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const arr = parseIsoOrDmyDate(customerCtx?.['Arrival Date(*)']);
  const dep = parseIsoOrDmyDate(customerCtx?.['Departure Date(*)']);
  if (arr && dep && arr <= today && dep >= today) return true;
  return false;
}

function pickB2bGuestIndices(tenancyRow, preferIndividual) {
  const { types: tenantTypes, ids: tenantIds } = tenantColumnsFromRow(tenancyRow);
  const n = Math.max(tenantTypes.length, tenantIds.length, 1);
  let companyIdx = -1;
  let individualIdx = -1;
  for (let i = 0; i < n; i++) {
    const typ = (tenantTypes[i] || 'Individual').toLowerCase();
    if (typ === 'company' && companyIdx < 0) companyIdx = i;
    else if (typ !== 'company' && individualIdx < 0) individualIdx = i;
  }
  if (preferIndividual && individualIdx >= 0) return { guestIdx: individualIdx, companyIdx };
  if (!preferIndividual && companyIdx >= 0 && individualIdx < 0) return { guestIdx: companyIdx, companyIdx };
  if (individualIdx >= 0) return { guestIdx: individualIdx, companyIdx };
  if (companyIdx >= 0) return { guestIdx: companyIdx, companyIdx };
  return { guestIdx: 0, companyIdx: companyIdx >= 0 ? companyIdx : -1 };
}

function normalizeTenantId(id) {
  return clean(id).toUpperCase().replace(/\s/g, '');
}

function normNameToken(s) {
  return clean(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]/g, '');
}

function customerNameTokens(customer) {
  const parts = [customer['First Name'], customer['Last Name(*)'], customer['Second Last Name']];
  const tokens = new Set();
  for (const p of parts) {
    for (const t of clean(p).split(/\s+/)) {
      const n = normNameToken(t);
      if (n.length > 2) tokens.add(n);
    }
  }
  return tokens;
}

function tenancyRowPrefer(a, b) {
  const emA = clean(a['Tenant Email']).includes('@');
  const emB = clean(b['Tenant Email']).includes('@');
  if (emA && !emB) return true;
  if (!emA && emB) return false;
  const stA = clean(a['Tenancy Status']).toLowerCase();
  const stB = clean(b['Tenancy Status']).toLowerCase();
  if (stA === 'occupied' && stB !== 'occupied') return true;
  if (stB === 'occupied' && stA !== 'occupied') return false;
  return false;
}

function readTenancyTable(csvPath) {
  const text = fs.readFileSync(csvPath, 'utf8');
  const table = parseCsvRows(text);
  const header = table[0];
  const ncIdx = header.lastIndexOf('NC');
  const rows = [];
  const byNc = new Map();
  const byNcDoor = new Map();
  const rowsByNc = new Map();
  const byTenantId = new Map();

  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const row = {};
    for (let c = 0; c < header.length; c++) row[header[c]] = cells[c] ?? '';
    rows.push(row);

    const ncRaw = clean(cells[ncIdx >= 0 ? ncIdx : cells.length - 1]);
    if (ncRaw && /^\d+$/.test(ncRaw)) {
      const nc = Number(ncRaw);
      const prevNc = byNc.get(nc);
      byNc.set(nc, !prevNc || tenancyRowPrefer(row, prevNc) ? row : prevNc);
      if (!rowsByNc.has(nc)) rowsByNc.set(nc, []);
      rowsByNc.get(nc).push(row);
      for (const dk of doorLookupKeys(row.Door)) {
        const key = `${nc}|${dk}`;
        const prevDoor = byNcDoor.get(key);
        byNcDoor.set(key, !prevDoor || tenancyRowPrefer(row, prevDoor) ? row : prevDoor);
      }
    }

    for (const id of splitPipeField(row['Tenant ID'])) {
      const key = normalizeTenantId(id);
      if (!key) continue;
      const prev = byTenantId.get(key);
      if (!prev || tenancyRowPrefer(row, prev)) byTenantId.set(key, row);
    }
  }
  return { byNc, byNcDoor, rowsByNc, byTenantId, rows };
}

function resolveTenancyCsvPath(preferred = DEFAULT_TENANCY_CSV) {
  const candidates = [
    clean(process.env.TENANCY_CSV),
    preferred,
    DEFAULT_TENANCY_CSV,
    TENANCY_CSV_FALLBACK,
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0] || DEFAULT_TENANCY_CSV;
}

/** Full tenancy indexes: NC, tenant ID, and all rows (for name/date match). */
export function loadTenancyLookup(csvPath = DEFAULT_TENANCY_CSV) {
  const resolved = resolveTenancyCsvPath(csvPath);
  if (cachedLookup && cachedLookupPath === resolved) return cachedLookup;
  if (!fs.existsSync(resolved)) {
    console.warn(
      `Tenancy CSV missing (${resolved}); using empty lookup. TENANCY_MANUAL_BY_NC overrides still apply.`,
    );
    cachedLookup = EMPTY_TENANCY_LOOKUP;
    cachedLookupPath = resolved;
    return cachedLookup;
  }
  cachedLookup = readTenancyTable(resolved);
  cachedLookupPath = resolved;
  return cachedLookup;
}


export function loadTenancyByNc(csvPath = DEFAULT_TENANCY_CSV) {
  return loadTenancyLookup(csvPath).byNc;
}

function scoreTenancyMatch(tenancyRow, customer) {
  const tenantIds = splitPipeField(tenancyRow['Tenant ID']);
  const doc = normalizeTenantId(customer['Document Number']);
  if (doc && tenantIds.some((id) => normalizeTenantId(id) === doc)) return 100;

  const nameBlob = splitPipeField(tenancyRow['Tenant Name'])
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  let nameScore = 0;
  for (const tok of customerNameTokens(customer)) {
    if (nameBlob.replace(/[^a-z0-9]/g, '').includes(tok)) nameScore += 25;
  }
  if (nameScore < 25) return 0;

  const arr = clean(customer['Arrival Date(*)']);
  const start = parseDdMmYyyy(tenancyRow['Contract Start Date']);
  if (!arr || !start || arr !== start) return 0;

  let score = nameScore + 25;
  if (clean(tenancyRow['Tenant Email']).includes('@')) score += 10;
  return score;
}

/** Resolve HouseMonk tenancy row for a V2 customer (NC column, tenant ID, then name + arrival). */
export function resolveTenancyForCustomer(nc, customer, lookup = loadTenancyLookup()) {
  const n = Number(nc);
  for (const dk of doorLookupKeys(customer?.['Allocated Room Number'])) {
    const byDoor = lookup.byNcDoor?.get(`${n}|${dk}`);
    if (byDoor) return byDoor;
  }

  const ncRows = lookup.rowsByNc?.get(n) || [];
  if (ncRows.length > 1 && clean(customer?.['Allocated Room Number'])) {
    for (const row of ncRows) {
      const rowKeys = new Set(doorLookupKeys(row.Door));
      for (const dk of doorLookupKeys(customer['Allocated Room Number'])) {
        if (rowKeys.has(dk)) return row;
      }
    }
  }
  if (ncRows.length) {
    let best = ncRows[0];
    for (const row of ncRows) {
      if (tenancyRowPrefer(row, best)) best = row;
    }
    return best;
  }

  const byNc = lookup.byNc || lookup;
  if (byNc instanceof Map && byNc.get(n)) return byNc.get(n);

  const doc = normalizeTenantId(customer['Document Number']);
  if (doc && lookup.byTenantId?.get(doc)) return lookup.byTenantId.get(doc);

  let best = null;
  let bestScore = 0;
  for (const row of lookup.rows || []) {
    const s = scoreTenancyMatch(row, customer);
    if (s > bestScore) {
      bestScore = s;
      best = row;
    }
  }
  if (bestScore >= 50) return best;
  return null;
}

function pickEmailFromTenantField(raw) {
  const c = clean(raw);
  if (!c) return null;
  const part = c
    .split(',')
    .map((s) => s.trim())
    .find((e) => e.includes('@'));
  return part ? part.toLowerCase() : null;
}

function isSpanishCompanyTaxId(id) {
  return /^[A-Z]\d{7,8}[A-Z0-9]?$/i.test(clean(id));
}

function documentTypeForId(id) {
  const c = clean(id);
  if (!c) return 'IdentityCard';
  if (isSpanishCompanyTaxId(c)) return 'TaxIdentificationNumber';
  if (/^[A-Z0-9]{6,12}$/i.test(c) && /[A-Z]/i.test(c) && /\d/.test(c)) return 'Passport';
  return 'IdentityCard';
}

/** Map tenancy row → Mews customer patch (only non-empty). */
export function mewsPatchFromTenancy(tenancyRow, customerCtx = null) {
  if (!tenancyRow) return {};
  const patch = {};
  const tenantIds = splitPipeField(tenancyRow['Tenant ID']);
  const tenantTypes = splitPipeField(tenancyRow['Tenant Type']);
  const tenantNames = splitPipeField(tenancyRow['Tenant Name']);
  const emails = splitPipeField(tenancyRow['Tenant Email']);
  const phones = splitPipeField(tenancyRow['Tenant Phone Number']);
  const matchDoc = customerCtx ? normalizeTenantId(customerCtx['Document Number']) : '';

  let companyIdx = -1;
  let guestIdx = -1;
  for (let i = 0; i < tenantIds.length; i++) {
    const typ = (tenantTypes[i] || 'Individual').toLowerCase();
    if (companyIdx < 0 && typ === 'company') companyIdx = i;
    if (guestIdx < 0 && typ !== 'company') guestIdx = i;
  }
  if (guestIdx < 0 && tenantIds.length) guestIdx = 0;

  if (companyIdx >= 0) {
    const cid = tenantIds[companyIdx];
    const cname = tenantNames[companyIdx];
    if (isSpanishCompanyTaxId(cid)) {
      patch['Tax Identification Number'] = cid;
      patch['Document Number'] = cid;
      patch['Document Type'] = 'TaxIdentificationNumber';
    }
    if (cname) {
      patch['Partner Company'] = cname;
      patch['Company Id'] = cname;
    }
  }

  if (guestIdx >= 0) {
    const name = tenantNames[guestIdx];
    const gid = tenantIds[guestIdx];
    if (name) {
      const parts = name.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        patch['First Name'] = parts[0];
        patch['Last Name(*)'] = parts.slice(1).join(' ');
      } else patch['Last Name(*)'] = name;
    }
    if (gid && companyIdx < 0) {
      patch['Document Number'] = gid;
      patch['Document Type'] = documentTypeForId(gid);
    } else if (gid && companyIdx >= 0 && guestIdx !== companyIdx) {
      patch['Document Number'] = patch['Document Number'] || gid;
    }
  }

  let email = null;
  if (matchDoc) {
    const idx = tenantIds.findIndex((id) => normalizeTenantId(id) === matchDoc);
    if (idx >= 0) email = pickEmailFromTenantField(emails[idx]);
  }
  if (!email && guestIdx >= 0) email = pickEmailFromTenantField(emails[guestIdx]);
  if (!email && companyIdx >= 0) email = pickEmailFromTenantField(emails[companyIdx]);
  if (!email) {
    for (const raw of emails) {
      email = pickEmailFromTenantField(raw);
      if (email) break;
    }
  }
  if (email) patch.Email = email;
  if (phones[0]) patch.Telephone = phones[0];

  const door = clean(tenancyRow.Door);
  if (door) patch['Allocated Room Number'] = door.replace(/^0+/, '') || door;

  const dep = clean(tenancyRow.Deposit);
  if (dep && /\d/.test(dep)) patch['Prepaid Amount'] = dep;

  const rent = clean(tenancyRow['Tenant Rent']);
  if (rent && /\d/.test(rent)) {
    patch['Allocated Rate'] = rent;
    patch['Per Night Prices'] = rent;
  }

  const arr = parseDdMmYyyy(tenancyRow['Contract Start Date']);
  const depDate = parseDdMmYyyy(tenancyRow['Contract End Date']);
  if (arr) patch['Arrival Date(*)'] = arr;
  if (depDate) patch['Departure Date(*)'] = depDate;

  const n = clean(tenancyRow['No of Tenants']);
  if (n && /^\d+$/.test(n)) {
    patch['Adult Count(*)'] = n;
    patch['Child Count(*)'] = '0';
  }

  return patch;
}

/** Company billing fields only (never guest document). */
export function mewsB2bCompanyPatchFromTenancy(tenancyRow) {
  if (!tenancyRow) return {};
  const patch = {};
  const { types: tenantTypes, ids: tenantIds, names: tenantNames } = tenantColumnsFromRow(tenancyRow);
  for (let i = 0; i < tenantIds.length; i++) {
    if ((tenantTypes[i] || 'Individual').toLowerCase() !== 'company') continue;
    const cid = tenantIds[i];
    const cname = clean(tenantNames[i]);
    if (isSpanishCompanyTaxId(cid)) patch['Tax Identification Number'] = cid;
    if (cname) {
      patch['Partner Company'] = cname;
      patch['Company Id'] = cname;
    }
    return patch;
  }
  for (let i = 0; i < tenantIds.length; i++) {
    if (!isSpanishCompanyTaxId(tenantIds[i])) continue;
    patch['Tax Identification Number'] = tenantIds[i];
    const cname = clean(tenantNames[i]);
    if (cname) {
      patch['Partner Company'] = cname;
      patch['Company Id'] = cname;
    }
    break;
  }
  return patch;
}

/** B2B guest row: individual worker when in-house; company placeholder when future Booked-only. */
export function mewsB2bGuestPatchFromTenancy(tenancyRow, customerCtx = null, options = {}) {
  if (!tenancyRow) return {};
  const preferIndividual =
    options.preferIndividual ?? shouldPreferIndividualB2bGuest(tenancyRow, customerCtx);
  const { ids: tenantIds, names: tenantNames, emails, phones } = tenantColumnsFromRow(tenancyRow);
  const { guestIdx, companyIdx } = pickB2bGuestIndices(tenancyRow, preferIndividual);
  const patch = {};

  const name = clean(tenantNames[guestIdx] ?? tenantNames[0]);
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      patch['First Name'] = parts[0];
      patch['Last Name(*)'] = parts.slice(1).join(' ');
    } else patch['Last Name(*)'] = name;
  }

  const gid = tenantIds[guestIdx] ?? tenantIds[0];
  if (gid) {
    const useAsGuestDoc = guestIdx !== companyIdx || !isSpanishCompanyTaxId(gid);
    if (useAsGuestDoc || !preferIndividual) {
      patch['Document Number'] = gid;
      patch['Document Type'] = documentTypeForId(gid);
    }
  }

  const emailRaw = emails[guestIdx] ?? emails[0];
  const email = pickEmailFromTenantField(emailRaw);
  if (email) patch.Email = email;
  const phone = clean(phones[guestIdx] ?? phones[0]);
  if (phone) patch.Telephone = phone;

  const door = clean(tenancyRow.Door);
  if (door) patch['Allocated Room Number'] = door.replace(/^0+(?=\d)/, '') || door;

  return patch;
}

export function manualOverrideForNc(nc) {
  return TENANCY_MANUAL_BY_NC[Number(nc)] || null;
}

export function shouldExcludeNcFromV2(nc) {
  const m = manualOverrideForNc(nc);
  return Boolean(m?.excludeFromV2);
}

function isBlankVal(v) {
  const c = clean(v);
  if (!c) return true;
  return c === '/' || c === '-' || c === '.';
}

export function applyTenancyAndManualFills(out, nc, tenancyLookup, options = {}) {
  const { forceB2bGuestFromTenancy = false } = options;
  const manual = manualOverrideForNc(nc);
  const lookup =
    tenancyLookup?.rows != null
      ? tenancyLookup
      : { byNc: tenancyLookup, byTenantId: new Map(), rows: [] };
  const tenancy = resolveTenancyForCustomer(nc, out, lookup);
  const fromTenancy = mewsPatchFromTenancy(tenancy, out);
  for (const [k, v] of Object.entries(fromTenancy)) {
    if (v == null || isBlankVal(v)) continue;
    if (forceB2bGuestFromTenancy && TENANCY_B2B_COMMERCIAL_SKIP.has(k)) continue;
    if (forceB2bGuestFromTenancy && TENANCY_GUEST_MEWS_FIELDS.includes(k)) {
      out[k] = v;
      continue;
    }
    if (isBlankVal(out[k])) out[k] = v;
  }
  if (manual && !manual.excludeFromV2) {
    for (const [k, v] of Object.entries(manual)) {
      if (k === 'excludeFromV2' || k === 'reason') continue;
      if (v != null && !isBlankVal(v)) out[k] = v;
    }
  }
  if (tenancy && /carabanchel/i.test(clean(tenancy.Property))) {
    if (isBlankVal(out['Address Line 1'])) {
      const door = clean(tenancy.Door);
      out['Address Line 1'] = door ? `The Carabanchel Episode, unit ${door}` : 'The Carabanchel Episode';
    }
    if (isBlankVal(out.City)) out.City = 'Madrid';
    if (isBlankVal(out['Country Code'])) out['Country Code'] = 'ES';
  }
  const companyBlob = `${clean(out['Partner Company'])} ${clean(out['Company Id'])}`.toLowerCase();
  if (companyBlob.includes('integra ascensores')) {
    for (const [k, v] of Object.entries(integraBilling())) {
      if (isBlankVal(out[k])) out[k] = v;
    }
  }
  return out;
}

/** B2B guest identity + room from HouseMonk tenancy export (overrides contract extraction guest fields). */
export function applyB2bTenancyGuestFields(row, nc, lookup = loadTenancyLookup()) {
  const tenancyRow = resolveTenancyForCustomer(nc, row, lookup);
  if (!tenancyRow) return row;
  const patch = mewsB2bGuestPatchFromTenancy(tenancyRow, row);
  const out = { ...row };
  for (const key of TENANCY_GUEST_MEWS_FIELDS) {
    if (patch[key] != null && !isBlankVal(patch[key])) out[key] = clean(patch[key]);
  }
  return out;
}
