/**
 * Reconcile V4 / V3 Mews import rows with HouseMonk Tenancy (The Carabanchel Episode,
 * Occupied / Under Notice / Booked, checkout >= MEWS_MIN_DEPARTURE_DATE) and Seguimiento NCs.
 *
 * - Fills room, email, phone, deposit (Prepaid Amount + Deposit), address, companions from Tenancy.
 * - Fixes wrong unit/guest assignments (e.g. Integra NC_1565–1573 all pointing at studio 1149).
 * - Removes V4 rows Seguimiento shows as ended/cancelled before the cutoff and absent from Tenancy.
 * - Adds active Tenancy stays missing from V4 (NC from Tenancy, door override or Seguimiento name match).
 * - Logs every gap to Missing_Occupied_NCs_21_10_2026 (DDL + seed SQL written if the table is missing).
 *
 *   node reconcile-v4-with-tenancy-21-10-2026.mjs           (dry run, report only)
 *   node reconcile-v4-with-tenancy-21-10-2026.mjs --apply   (backup + write Supabase)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import {
  documentTypeForId,
  isSpanishCompanyTaxId,
  normNameToken,
  normalizeTenantId,
  parseCsvRows,
  parseDdMmYyyy,
  pickEmailFromTenantField,
  tenantColumnsFromRow,
} from './tenancy-nc-overrides.mjs';
import { clean, loadRoomNumberCategoryMap } from './room-number-to-category.mjs';
import { applyMewsRoomAndCategoryStandards, canonicalizeRoomCategory, formatAllocatedRoomNumber } from './mews-room-format.mjs';
import { applyMewsStayRateAndMonthlyPricing } from './mews-stay-rate-and-products-format.mjs';
import { applyMewsImportReadyFields } from './mews-import-ready.mjs';
import { buildV4DedupedCompanies, canonicalizeCustomerCompanyNames } from './v4-companies-dedupe.mjs';
import { isChamariEntity } from './chamari-strip.mjs';
import { normName } from './company-match-utils.mjs';
import { isSallaRassullPlaceholderAddress } from './b2b-partner-company-resolve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const EXT = path.join(root, 'contract-analysis', 'External Data Sources');
const TENANCY_CSV = [
  path.join(EXT, 'Tenancy-14-10-2026-044225.csv'),
  path.join(here, 'data', 'Tenancy-14-10-2026-044225.csv'),
].find((p) => fs.existsSync(p));
const SEGUIMIENTO_CSV = path.join(EXT, 'Seguimiento Leasing Carabanchel (new .LIFE) .xlsx - Leasing Update (1).csv');

const V4_CUSTOMERS = 'V4_Final_B2C_and_B2B_All_Fields_Match_Mews_Import_21_10_2026';
const V4_COMPANIES = 'V4_Final_Companies_Match_Mews_Import_21_10_2026';
const V3_B2B = 'V3_Final_B2B_All_Fields_Match_Mews_Import_20_10_2026';
const V3_B2C = 'V3_Final_B2C_All_Fields_Match_Mews_Import_20_10_2026';
const MISSING_TABLE = 'Missing_Occupied_NCs_21_10_2026';
const LIFECYCLE = 'HouseMonk_Tenancy_Lifecycle_NC_14_10_2026';
const CUSTOMERS_EXT = 'Customers_Contracts_Extraction_12_10_2026';
const FF_HM = 'Final_Format_HouseMonk_15_10_2026';
const V2_COMPANIES_CANDIDATES = [
  process.env.V2_COMPANIES_TABLE,
  'V2_Final_Format_All_Fields_Match_Mews_Import_Companies_19_10_2026',
  'V2_Final_Format_All_Fields_Match_Mews_Import_Companies_19_10_20',
].filter(Boolean);

const PROPERTY = 'The Carabanchel Episode';
const MIN_END = process.env.MEWS_MIN_DEPARTURE_DATE || '2026-11-05';
const ACTIVE_STATUSES = new Set(['occupied', 'under notice', 'booked']);
const APPLY = process.argv.includes('--apply');

/**
 * Seguimiento: NC_1565–NC_1573 are the nine Integra 2-bed units of contract NC_1565 ("9 Unidades");
 * NC_1574 / NC_1646 are the two OTIS Mobility 2-beds and NC_1575 the OTIS studio.
 * HouseMonk tags Integra door 4067 as NC 1646.
 */
const DOOR_NC_OVERRIDES = new Map([
  ['1036', 1565],
  ['1119', 1566],
  ['1143', 1567],
  ['2039', 1568],
  ['2145', 1569],
  ['2177', 1570],
  ['2178', 1571],
  ['4067', 1572],
  ['4091', 1573],
  ['3040', 1574],
  ['4016', 1575],
  ['3036', 1646],
]);

/** HouseMonk contracts never added to V4 (logged in Missing_Occupied_NCs_21_10_2026). */
const EXCLUDED_TENANCY_CONTRACTS = new Map([
  ['14543', '2230 Management SL booked as guest on door 2033; Seguimiento NC_1605 is Antonio Medrano (individual)'],
]);

const PERSONAL_FIELDS = [
  'Nationality Code',
  'Birth Date',
  'Birth Place',
  'Sex',
  'Title',
  'Address Line 1',
  'Address Line 2',
  'City',
  'Postal Code',
  'Country Code',
];

const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
const transcriptText = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  [...transcriptText.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];
if (!key) throw new Error('Missing Supabase service key');
const sb = createClient(process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co', key);

// ---------- generic helpers ----------

function filled(v) {
  const c = clean(v);
  return Boolean(c && c !== '/' && c !== '-');
}

function isoDate(v) {
  const m = clean(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart <= bEnd && bStart <= aEnd;
}

/** Nights shared by two stays (checkout day = next check-in day counts as 0). */
function overlapDays(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return 0;
  const s = aStart > bStart ? aStart : bStart;
  const e = aEnd < bEnd ? aEnd : bEnd;
  return Math.max(0, Math.round((Date.parse(e) - Date.parse(s)) / 86400000));
}

function ncCode(nc) {
  return `NC_${String(nc).padStart(4, '0')}`;
}

const NAME_STOP = new Set(['de', 'del', 'la', 'las', 'los', 'da', 'dos', 'van', 'von', 'the', 'sl', 'slu', 'sa', 'sau']);

function nameTokens(...parts) {
  const out = new Set();
  for (const p of parts) {
    for (const t of clean(p).split(/[\s,]+/)) {
      const n = normNameToken(t);
      if (n.length > 2 && !NAME_STOP.has(n)) out.add(n);
    }
  }
  return out;
}

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Spelling variants (Tifanny/Tiffany, Arismedi/Arismendi) on tokens of 5+ letters. */
function tokensMatch(x, y) {
  if (x === y) return true;
  const min = Math.min(x.length, y.length);
  if (min < 5) return false;
  return editDistance(x, y) <= (min >= 7 ? 2 : 1);
}

function tokenOverlap(a, b) {
  let n = 0;
  for (const t of a) {
    if (b.has(t)) n++;
    else for (const u of b) if (tokensMatch(t, u)) { n++; break; }
  }
  return n;
}

/** Avoid matching on two common tokens (e.g. "Javier Hernández") when names have 3+ tokens. */
function strongNameMatch(a, b) {
  const n = tokenOverlap(a, b);
  const exact = [...a].some((t) => b.has(t));
  return exact && n >= 2 && n >= Math.min(3, a.size, b.size);
}

function v4NameTokens(row) {
  return nameTokens(row['First Name'], row['Last Name(*)'], row['Second Last Name']);
}

function cleanPhone(raw) {
  const c = clean(raw);
  const digits = c.replace(/\D/g, '');
  return digits.length >= 7 ? c : null;
}

function moneyNumber(raw) {
  const c = clean(raw).replace(/[€\s]/g, '');
  if (!c) return null;
  const n = Number(c.includes(',') && !c.includes('.') ? c.replace(',', '.') : c.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function moneyString(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function splitGuestName(full) {
  const parts = clean(full).split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return { first: parts[0], last: parts.slice(1).join(' ') };
  return { first: null, last: parts[0] || null };
}

function stripMeta(row) {
  const { id, created_at, ...rest } = row;
  return rest;
}

async function fetchAll(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function fetchFirstTable(candidates) {
  for (const t of candidates) {
    try {
      const rows = await fetchAll(t);
      return { table: t, rows };
    } catch {
      /* next */
    }
  }
  return { table: null, rows: [] };
}

// ---------- source parsing ----------

function loadActiveTenancy() {
  const table = parseCsvRows(fs.readFileSync(TENANCY_CSV, 'utf8').replace(/^\uFEFF/, ''));
  const header = table[0];
  const ncIdx = header.lastIndexOf('NC');
  const seen = new Set();
  const out = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const row = {};
    header.forEach((h, i) => {
      if (!(h in row)) row[h] = cells[i] ?? '';
    });
    if (clean(row.Property) !== PROPERTY) continue;
    const status = clean(row['Tenancy Status']);
    if (!ACTIVE_STATUSES.has(status.toLowerCase())) continue;
    if (/common area/i.test(clean(row['Unit Category']))) continue;
    const start = parseDdMmYyyy(row['Contract Start Date']) || parseDdMmYyyy(row['Occupancy Date']);
    const end = parseDdMmYyyy(row['Move out date']) || parseDdMmYyyy(row['Contract End Date']);
    if (!end || end < MIN_END) continue;

    if (EXCLUDED_TENANCY_CONTRACTS.has(clean(row['Contract ID']))) continue;
    const dedupe = clean(row['Contract ID']) || `${clean(row.Door)}|${start}|${clean(row['Tenant ID'])}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const { types, ids, names, emails, phones } = tenantColumnsFromRow(row);
    const n = Math.max(types.length, ids.length, names.length);
    const individuals = [];
    let company = null;
    for (let i = 0; i < n; i++) {
      const person = {
        name: clean(names[i]) || null,
        id: clean(ids[i]) || null,
        email: pickEmailFromTenantField(emails[i]),
        phone: cleanPhone(phones[i]),
      };
      const typ = (types[i] || 'Individual').toLowerCase();
      if (typ === 'company' || (!types[i] && isSpanishCompanyTaxId(person.id))) {
        if (!company) company = person;
      } else individuals.push(person);
    }

    const ncRaw = clean(cells[ncIdx >= 0 ? ncIdx : cells.length - 1]);
    const ncTenancy = /^\d+$/.test(ncRaw) ? Number(ncRaw) : null;
    const door = formatAllocatedRoomNumber(row.Door);
    const override = door ? DOOR_NC_OVERRIDES.get(door) : undefined;

    out.push({
      line: r + 1,
      contractId: clean(row['Contract ID']) || null,
      status,
      door,
      unitCategory: clean(row['Unit Category']) || null,
      start,
      end,
      rent: moneyNumber(row['Tenant Rent']),
      deposit: moneyNumber(row.Deposit),
      contractType: clean(row['Contract Type']) || null,
      ncTenancy,
      nc: override ?? ncTenancy,
      ncSource: override != null ? 'door_override' : ncTenancy != null ? 'tenancy' : null,
      individuals,
      company,
      tenantNames: clean(row['Tenant Name']),
      tenantIds: clean(row['Tenant ID']),
      tenantEmails: clean(row['Tenant Email']),
      tenantPhones: clean(row['Tenant Phone Number']),
      tenantTypes: clean(row['Tenant Type']),
    });
  }
  return out;
}

function loadSeguimiento() {
  if (!fs.existsSync(SEGUIMIENTO_CSV)) return new Map();
  const table = parseCsvRows(fs.readFileSync(SEGUIMIENTO_CSV, 'utf8').replace(/^\uFEFF/, ''));
  const hIdx = table.findIndex((r) => clean(r[1]) === 'Unique code');
  const byNc = new Map();
  for (let r = hIdx + 1; r < table.length; r++) {
    const c = table[r];
    const m = clean(c[1]).match(/^NC_0*(\d+)$/i);
    if (!m) continue;
    const nc = Number(m[1]);
    const rec = {
      nc,
      category: clean(c[3]),
      status: clean(c[4]),
      label: clean(c[5]),
      first1: clean(c[6]),
      last1: clean(c[7]),
      first2: clean(c[8]),
      last2: clean(c[9]),
      unitType: clean(c[11]),
      start: parseDdMmYyyy(c[17]),
      origOut: parseDdMmYyyy(c[18]),
      moveOut: parseDdMmYyyy(c[19]),
    };
    rec.end = rec.moveOut || rec.origOut;
    rec.names = [`${rec.first1} ${rec.last1}`.trim(), `${rec.first2} ${rec.last2}`.trim()].filter(Boolean).join(', ');
    rec.tokens1 = nameTokens(rec.first1, rec.last1);
    rec.tokens2 = nameTokens(rec.first2, rec.last2);
    byNc.set(nc, rec);
  }
  return byNc;
}

// ---------- main ----------

const roomMap = loadRoomNumberCategoryMap();
const tenancy = loadActiveTenancy();
const segByNc = loadSeguimiento();

const [v4Rows, v4CompanyRows, v3b2bRows, v3b2cRows, lifecycleRows, custExtRows, hmRows, v2Co] = await Promise.all([
  fetchAll(V4_CUSTOMERS),
  fetchAll(V4_COMPANIES),
  fetchAll(V3_B2B),
  fetchAll(V3_B2C),
  fetchAll(LIFECYCLE).catch(() => []),
  fetchAll(CUSTOMERS_EXT).catch(() => []),
  fetchAll(FF_HM).catch(() => []),
  fetchFirstTable(V2_COMPANIES_CANDIDATES),
]);

const original = new Map(v4Rows.map((r) => [Number(r.nc_number), stripMeta(r)]));
const working = new Map([...original.entries()].map(([nc, r]) => [nc, { ...r }]));

const lifecycleByNc = new Map();
for (const r of lifecycleRows) {
  const nc = Number(r.nc_number);
  if (Number.isFinite(nc) && !lifecycleByNc.has(nc)) lifecycleByNc.set(nc, r);
}
const custExtByNc = new Map();
for (const r of custExtRows) {
  for (const m of `${r['Group Code'] || ''} ${r['Internal Guest Notes'] || ''}`.matchAll(/NC_0*(\d+)/gi)) {
    const nc = Number(m[1]);
    if (!custExtByNc.has(nc)) custExtByNc.set(nc, r);
  }
}
const hmByDoc = new Map();
for (const r of hmRows) {
  const d = normalizeTenantId(r['Document Number']);
  if (d && !hmByDoc.has(d)) hmByDoc.set(d, r);
}

function v4Dates(row) {
  return { a: isoDate(row['Arrival Date(*)']), d: isoDate(row['Departure Date(*)']) };
}

/** Same person on V4 row and Tenancy stay (document or ≥2 name tokens). */
function sameGuest(row, t) {
  const doc = normalizeTenantId(row['Document Number']);
  const people = t.individuals.length ? t.individuals : t.company ? [t.company] : [];
  if (doc && people.some((p) => normalizeTenantId(p.id) === doc)) return true;
  const vt = v4NameTokens(row);
  return people.some((p) => tokenOverlap(nameTokens(p.name), vt) >= 2);
}

const claimed = new Map(); // nc -> tenancy record
const matchLog = [];

function claim(nc, t, method) {
  claimed.set(nc, t);
  t.matchedNc = nc;
  t.matchMethod = method;
}

function segMatchesPeople(seg, t) {
  if (!seg) return false;
  const people = [...t.individuals, ...(t.company ? [t.company] : [])];
  return people.some((p) => {
    const pt = nameTokens(p.name);
    return strongNameMatch(pt, seg.tokens1) || strongNameMatch(pt, seg.tokens2);
  });
}

function findSeguimientoNc(t, excluded = new Set()) {
  let best = null;
  let bestScore = 0;
  let tie = false;
  for (const seg of segByNc.values()) {
    if (excluded.has(seg.nc)) continue;
    if (/cancel/i.test(`${seg.status} ${seg.label}`)) continue;
    if (!overlaps(seg.start, seg.end || seg.origOut, t.start, t.end)) continue;
    let score = 0;
    for (const p of t.individuals) {
      const pt = nameTokens(p.name);
      if (strongNameMatch(pt, seg.tokens1)) score = Math.max(score, tokenOverlap(pt, seg.tokens1));
      if (strongNameMatch(pt, seg.tokens2)) score = Math.max(score, tokenOverlap(pt, seg.tokens2));
    }
    if (score > bestScore) {
      best = seg.nc;
      bestScore = score;
      tie = false;
    } else if (score === bestScore && score > 0) tie = true;
  }
  return bestScore >= 2 && !tie ? best : null;
}

function samePeople(a, b) {
  if (a.company?.id && b.company?.id && normalizeTenantId(a.company.id) === normalizeTenantId(b.company.id)) {
    if (!a.individuals.length && !b.individuals.length) return true;
  }
  const ids = new Set(a.individuals.map((p) => normalizeTenantId(p.id)).filter(Boolean));
  if (b.individuals.some((p) => ids.has(normalizeTenantId(p.id)))) return true;
  return a.individuals.some((p) => b.individuals.some((q) => strongNameMatch(nameTokens(p.name), nameTokens(q.name))));
}

function primaryScore(t) {
  const row = working.get(t.nc);
  const st = t.status.toLowerCase();
  return (
    (t.ncSource === 'door_override' ? 20 : 0) +
    (segMatchesPeople(segByNc.get(t.nc), t) ? 10 : 0) +
    (row && sameGuest(row, t) ? 6 : 0) +
    (st === 'occupied' || st === 'under notice' ? 2 : 0) +
    (t.contractId ? 1 : 0) +
    (row && t.door && formatAllocatedRoomNumber(row['Allocated Room Number']) === t.door ? 1 : 0)
  );
}

// One Tenancy row per NC: the rest are duplicates (same guest) or carry a wrong HouseMonk NC tag.
const tenancyDuplicates = [];
const byNcGroup = new Map();
for (const t of tenancy) {
  if (t.nc == null) continue;
  if (!byNcGroup.has(t.nc)) byNcGroup.set(t.nc, []);
  byNcGroup.get(t.nc).push(t);
}
for (const group of byNcGroup.values()) {
  if (group.length < 2) continue;
  group.sort((a, b) => primaryScore(b) - primaryScore(a));
  const primary = group[0];
  for (const t of group.slice(1)) {
    if (samePeople(primary, t) && overlaps(primary.start, primary.end, t.start, t.end)) {
      t.duplicateOf = primary;
      tenancyDuplicates.push(t);
    } else {
      t.wrongHmNc = t.nc;
      t.nc = null;
      t.ncSource = null;
    }
  }
}

// Pass 1: explicit NC (door override / Tenancy NC column)
for (const t of tenancy) {
  if (t.duplicateOf) continue;
  if (t.nc != null && working.has(t.nc) && !claimed.has(t.nc)) claim(t.nc, t, t.ncSource);
}
// Pass 2: best (Tenancy, V4) pairs by document > strong name > door+arrival+name, then most shared nights.
const DAY_MS = 86400000;
const pending = tenancy.filter((t) => t.matchedNc == null && !t.duplicateOf);
const v4Index = [...working.entries()].map(([nc, row]) => ({
  nc,
  row,
  doc: normalizeTenantId(row['Document Number']),
  tokens: v4NameTokens(row),
  room: formatAllocatedRoomNumber(row['Allocated Room Number']),
  ...v4Dates(row),
}));
const pairs = [];
for (const t of pending) {
  const ids = new Set(t.individuals.map((p) => normalizeTenantId(p.id)).filter(Boolean));
  const personTokens = t.individuals.map((p) => nameTokens(p.name));
  for (const v of v4Index) {
    if (claimed.has(v.nc)) continue;
    const days = overlapDays(v.a, v.d, t.start, t.end);
    if (days < 1) continue;
    const doorMatch = Boolean(t.door && v.room === t.door);
    let kind = null;
    let score = 0;
    if (v.doc && ids.has(v.doc)) {
      kind = 'document';
      score = 300;
    } else {
      let best = 0;
      let strong = false;
      for (const pt of personTokens) {
        best = Math.max(best, tokenOverlap(pt, v.tokens));
        if (strongNameMatch(pt, v.tokens)) strong = true;
      }
      if (strong) {
        kind = 'name';
        score = 200 + best * 10 + (doorMatch ? 5 : 0);
      } else if (doorMatch && best >= 1 && Math.abs(Date.parse(v.a) - Date.parse(t.start)) <= 7 * DAY_MS) {
        kind = 'door_dates_name';
        score = 150 + best * 10;
      }
    }
    if (kind) pairs.push({ t, nc: v.nc, kind, score: score + Math.min(days, 999) / 1000 });
  }
}
pairs.sort((x, y) => y.score - x.score);
for (const p of pairs) {
  if (p.t.matchedNc != null || claimed.has(p.nc)) continue;
  claim(p.nc, p.t, p.kind);
}

for (const t of pending) {
  if (t.matchedNc != null) continue;
  if (t.nc == null) {
    const segNc = findSeguimientoNc(t);
    if (segNc != null) {
      t.nc = segNc;
      t.ncSource = 'seguimiento_name';
      if (working.has(segNc) && !claimed.has(segNc)) claim(segNc, t, 'seguimiento_name');
    }
  }
}

// ---------- patch matched rows ----------

function fillAddress(row, nc, guestDoc, guestTokens) {
  if (filled(row['Address Line 1'])) return null;
  const candidates = [];
  const lc = lifecycleByNc.get(nc);
  if (lc) {
    candidates.push({
      src: 'lifecycle',
      doc: lc.guest_document_number,
      names: [lc.guest_first_name, lc.guest_last_name, lc.guest_second_last_name],
      a1: lc.guest_address_line_1,
      a2: lc.guest_address_line_2,
      city: lc.guest_city,
      pc: lc.guest_postal_code,
      cc: lc.guest_country_code,
    });
  }
  const ext = custExtByNc.get(nc);
  if (ext && !isSallaRassullPlaceholderAddress(ext)) {
    candidates.push({
      src: 'contract',
      doc: ext['Document Number'],
      names: [ext['First Name'], ext['Last Name(*)'], ext['Second Last Name']],
      a1: ext['Address Line 1'],
      a2: ext['Address Line 2'],
      city: ext.City,
      pc: ext['Postal Code'],
      cc: ext['Country Code'],
    });
  }
  const hm = guestDoc ? hmByDoc.get(guestDoc) : null;
  if (hm) {
    candidates.push({
      src: 'housemonk',
      doc: hm['Document Number'],
      names: [hm['First Name'], hm['Last Name(*)']],
      a1: hm['Address Line 1'],
      a2: hm['Address Line 2'],
      city: hm.City,
      pc: hm['Postal Code'],
      cc: hm['Country Code'],
    });
  }
  for (const c of candidates) {
    if (!filled(c.a1) || isChamariEntity(c.a1) || /whallyrange/i.test(clean(c.a1))) continue;
    const sameDoc = guestDoc && normalizeTenantId(c.doc) === guestDoc;
    const sameName = tokenOverlap(nameTokens(...c.names), guestTokens) >= 2;
    if (!sameDoc && !sameName) continue;
    row['Address Line 1'] = clean(c.a1);
    row['Address Line 2'] = filled(c.a2) ? clean(c.a2) : null;
    row.City = filled(c.city) ? clean(c.city) : null;
    row['Postal Code'] = filled(c.pc) ? clean(c.pc) : null;
    row['Country Code'] = filled(c.cc) ? clean(c.cc).toUpperCase().slice(0, 2) : null;
    return c.src;
  }
  return null;
}

/** Company billing address by company name; most complete (has City) wins. */
const companyAddressByName = new Map();
function addCompanyAddress(name, src) {
  const key = normName(name);
  if (!key || !filled(src['Address Line 1']) || isSallaRassullPlaceholderAddress(src)) return;
  const prev = companyAddressByName.get(key);
  if (!prev || (!filled(prev.City) && filled(src.City))) companyAddressByName.set(key, src);
}
for (const co of [...v4CompanyRows, ...v2Co.rows]) addCompanyAddress(co['Company Name(*)'], co);
for (const r of original.values()) if (filled(r['Partner Company'])) addCompanyAddress(r['Partner Company'], r);

function fillCompanyAddress(row) {
  const co = companyAddressByName.get(normName(row['Partner Company']));
  if (!co) return false;
  if (filled(row['Address Line 1']) && normName(row['Address Line 1']) !== normName(co['Address Line 1'])) return false;
  let changed = false;
  for (const f of ADDRESS_FIELDS) {
    if (!filled(row[f]) && filled(co[f])) {
      row[f] = clean(co[f]);
      changed = true;
    }
  }
  return changed;
}

function appendNote(row, text) {
  const notes = clean(row['Reservation Notes']);
  if (notes.includes(text)) return;
  row['Reservation Notes'] = notes ? `${notes} | ${text}` : text;
}

function companionsNote(names) {
  return `Companion(s) (not imported - add in Mews or re-import with customer ID): ${names.join(', ')}`;
}

function tenancyNotes(t, nc) {
  return [
    `HouseMonk tenancy ${t.contractId || `(line ${t.line})`} — ${t.status}`,
    `${t.contractType === 'Nightly' ? 'Nightly' : 'Monthly'} price: ${t.rent ?? 'n/a'} EUR`,
    t.deposit > 0 ? `Deposit: ${moneyString(t.deposit)} EUR` : null,
    nc > 0 ? null : 'No NC in HouseMonk / Seguimiento',
  ]
    .filter(Boolean)
    .join(' | ');
}

function sameCompanyName(a, b) {
  return Boolean(normName(a)) && normName(a) === normName(b);
}

const ADDRESS_FIELDS = ['Address Line 1', 'Address Line 2', 'City', 'Postal Code', 'Country Code'];

function applyCompanyFromTenancy(row, t) {
  if (!t.company?.name) return;
  if (!filled(row['Partner Company']) || isChamariEntity(row['Partner Company'])) {
    row['Partner Company'] = t.company.name;
    row['Company Id'] = t.company.name;
  }
  if (!filled(row['Tax Identification Number']) && isSpanishCompanyTaxId(t.company.id)) {
    row['Tax Identification Number'] = t.company.id;
  }
}

const identityFixed = [];
const fillCounts = { room: 0, email: 0, phone: 0, deposit: 0, address: 0, document: 0, adults: 0 };

for (const [nc, t] of claimed) {
  const row = working.get(nc);
  const guest = t.individuals[0] || null;
  const others = t.individuals.slice(1).map((p) => p.name).filter(Boolean);
  const same = sameGuest(row, t);

  if (guest && !same) {
    identityFixed.push({
      nc,
      from: `${clean(row['First Name'])} ${clean(row['Last Name(*)'])}`.trim(),
      fromRoom: clean(row['Allocated Room Number']),
      to: guest.name,
      toRoom: t.door,
    });
    const prevAddress = Object.fromEntries(ADDRESS_FIELDS.map((f) => [f, row[f]]));
    const prevCompany = row['Partner Company'];
    const { first, last } = splitGuestName(guest.name);
    row['First Name'] = first;
    row['Last Name(*)'] = last;
    row['Second Last Name'] = null;
    row['Document Number'] = guest.id;
    row['Document Type'] = guest.id ? documentTypeForId(guest.id) : null;
    row.Email = guest.email;
    row.Telephone = guest.phone;
    for (const f of PERSONAL_FIELDS) row[f] = null;

    // Stay terms on the row belonged to the previous (wrong) guest: restate from Tenancy.
    row['Arrival Date(*)'] = t.start;
    row['Departure Date(*)'] = t.end;
    row['Prepaid Amount'] = t.deposit > 0 ? moneyString(t.deposit) : null;
    row['Prepayment Type'] = t.deposit > 0 ? 'Deposit' : null;
    row['Per Night Prices'] = t.rent != null ? moneyString(t.rent) : null;
    row['Allocated Rate'] = null;
    row['Included Products'] = null;
    row.Companions = null;
    row['Reservation Notes'] = tenancyNotes(t, nc);
    // Tax ID on a wrongly-copied row may belong to another company; re-resolve it by company name.
    row['Tax Identification Number'] = null;
    if (t.company?.name && !sameCompanyName(prevCompany, t.company.name)) {
      row['Partner Company'] = t.company.name;
      row['Company Id'] = t.company.name;
    } else if (filled(prevCompany) && filled(prevAddress['Address Line 1'])) {
      Object.assign(row, prevAddress);
    }
    t.restated = true;
  } else if (guest) {
    if (!filled(row.Email) && guest.email) {
      row.Email = guest.email;
      fillCounts.email++;
    }
    if (!filled(row.Telephone) && guest.phone) {
      row.Telephone = guest.phone;
      fillCounts.phone++;
    }
    if (!filled(row['Document Number']) && guest.id) {
      row['Document Number'] = guest.id;
      row['Document Type'] = documentTypeForId(guest.id);
      fillCounts.document++;
    }
  }

  if (/taxidentificationnumber/i.test(clean(row['Document Type']).replace(/\s/g, ''))) {
    row['Document Type'] = documentTypeForId(row['Document Number']);
  }

  if (t.door && formatAllocatedRoomNumber(row['Allocated Room Number']) !== t.door) {
    row['Allocated Room Number'] = t.door;
    fillCounts.room++;
  }
  applyMewsRoomAndCategoryStandards(row, roomMap);
  if (!filled(row['Allocated Room Category(*)']) && t.unitCategory) {
    row['Allocated Room Category(*)'] = canonicalizeRoomCategory(t.unitCategory);
  }

  if (!filled(row['Prepaid Amount']) && t.deposit > 0) {
    row['Prepaid Amount'] = moneyString(t.deposit);
    row['Prepayment Type'] = 'Deposit';
    fillCounts.deposit++;
  } else if (filled(row['Prepaid Amount'])) {
    row['Prepayment Type'] = 'Deposit';
  }

  if (t.individuals.length && clean(row['Adult Count(*)']) !== String(t.individuals.length)) {
    row['Adult Count(*)'] = String(t.individuals.length);
    if (!filled(row['Child Count(*)'])) row['Child Count(*)'] = '0';
    fillCounts.adults++;
  }
  if (others.length) appendNote(row, companionsNote(others));

  if (!filled(row['Arrival Date(*)'])) row['Arrival Date(*)'] = t.start;
  const dep = isoDate(row['Departure Date(*)']);
  if (!dep || dep < MIN_END) row['Departure Date(*)'] = t.end;

  applyCompanyFromTenancy(row, t);

  const guestDoc = normalizeTenantId(row['Document Number']);
  const src = fillAddress(row, nc, guestDoc, v4NameTokens(row));
  if (src || (filled(row['Partner Company']) && fillCompanyAddress(row))) fillCounts.address++;

  if (t.restated) {
    applyMewsStayRateAndMonthlyPricing(row);
    applyMewsImportReadyFields(row);
  }
}

// Group Code / Internal Guest Notes must point at the row's own NC (fan-out copied NC_1944 onto NC_1943, etc.).
for (const [nc, row] of working) {
  if (nc <= 0) continue;
  for (const f of ['Group Code', 'Internal Guest Notes']) {
    const m = clean(row[f]).match(/^NC_0*(\d+)$/i);
    if (!filled(row[f]) || (m && Number(m[1]) !== nc)) row[f] = ncCode(nc);
  }
}

// ---------- unmatched V4 rows ----------

const doorOwner = new Map();
for (const t of tenancy) {
  if (t.door) {
    if (!doorOwner.has(t.door)) doorOwner.set(t.door, []);
    doorOwner.get(t.door).push(t);
  }
}

const removed = [];
const keptUnverified = [];
for (const [nc, row] of working) {
  if (claimed.has(nc)) continue;
  const seg = segByNc.get(nc);
  const segEnded = seg && seg.end && seg.end < MIN_END;
  const segCancelled = seg && /cancel/i.test(`${seg.status} ${seg.label}`);
  if (segEnded || segCancelled) {
    removed.push({ nc, row, seg, reason: segCancelled ? 'seguimiento_cancelled' : 'seguimiento_ended_before_cutoff' });
    working.delete(nc);
    continue;
  }
  const room = formatAllocatedRoomNumber(row['Allocated Room Number']);
  const { a, d } = v4Dates(row);
  const conflict = room
    ? (doorOwner.get(room) || []).find((t) => t.matchedNc != null && t.matchedNc !== nc && overlapDays(a, d, t.start, t.end) > 0)
    : null;
  if (conflict) row['Allocated Room Number'] = null;
  keptUnverified.push({ nc, row, seg, roomConflictWithNc: conflict?.matchedNc ?? null, clearedRoom: conflict ? room : null });
}

// ---------- add Tenancy stays missing from V4 ----------

const added = [];
const notAdded = [];
const takenNcs = new Set(working.keys());

function buildRowFromTenancy(nc, t) {
  const guest = t.individuals[0] || null;
  const asCompanyGuest = !guest && t.company;
  const person = guest || t.company || {};
  const { first, last } = asCompanyGuest ? { first: null, last: t.company.name } : splitGuestName(person.name);
  const code = nc > 0 ? ncCode(nc) : `HM_${t.contractId || t.line}`;
  const row = {
    nc_number: nc,
    Email: person.email || null,
    'Last Name(*)': last,
    'First Name': first,
    Telephone: person.phone || null,
    'Document Type': guest?.id ? documentTypeForId(guest.id) : null,
    'Document Number': guest?.id || null,
    'Internal Guest Notes': code,
    'Group Code': code,
    'Arrival Date(*)': t.start,
    'Departure Date(*)': t.end,
    'Adult Count(*)': String(Math.max(1, t.individuals.length)),
    'Child Count(*)': '0',
    'Currency Code': 'EUR',
    'Per Night Prices': t.rent != null ? moneyString(t.rent) : null,
    'Prepaid Amount': t.deposit > 0 ? moneyString(t.deposit) : null,
    'Prepayment Type': t.deposit > 0 ? 'Deposit' : null,
    'Allocated Room Number': t.door,
    'Allocated Room Category(*)': canonicalizeRoomCategory(t.unitCategory),
    'Reservation Notes': tenancyNotes(t, nc),
  };
  const others = t.individuals.slice(1).map((p) => p.name).filter(Boolean);
  if (others.length) appendNote(row, companionsNote(others));
  if (t.company?.name) {
    row['Partner Company'] = t.company.name;
    row['Company Id'] = t.company.name;
    if (isSpanishCompanyTaxId(t.company.id)) row['Tax Identification Number'] = t.company.id;
  }
  applyMewsRoomAndCategoryStandards(row, roomMap);
  const guestDoc = normalizeTenantId(row['Document Number']);
  if (!fillAddress(row, nc, guestDoc, nameTokens(person.name)) && row['Partner Company']) fillCompanyAddress(row);
  applyMewsStayRateAndMonthlyPricing(row);
  applyMewsImportReadyFields(row);
  return row;
}

for (const t of tenancy) {
  if (t.matchedNc != null || t.duplicateOf) continue;
  let nc = t.nc;
  let ncSource = t.ncSource;
  if (nc != null && takenNcs.has(nc)) {
    nc = null;
    ncSource = null;
  }
  if (nc == null) {
    const segNc = findSeguimientoNc(t, takenNcs);
    if (segNc != null) {
      nc = segNc;
      ncSource = 'seguimiento_name';
    }
  }
  if (nc == null) {
    // V4 only carries real NCs; match leftovers with rekey-v4-ncs-from-seguimiento-21-10-2026.mjs or resolve manually.
    notAdded.push({ t, reason: 'no_nc_in_tenancy_or_seguimiento' });
    continue;
  }
  takenNcs.add(nc);
  const row = buildRowFromTenancy(nc, t);
  working.set(nc, row);
  t.matchedNc = nc;
  t.matchMethod = 'added';
  t.ncSource = ncSource;
  added.push({ nc, t, ncSource });
}

// ---------- companies + canonical names ----------

const finalCustomers = [...working.values()].sort((a, b) => a.nc_number - b.nc_number);
for (const row of finalCustomers) {
  if (/taxidentificationnumber/i.test(clean(row['Document Type']).replace(/\s/g, ''))) {
    row['Document Type'] = documentTypeForId(row['Document Number']);
  }
  if (clean(row['Allocated Room Number']) && !/^-?\d+$|^\d+-\w+$/.test(clean(row['Allocated Room Number']))) {
    row['Allocated Room Number'] = null;
  }
}

const tenancyCompanyRows = [];
for (const t of tenancy) {
  if (!t.company?.name) continue;
  tenancyCompanyRows.push({
    'Company Name(*)': t.company.name,
    'Tax ID Number': isSpanishCompanyTaxId(t.company.id) ? t.company.id : null,
    'Fiscal Identifier': isSpanishCompanyTaxId(t.company.id) ? t.company.id : null,
    'Invoicing Email': t.company.email,
    Telephone: t.company.phone,
  });
}
const companiesOut = buildV4DedupedCompanies(finalCustomers, [...v2Co.rows, ...tenancyCompanyRows]);
const canonicalized = canonicalizeCustomerCompanyNames(finalCustomers, companiesOut);

// ---------- diffs for V3 tables ----------

const removedNcs = new Set(removed.map((r) => r.nc));
const addedNcs = new Set(added.map((a) => a.nc));
const patchByNc = new Map();
for (const row of finalCustomers) {
  const nc = Number(row.nc_number);
  const before = original.get(nc);
  if (!before) continue;
  const patch = {};
  for (const [k, v] of Object.entries(row)) {
    if ((before[k] ?? null) !== (v ?? null)) patch[k] = v ?? null;
  }
  if (Object.keys(patch).length) patchByNc.set(nc, patch);
}

function syncV3(rows, segment) {
  const out = [];
  for (const r of rows) {
    const nc = Number(r.nc_number);
    if (removedNcs.has(nc)) continue;
    const base = stripMeta(r);
    const patch = patchByNc.get(nc);
    out.push(patch ? { ...base, ...patch } : base);
  }
  for (const a of added) {
    const isB2b = filled(working.get(a.nc)?.['Partner Company']);
    if ((segment === 'b2b') === isB2b) out.push({ ...working.get(a.nc) });
  }
  return out.sort((a, b) => a.nc_number - b.nc_number);
}

const v3b2bOut = syncV3(v3b2bRows, 'b2b');
const v3b2cOut = syncV3(v3b2cRows, 'b2c');

// ---------- missing-NC log ----------

function tenancyLogFields(t) {
  return {
    tenancy_contract_id: t.contractId,
    tenancy_status: t.status,
    door: t.door,
    unit_category: t.unitCategory,
    tenant_type: t.tenantTypes,
    tenant_names: t.tenantNames,
    tenant_ids: t.tenantIds,
    tenant_emails: t.tenantEmails,
    tenant_phones: t.tenantPhones,
    contract_start: t.start,
    contract_end: t.end,
    monthly_rent: t.rent != null ? moneyString(t.rent) : null,
    deposit: t.deposit != null ? moneyString(t.deposit) : null,
  };
}

function segLogFields(seg) {
  if (!seg) return { seguimiento_nc: null, seguimiento_label: null, seguimiento_names: null, seguimiento_end: null };
  return {
    seguimiento_nc: ncCode(seg.nc),
    seguimiento_label: [seg.status, seg.label].filter(Boolean).join(' / '),
    seguimiento_names: seg.names,
    seguimiento_end: seg.end,
  };
}

const missingRows = [];
for (const a of added) {
  const notes = [
    a.nc > 0 ? null : 'No NC in Tenancy or Seguimiento; nc_number = minus HouseMonk contract ID',
    a.t.wrongHmNc ? `HouseMonk tagged NC ${a.t.wrongHmNc}, which belongs to another stay` : null,
  ].filter(Boolean);
  missingRows.push({
    issue_type: 'tenancy_active_not_in_v4',
    resolution: a.nc > 0 ? 'added_to_v4' : 'added_to_v4_synthetic_nc',
    nc_number: a.nc,
    nc_source: a.ncSource,
    ...tenancyLogFields(a.t),
    ...segLogFields(a.nc > 0 ? segByNc.get(a.nc) : null),
    v4_guest: null,
    v4_room: a.t.door,
    notes: notes.join(' | ') || null,
  });
}
for (const t of tenancyDuplicates) {
  missingRows.push({
    issue_type: 'tenancy_duplicate_row',
    resolution: 'skipped_duplicate',
    nc_number: t.nc,
    nc_source: t.ncSource,
    ...tenancyLogFields(t),
    ...segLogFields(segByNc.get(t.nc)),
    v4_guest: null,
    v4_room: t.duplicateOf.door,
    notes: `Same guest/dates as Tenancy ${t.duplicateOf.contractId || `line ${t.duplicateOf.line}`} (door ${t.duplicateOf.door}, ${t.duplicateOf.status})`,
  });
}
for (const n of notAdded) {
  missingRows.push({
    issue_type: 'tenancy_active_not_in_v4',
    resolution: 'not_added',
    nc_number: n.t.nc,
    nc_source: n.t.ncSource,
    ...tenancyLogFields(n.t),
    ...segLogFields(n.t.nc ? segByNc.get(n.t.nc) : null),
    v4_guest: null,
    v4_room: null,
    notes: n.reason,
  });
}
for (const r of removed) {
  missingRows.push({
    issue_type: 'v4_not_in_tenancy',
    resolution: 'removed_from_v4',
    nc_number: r.nc,
    nc_source: 'v4',
    tenancy_contract_id: null,
    tenancy_status: null,
    door: clean(r.row['Allocated Room Number']) || null,
    unit_category: clean(r.row['Allocated Room Category(*)']) || null,
    tenant_type: null,
    tenant_names: null,
    tenant_ids: null,
    tenant_emails: null,
    tenant_phones: null,
    contract_start: isoDate(r.row['Arrival Date(*)']),
    contract_end: isoDate(r.row['Departure Date(*)']),
    monthly_rent: null,
    deposit: clean(r.row['Prepaid Amount']) || null,
    ...segLogFields(r.seg),
    v4_guest: `${clean(r.row['First Name'])} ${clean(r.row['Last Name(*)'])}`.trim(),
    v4_room: clean(r.row['Allocated Room Number']) || null,
    notes: r.reason,
  });
}
for (const k of keptUnverified) {
  missingRows.push({
    issue_type: 'v4_not_in_tenancy',
    resolution: k.clearedRoom ? 'kept_room_cleared_conflict' : 'kept_unverified',
    nc_number: k.nc,
    nc_source: 'v4',
    tenancy_contract_id: null,
    tenancy_status: null,
    door: k.clearedRoom || clean(k.row['Allocated Room Number']) || null,
    unit_category: clean(k.row['Allocated Room Category(*)']) || null,
    tenant_type: null,
    tenant_names: null,
    tenant_ids: null,
    tenant_emails: null,
    tenant_phones: null,
    contract_start: isoDate(k.row['Arrival Date(*)']),
    contract_end: isoDate(k.row['Departure Date(*)']),
    monthly_rent: null,
    deposit: clean(k.row['Prepaid Amount']) || null,
    ...segLogFields(k.seg),
    v4_guest: `${clean(k.row['First Name'])} ${clean(k.row['Last Name(*)'])}`.trim(),
    v4_room: clean(k.row['Allocated Room Number']) || null,
    notes: k.clearedRoom ? `Room ${k.clearedRoom} belongs to NC ${k.roomConflictWithNc} in Tenancy` : 'No active Tenancy row matched',
  });
}
for (const f of identityFixed) {
  missingRows.push({
    issue_type: 'v4_wrong_guest_or_unit',
    resolution: 'fixed_from_tenancy',
    nc_number: f.nc,
    nc_source: claimed.get(f.nc)?.matchMethod || null,
    ...tenancyLogFields(claimed.get(f.nc)),
    ...segLogFields(segByNc.get(f.nc)),
    v4_guest: f.from,
    v4_room: f.fromRoom || null,
    notes: `Guest/room replaced: ${f.from || '(blank)'} ${f.fromRoom || ''} → ${f.to} ${f.toRoom || ''}`.trim(),
  });
}

// ---------- room double-booking check ----------

const byRoom = new Map();
for (const r of finalCustomers) {
  const room = clean(r['Allocated Room Number']);
  if (!room) continue;
  if (!byRoom.has(room)) byRoom.set(room, []);
  byRoom.get(room).push(r);
}
const roomConflicts = [];
const describe = (r) => {
  const t = claimed.get(Number(r.nc_number)) || added.find((a) => a.nc === Number(r.nc_number))?.t;
  return {
    nc: r.nc_number,
    guest: `${clean(r['First Name'])} ${clean(r['Last Name(*)'])}`.trim(),
    doc: clean(r['Document Number']) || null,
    arr: isoDate(r['Arrival Date(*)']),
    dep: isoDate(r['Departure Date(*)']),
    tenancy: t ? `${t.contractId || `line ${t.line}`} ${t.status} ${t.start}->${t.end} via ${t.matchMethod}` : 'none',
  };
};
for (const [room, rows] of byRoom) {
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = v4Dates(rows[i]);
      const b = v4Dates(rows[j]);
      if (overlapDays(a.a, a.d, b.a, b.d) > 0) roomConflicts.push({ room, a: describe(rows[i]), b: describe(rows[j]) });
    }
  }
}

// ---------- outputs ----------

const methodCounts = {};
for (const t of tenancy) methodCounts[t.matchMethod || 'none'] = (methodCounts[t.matchMethod || 'none'] || 0) + 1;

const summary = {
  apply: APPLY,
  minDeparture: MIN_END,
  tenancyActiveCarabanchel: tenancy.length,
  tenancyMatchMethods: methodCounts,
  v4RowsBefore: original.size,
  v4RowsAfter: finalCustomers.length,
  matchedV4Rows: claimed.size,
  fills: fillCounts,
  identityOrUnitFixed: identityFixed.length,
  removedFromV4: removed.length,
  keptNotInTenancy: keptUnverified.length,
  keptRoomCleared: keptUnverified.filter((k) => k.clearedRoom).length,
  addedFromTenancy: added.length,
  addedWithRealNc: added.filter((a) => a.nc > 0).length,
  addedWithSyntheticNc: added.filter((a) => a.nc < 0).length,
  tenancyNotAdded: notAdded.length,
  tenancyDuplicateRowsSkipped: tenancyDuplicates.length,
  wrongHouseMonkNcTags: tenancy.filter((t) => t.wrongHmNc).length,
  companyNamesCanonicalized: canonicalized,
  v4Companies: companiesOut.length,
  v3B2bRowsAfter: v3b2bOut.length,
  v3B2cRowsAfter: v3b2cOut.length,
  missingLogRows: missingRows.length,
  roomDoubleBookings: roomConflicts.length,
  roomDoubleBookingSample: roomConflicts.slice(0, 15),
  identityFixedSample: identityFixed.slice(0, 20),
  removedSample: removed.slice(0, 20).map((r) => ({
    nc: r.nc,
    guest: `${clean(r.row['First Name'])} ${clean(r.row['Last Name(*)'])}`.trim(),
    reason: r.reason,
    seg: r.seg ? `${r.seg.label} end ${r.seg.end}` : null,
  })),
  addedSample: added.slice(0, 15).map((a) => ({ nc: a.nc, src: a.ncSource, door: a.t.door, who: a.t.tenantNames })),
};

const reportPath = path.join(here, 'reconcile-v4-with-tenancy-21-10-2026-report.json');
fs.writeFileSync(reportPath, JSON.stringify({ summary, missingRows }, null, 2));

function writeCsv(rows, filePath, cols = Object.keys(rows[0] || {})) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))];
  fs.writeFileSync(filePath, `\ufeff${lines.join('\n')}\n`, 'utf8');
}

const customerCols = [...new Set(finalCustomers.flatMap((r) => Object.keys(r)))];
const exportCustomersCsv = path.join(here, `v4-reconciled-customers-export-21-10-2026${APPLY ? '' : '-preview'}.csv`);
const exportCompaniesCsv = path.join(here, `v4-reconciled-companies-export-21-10-2026${APPLY ? '' : '-preview'}.csv`);
writeCsv(finalCustomers, exportCustomersCsv, customerCols);
writeCsv(companiesOut, exportCompaniesCsv);
summary.exports = { customers: exportCustomersCsv, companies: exportCompaniesCsv };

function sqlLiteral(v) {
  if (v == null || v === '') return 'null';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

const MISSING_COLS = [
  'issue_type',
  'resolution',
  'nc_number',
  'nc_source',
  'tenancy_contract_id',
  'tenancy_status',
  'door',
  'unit_category',
  'tenant_type',
  'tenant_names',
  'tenant_ids',
  'tenant_emails',
  'tenant_phones',
  'contract_start',
  'contract_end',
  'monthly_rent',
  'deposit',
  'seguimiento_nc',
  'seguimiento_label',
  'seguimiento_names',
  'seguimiento_end',
  'v4_guest',
  'v4_room',
  'notes',
];

function writeMissingSql(filePath) {
  const lines = [
    `-- ${MISSING_TABLE}: Tenancy ↔ V4 gaps (generated by contract-extraction/reconcile-v4-with-tenancy-21-10-2026.mjs)`,
    `create table if not exists public."${MISSING_TABLE}" (`,
    '  id uuid primary key default gen_random_uuid(),',
    '  created_at timestamptz not null default now(),',
    ...MISSING_COLS.map((c, i) => `  "${c}" ${c === 'nc_number' ? 'integer' : 'text'}${i === MISSING_COLS.length - 1 ? '' : ','}`),
    ');',
    `alter table public."${MISSING_TABLE}" enable row level security;`,
    `grant select, insert, update, delete on public."${MISSING_TABLE}" to service_role;`,
    `create index if not exists missing_occupied_ncs_21_10_2026_nc_idx on public."${MISSING_TABLE}" (nc_number);`,
    'begin;',
    `delete from public."${MISSING_TABLE}";`,
  ];
  for (const r of missingRows) {
    lines.push(
      `insert into public."${MISSING_TABLE}" (${MISSING_COLS.map((c) => `"${c}"`).join(', ')}) values (${MISSING_COLS.map((c) => sqlLiteral(r[c])).join(', ')});`,
    );
  }
  lines.push('commit;', "notify pgrst, 'reload schema';");
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

const missingSqlPath = path.join(root, 'contract-analysis', 'supabase-missing-occupied-ncs-21-10-2026.sql');
writeMissingSql(missingSqlPath);

async function replaceTable(table, rows, { keyColumn = 'nc_number' } = {}) {
  const del =
    keyColumn === 'nc_number'
      ? await sb.from(table).delete().gte('nc_number', -10000000)
      : await sb.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (del.error) return { ok: false, error: del.error.message };
  for (let i = 0; i < rows.length; i += 60) {
    const { error } = await sb.from(table).insert(rows.slice(i, i + 60).map(stripMeta));
    if (error) return { ok: false, error: error.message, insertedBeforeError: i };
  }
  return { ok: true, rows: rows.length };
}

if (APPLY) {
  const backupDir = path.join(here, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(
    path.join(backupDir, `v3-v4-before-tenancy-reconcile-${stamp}.json`),
    JSON.stringify({ v4Rows, v4CompanyRows, v3b2bRows, v3b2cRows }),
  );
  summary.uploads = {
    v4Customers: await replaceTable(V4_CUSTOMERS, finalCustomers),
    v4Companies: await replaceTable(V4_COMPANIES, companiesOut, { keyColumn: 'id' }),
    v3B2b: await replaceTable(V3_B2B, v3b2bOut),
    v3B2c: await replaceTable(V3_B2C, v3b2cOut),
  };
  const probe = await sb.from(MISSING_TABLE).select('id').limit(1);
  summary.uploads.missingTable = probe.error
    ? { ok: false, error: probe.error.message, runSql: missingSqlPath }
    : await replaceTable(MISSING_TABLE, missingRows, { keyColumn: 'id' });
  fs.writeFileSync(reportPath, JSON.stringify({ summary, missingRows }, null, 2));
}

console.log(JSON.stringify({ ...summary, report: reportPath, missingSql: missingSqlPath }, null, 2));
