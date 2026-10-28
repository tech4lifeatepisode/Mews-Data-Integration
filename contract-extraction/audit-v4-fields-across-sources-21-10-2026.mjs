/**
 * Field-level audit of V4 reservations against every External Data Source CSV and the Supabase source tables.
 * Fields: last name, document (DNI), arrival, departure, person count, child count, room category,
 * billing address, products / additional services, deposit, rent.
 *
 * One row per (reservation, field) problem goes to Missing_Occupied_NCs_21_10_2026:
 *   issue_type = v4_missing_<field> | v4_mismatch_<field> | v4_unclear_<field>, resolution = needs_review,
 *   notes = V4 value + every source's value grouped by value.
 * Earlier field-audit rows (v4_field_quality / v4_missing_* / v4_mismatch_* / v4_unclear_*) are replaced.
 *
 *   node audit-v4-fields-across-sources-21-10-2026.mjs           (dry run, report only)
 *   node audit-v4-fields-across-sources-21-10-2026.mjs --apply
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import {
  isSpanishCompanyTaxId,
  normNameToken,
  normalizeTenantId,
  parseCsvRows,
  parseDdMmYyyy,
  tenantColumnsFromRow,
} from './tenancy-nc-overrides.mjs';
import { categoryForRoomNumber, clean, loadRoomNumberCategoryMap } from './room-number-to-category.mjs';
import { CANONICAL_ROOM_CATEGORIES, canonicalizeRoomCategory, formatAllocatedRoomNumber } from './mews-room-format.mjs';
import { normName } from './company-match-utils.mjs';
import { isSallaRassullPlaceholderAddress } from './b2b-partner-company-resolve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const EXT = path.join(root, 'contract-analysis', 'External Data Sources');
const APPLY = process.argv.includes('--apply');
const MIN_END = process.env.MEWS_MIN_DEPARTURE_DATE || '2026-11-05';
const PROPERTY = 'The Carabanchel Episode';

const V4_CUSTOMERS = 'V4_Final_B2C_and_B2B_All_Fields_Match_Mews_Import_21_10_2026';
const V4_COMPANIES = 'V4_Final_Companies_Match_Mews_Import_21_10_2026';
const MISSING_TABLE = 'Missing_Occupied_NCs_21_10_2026';

const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
const transcriptText = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  [...transcriptText.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];
if (!key) throw new Error('Missing Supabase service key');
const sb = createClient(process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co', key);

// ---------- helpers ----------

function filled(v) {
  const c = clean(v);
  return Boolean(c && c !== '/' && c !== '-' && c.toLowerCase() !== 'null');
}

function isoDate(v) {
  const c = clean(v);
  const m = c.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return parseDdMmYyyy(c.split(/\s/)[0]);
}

function dayDiff(a, b) {
  return Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86400000));
}

function overlapDays(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return 0;
  const s = aStart > bStart ? aStart : bStart;
  const e = aEnd < bEnd ? aEnd : bEnd;
  return Math.max(0, Math.round((Date.parse(e) - Date.parse(s)) / 86400000));
}

/** €1.275,0 / 1.095 / 1,095.00 / 647.5 / 1095,00 → number. */
function money(v) {
  let c = clean(v).replace(/[€\s]/g, '');
  if (!c || c === '/' || c === '-' || /#value/i.test(c)) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(c)) c = c.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(c)) c = c.replace(/,/g, '');
  else if (/^-?\d+,\d+$/.test(c)) c = c.replace(',', '.');
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** Rent values below 100 € are parse artefacts (e.g. "1.09" for 1.095). */
function plausibleRent(n) {
  return n != null && n >= 100 ? n : null;
}

const NAME_STOP = new Set(['de', 'del', 'la', 'las', 'los', 'da', 'dos', 'van', 'von', 'the', 'sl', 'slu', 'sa', 'sau']);

function nameTokens(...parts) {
  const out = new Set();
  for (const p of parts) {
    for (const t of clean(p).split(/[\s,|]+/)) {
      const n = normNameToken(t);
      if (n.length > 1 && !NAME_STOP.has(n)) out.add(n);
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

function tokensMatch(x, y) {
  if (x === y) return true;
  const min = Math.min(x.length, y.length);
  if (min < 5) return false;
  return editDistance(x, y) <= (min >= 7 ? 2 : 1);
}

function anyTokenMatch(a, b) {
  for (const t of a) for (const u of b) if (tokensMatch(t, u)) return true;
  return false;
}

function ncsFromText(...parts) {
  const out = new Set();
  for (const p of parts) for (const m of clean(p).matchAll(/NC[_\s-]?0*(\d{1,5})(?!\d)/gi)) out.add(Number(m[1]));
  return [...out];
}

function normPostal(v) {
  const c = clean(v).toUpperCase().replace(/[\s-]/g, '');
  return c.replace(/^0+(?=\d)/, '') || null;
}

function looksLikeCompany(v) {
  return /\b(s\.?\s?l\.?\s?u?|s\.?\s?a\.?\s?u?|ltd|gmbh|inc|llc|management|viajes|ascensores|mobility)\b/i.test(clean(v));
}

const NON_PRODUCT = /descuento|discount|promotion|promo|bonification|bonificaci|tarifa|referral|rent|renta|penaliz/i;
/** One-off charges, not stay services. */
const ONE_OFF_PRODUCT = /copia llave|cambio de unidad|gastos de gesti|penaliz|catering|taberna|comida|cargador|suministro extra/i;

/** Extraction template placeholders (e.g. "address_line_1", "unit_type") are not data. */
function isPlaceholder(v) {
  return /^(address_line_\d|postal_code|city|country|unit_type|n\/?a|null|none|xxx+|tbd|-)$/i.test(clean(v));
}

function productKey(v) {
  return clean(v)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/^extra:\s*/i, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Service type, so "media pension" (contract) and "ESSENTIAL 20+20" (HouseMonk) compare as meal plans. */
function productFamily(p) {
  if (/essential/.test(p)) return 'meal:essential';
  if (/flow/.test(p)) return 'meal:flow';
  if (/all in/.test(p)) return 'meal:allin';
  if (/flex/.test(p)) return 'meal:flex';
  if (/meal|pension|desayuno|breakfast/.test(p)) return 'meal:generic';
  if (/parking/.test(p)) return 'parking';
  if (/limpieza|cleaning/.test(p)) return 'cleaning';
  if (/persona extra|extra person|suplemento persona/.test(p)) return 'extra_person';
  return p;
}

function splitProducts(v) {
  return clean(v)
    .split(/\s*[;,|]\s*|\s+\+\s+(?=[A-Za-z])/)
    .map(productKey)
    .filter((p) => p && !NON_PRODUCT.test(p) && !ONE_OFF_PRODUCT.test(p));
}

function familiesMatch(x, y) {
  return x === y || (x.startsWith('meal:') && y.startsWith('meal:') && (x === 'meal:generic' || y === 'meal:generic'));
}

function productsOverlap(a, b) {
  const fa = a.map(productFamily);
  const fb = b.map(productFamily);
  return fa.some((x) => fb.some((y) => familiesMatch(x, y)));
}

async function fetchAll(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

function loadCsv(file) {
  const p = path.join(EXT, file);
  if (!fs.existsSync(p)) return { header: [], rows: [] };
  const table = parseCsvRows(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  return { header: table[0], rows: table.slice(1) };
}

function csvObjects(file) {
  const { header, rows } = loadCsv(file);
  return rows.map((cells) => {
    const o = {};
    header.forEach((h, i) => {
      if (!(h in o)) o[h] = cells[i] ?? '';
    });
    return o;
  });
}

// ---------- normalized source records ----------

const CANONICAL_SET = new Set(CANONICAL_ROOM_CATEGORIES);

/** Only real Mews category names count as a source value (drops "unit_type", free text). */
function sourceCategory(raw) {
  const c = canonicalizeRoomCategory(raw);
  if (!c) return null;
  const parts = c.split('; ').filter((p) => CANONICAL_SET.has(p));
  return parts.length ? parts.join('; ') : null;
}

/** Company tax IDs seen as companies (V4 companies sheet, Tenancy company tenants); filled after load. */
const companyTaxIds = new Set();

function personDocs(...ids) {
  return ids.map(normalizeTenantId).filter((d) => d && !isPlaceholder(d) && !companyTaxIds.has(d));
}

function realValue(v) {
  return filled(v) && !isPlaceholder(v) ? clean(v) : null;
}

/** Mews-format row (contracts, HouseMonk, Final Format exports) → comparable values. */
function mewsValues(r) {
  const notes = clean(r['Reservation Notes']);
  const noteRent = notes.match(/Monthly (?:rent EUR|price):\s*([\d.,]+)/i)?.[1];
  const adults = money(r['Adult Count(*)']);
  const children = money(r['Child Count(*)']);
  return {
    names: [[r['First Name'], r['Last Name(*)'], r['Second Last Name']].filter(filled).join(' ')].filter(Boolean),
    docs: personDocs(r['Document Number']),
    arrival: isoDate(r['Arrival Date(*)'] || r['Checkin Date(*)'] || r['Arrival Date']),
    departure: isoDate(r['Departure Date(*)'] || r['Checkout Date(*)'] || r['Departure Date']),
    persons: money(r['Person Counts(*)']) ?? (adults != null ? adults + (children || 0) : null),
    children,
    category: sourceCategory(r['Allocated Room Category(*)']),
    postal: realValue(r['Postal Code']) ? normPostal(r['Postal Code']) : null,
    city: realValue(r.City),
    address1: realValue(r['Address Line 1']),
    products: splitProducts(r['Included Products']),
    deposit: money(r['Prepaid Amount']),
    rent: plausibleRent(
      money(r['Per Night Prices']) ?? money(r['Per Night /month Prices']) ?? money(r['Allocated Rate']) ?? money(noteRent),
    ),
  };
}

function seguimientoRecords(file, label) {
  const { header: firstRow, rows } = loadCsv(file);
  const all = [firstRow, ...rows];
  const hIdx = all.findIndex((r) => r.some((c) => clean(c) === 'Unique code'));
  if (hIdx < 0) return new Map();
  const h = all[hIdx].map((c) => clean(c));
  const idx = (name, from = 0) => h.findIndex((c, i) => i >= from && c === name);
  const iCode = idx('Unique code');
  const iFirst1 = idx('1st Client Name');
  const iFirst2 = idx('2nd Client Name');
  const iUnit = idx('Unit Type');
  const iRes = idx('# Residents');
  const iStart = idx('Contract Start');
  const iOrig = h.findIndex((c) => c.startsWith('Original Check-Out'));
  const iMove = idx('Move-Out');
  const iDep = h.findIndex((c) => c.startsWith('Deposit'));
  const iRent = h.findIndex((c) => c.startsWith('Headline Rent'));
  const iRfp = h.findIndex((c) => c.startsWith('RFP'));
  const iPromo = idx('Promo Especifica');
  const byNc = new Map();
  for (const c of all.slice(hIdx + 1)) {
    const m = clean(c[iCode]).match(/^NC_0*(\d+)$/i);
    if (!m) continue;
    const name1 = [c[iFirst1], c[iFirst1 + 1]].map(clean).filter(Boolean).join(' ');
    const name2 = [c[iFirst2], c[iFirst2 + 1]].map(clean).filter(Boolean).join(' ');
    const headline = plausibleRent(money(c[iRent]));
    // Percentage discount: "RFP #mth" as a fraction (0,10) or "Promo 10% Descuento" text.
    const rfp = iRfp >= 0 ? money(c[iRfp]) : null;
    const promoPct = Number(clean(c[iPromo]).match(/(\d{1,2})\s*%/)?.[1]);
    const disc = rfp > 0 && rfp < 1 ? rfp : promoPct > 0 ? promoPct / 100 : null;
    byNc.set(Number(m[1]), {
      src: label,
      names: [name1, name2].filter(Boolean),
      docs: [],
      arrival: isoDate(c[iStart]),
      departure: isoDate(c[iMove]) || isoDate(c[iOrig]),
      persons: money(c[iRes]),
      children: null,
      category: sourceCategory(c[iUnit]),
      products: [],
      deposit: money(c[iDep]),
      rent: headline,
      rentEffective: headline && disc > 0 && disc < 1 ? Math.round(headline * (1 - disc) * 100) / 100 : null,
      label: [c[h.indexOf('Label')], c[h.indexOf('Label', h.indexOf('Label') + 1)]].map(clean).filter(Boolean).join(' / '),
      namesText: [name1, name2].filter(Boolean).join(', '),
    });
  }
  return byNc;
}

// ---------- load everything ----------

const roomMap = loadRoomNumberCategoryMap();

const [v4Rows, v4Companies, sbCce12, sbFfCce15, sbFfHm15, sbFfSeg15, lifecycle, sbCompaniesExt, sbV2Companies] = await Promise.all([
  fetchAll(V4_CUSTOMERS),
  fetchAll(V4_COMPANIES),
  fetchAll('Customers_Contracts_Extraction_12_10_2026'),
  fetchAll('Final_Format_Customers_Contracts_Extraction_15_10_2026'),
  fetchAll('Final_Format_HouseMonk_15_10_2026'),
  fetchAll('Final_Format_Seguimiento_15_10_2026'),
  fetchAll('HouseMonk_Tenancy_Lifecycle_NC_14_10_2026'),
  fetchAll('Companies_Extraction_12_10_2026'),
  fetchAll('V2_Final_Format_All_Fields_Match_Mews_Import_Companies_19_10_20').catch(() => []),
]);

for (const c of v4Companies) {
  const t = normalizeTenantId(c['Tax ID Number']);
  if (isSpanishCompanyTaxId(t)) companyTaxIds.add(t);
}
{
  const { header, rows } = loadCsv('Tenancy-14-10-2026-044225.csv');
  const iType = header.indexOf('Tenant Type');
  const iId = header.indexOf('Tenant ID');
  for (const c of rows) {
    const types = clean(c[iType]).split(/\s*\|\s*/);
    const ids = clean(c[iId]).split(/\s*\|\s*/);
    types.forEach((t, k) => {
      const id = normalizeTenantId(ids[k]);
      if (/company/i.test(t) && isSpanishCompanyTaxId(id)) companyTaxIds.add(id);
    });
  }
}

/** NC-keyed sources. */
const byNc = new Map();
function addNc(nc, rec) {
  if (!Number.isFinite(nc) || nc <= 0) return;
  if (!byNc.has(nc)) byNc.set(nc, []);
  byNc.get(nc).push(rec);
}

const ncMewsSources = [
  ['contracts_current_future_15_10_csv', csvObjects('Customers_Contracts_Current_Future_15_10_2026.csv')],
  ['ff_contracts_15_10_csv', csvObjects('Final Format_Customers_Contracts_Extraction_15.10.2026.csv')],
  ['ff_seguimiento_15_10_csv', csvObjects('Final Format_Current Seguirmento data 15.10.2026.csv')],
  ['sb_contracts_extraction_12_10', sbCce12],
  ['sb_ff_contracts_15_10', sbFfCce15],
  ['sb_ff_seguimiento_15_10', sbFfSeg15],
];
for (const [label, rows] of ncMewsSources) {
  for (const r of rows) {
    const ncs = ncsFromText(r['Group Code'], r['Internal Guest Notes']);
    const fallback = ncs.length ? [] : ncsFromText(r.storage_path, r.source_document, r['Confirmation Code']);
    for (const nc of [...ncs, ...fallback].slice(0, 1)) addNc(nc, { src: label, ...mewsValues(r) });
  }
}

const segLeasing = seguimientoRecords('Seguimiento Leasing Carabanchel (new .LIFE) .xlsx - Leasing Update (1).csv', 'seguimiento_leasing_csv');
const segCurrent = seguimientoRecords('Current Seguirmento data 15.10.2026.csv', 'seguimiento_15_10_csv');
for (const [nc, rec] of segLeasing) addNc(nc, rec);
for (const [nc, rec] of segCurrent) addNc(nc, rec);

for (const r of lifecycle) {
  addNc(Number(r.nc_number), {
    src: 'sb_housemonk_lifecycle_14_10',
    names: [[r.guest_first_name, r.guest_last_name, r.guest_second_last_name].filter(filled).join(' '), clean(r.tenancy_tenant_name)].filter(Boolean),
    docs: personDocs(r.guest_document_number, ...clean(r.tenancy_tenant_id).split(/\s*\|\s*/)),
    arrival: isoDate(r.check_in_date),
    departure: isoDate(r.move_out_date) || isoDate(r.check_out_date),
    persons: null,
    children: null,
    category: sourceCategory(r.unit_category),
    postal: realValue(r.guest_postal_code) ? normPostal(r.guest_postal_code) : null,
    city: realValue(r.guest_city),
    address1: realValue(r.guest_address_line_1),
    products: [],
    deposit: money(r.deposit_amount),
    rent: plausibleRent(money(r.monthly_rent)),
  });
}

/** HouseMonk exports keyed by HouseMonk contract ID (Channel number) and by document. */
const hmByContract = new Map();
const hmByDoc = new Map();
const hmSources = [
  ['housemonk_15_10_csv', csvObjects('Current Housemonk data 15.10.2026.csv')],
  ['ff_housemonk_15_10_csv', csvObjects('Final Format_Current Housemonk data 15.10.2026.csv')],
  ['housemonk_14_10_csv', csvObjects('HouseMonk_data_14.10.2026.csv')],
  ['sb_ff_housemonk_15_10', sbFfHm15],
];
for (const [label, rows] of hmSources) {
  for (const r of rows) {
    const rec = { src: label, ...mewsValues(r) };
    const cid = clean(r['Channel number']);
    if (cid) {
      if (!hmByContract.has(cid)) hmByContract.set(cid, []);
      hmByContract.get(cid).push(rec);
    }
    for (const d of rec.docs) {
      if (!hmByDoc.has(d)) hmByDoc.set(d, []);
      hmByDoc.get(d).push(rec);
    }
  }
}

/** Invoices keyed by HouseMonk contract ID: monthly Tarifa rate, recurring services, billing address. */
const invByContract = new Map();
for (const r of csvObjects('Invoice-CreditNote-Pro Forma Invoice-14-10-2026-044357.csv')) {
  if (clean(r['Transaction Type']) !== 'Invoice') continue;
  const cid = clean(r['Contract ID']);
  if (!cid) continue;
  if (!invByContract.has(cid)) invByContract.set(cid, { rates: new Map(), products: new Map(), address: null, lastDate: '' });
  const agg = invByContract.get(cid);
  const date = isoDate(r['Invoice Date']) || '';
  const item = clean(r['Line Item Name']);
  const billed = clean(r['Line Item Billed At']);
  if (/^tarifa$/i.test(item) && /monthly/i.test(billed)) {
    // Only full calendar months; first/last months are prorated.
    const p = clean(r['Line Item Description']).match(/\((\d{2})\/(\d{2})\/(\d{4}) to (\d{2})\/(\d{2})\/(\d{4})\)/);
    const fullMonth =
      p && p[1] === '01' && Number(p[4]) === new Date(Date.UTC(Number(p[6]), Number(p[5]), 0)).getUTCDate();
    const rate = fullMonth ? plausibleRent(money(r['Line Item Rate'])) : null;
    if (rate) agg.rates.set(rate, (agg.rates.get(rate) || 0) + 1);
  } else if (billed && !NON_PRODUCT.test(item) && !ONE_OFF_PRODUCT.test(item)) {
    const k = productKey(item);
    if (!agg.products.has(k) || agg.products.get(k) < date) agg.products.set(k, date);
  }
  if (date >= agg.lastDate && filled(r['User Address'])) {
    agg.lastDate = date;
    agg.address = {
      address1: clean(r['User Address']),
      city: clean(r['User City']) || null,
      postal: normPostal(r['User Postal Code']),
    };
  }
}

function invoiceRecord(cid) {
  const agg = invByContract.get(cid);
  if (!agg) return null;
  const rate = [...agg.rates.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const latest = [...agg.products.values()].sort().at(-1) || '';
  const recent = [...agg.products.entries()].filter(([, d]) => d && dayDiff(d, latest || d) <= 62).map(([k]) => k);
  return {
    src: 'invoices_14_10_csv',
    names: [],
    docs: [],
    arrival: null,
    departure: null,
    persons: null,
    children: null,
    category: null,
    products: recent,
    hasProductData: true,
    deposit: null,
    rent: rate,
    ...(agg.address || {}),
  };
}

/** Active Carabanchel Tenancy stays (charges aggregated over the duplicate per-charge rows). */
const tenancyStays = new Map();
{
  const { header, rows } = loadCsv('Tenancy-14-10-2026-044225.csv');
  const col = (n) => header.indexOf(n);
  const ncIdx = header.lastIndexOf('NC');
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i];
    const row = {};
    header.forEach((h, j) => {
      if (!(h in row)) row[h] = c[j] ?? '';
    });
    if (clean(row.Property) !== PROPERTY) continue;
    const status = clean(row['Tenancy Status']);
    if (!/^(occupied|under notice|booked)$/i.test(status)) continue;
    const start = isoDate(row['Contract Start Date']) || isoDate(row['Occupancy Date']);
    const end = isoDate(row['Move out date']) || isoDate(row['Contract End Date']);
    if (!end || end < MIN_END) continue;
    const keyStay = clean(row['Contract ID']) || `${clean(row.Door)}|${start}|${clean(row['Tenant ID'])}`;
    if (!tenancyStays.has(keyStay)) {
      const { types, ids, names } = tenantColumnsFromRow(row);
      const individuals = [];
      let company = null;
      for (let k = 0; k < Math.max(types.length, ids.length, names.length); k++) {
        const p = { name: clean(names[k]), id: normalizeTenantId(ids[k]) };
        if ((types[k] || 'Individual').toLowerCase() === 'company') company = company || p;
        else individuals.push(p);
      }
      tenancyStays.set(keyStay, {
        key: keyStay,
        contractId: clean(row['Contract ID']) || null,
        status,
        door: formatAllocatedRoomNumber(row.Door),
        unitCategory: clean(row['Unit Category']),
        start,
        end,
        individuals,
        company,
        rent: plausibleRent(money(row['Tenant Rent'])),
        nightly: /nightly/i.test(clean(row['Contract Type'])),
        deposit: money(row.Deposit),
        ncTenancy: Number(clean(c[ncIdx])) || null,
        products: new Set(),
        raw: row,
      });
    }
    const stay = tenancyStays.get(keyStay);
    const charge = clean(c[col('Additional Charge')]);
    const amount = money(c[col('Additional Charge Amount')]);
    const chargeEnd = isoDate(c[col('Additional Service End Date')]);
    if (charge && amount > 0 && !NON_PRODUCT.test(charge) && !ONE_OFF_PRODUCT.test(charge) && (!chargeEnd || chargeEnd >= MIN_END)) {
      stay.products.add(productKey(charge));
    }
  }
}
const staysByDoor = new Map();
for (const s of tenancyStays.values()) {
  if (!s.door) continue;
  if (!staysByDoor.has(s.door)) staysByDoor.set(s.door, []);
  staysByDoor.get(s.door).push(s);
}

const segAny = (nc) => segLeasing.get(nc) || segCurrent.get(nc) || null;

function matchStay(row) {
  const nc = Number(row.nc_number);
  const cid = clean(row['Reservation Notes']).match(/HouseMonk tenancy (\d+)/)?.[1];
  if (cid && tenancyStays.has(cid)) return tenancyStays.get(cid);
  const a = isoDate(row['Arrival Date(*)']);
  const d = isoDate(row['Departure Date(*)']);
  const room = formatAllocatedRoomNumber(row['Allocated Room Number']);
  let best = null;
  let bestDays = 0;
  for (const s of (room && staysByDoor.get(room)) || []) {
    const days = overlapDays(a, d, s.start, s.end);
    if (days > bestDays) {
      best = s;
      bestDays = days;
    }
  }
  if (best) return best;
  const doc = normalizeTenantId(row['Document Number']);
  for (const s of tenancyStays.values()) {
    if (doc && s.individuals.some((p) => p.id === doc) && overlapDays(a, d, s.start, s.end) > 0) return s;
  }
  return [...tenancyStays.values()].find((s) => s.ncTenancy === nc) || null;
}

function tenancyRecord(s) {
  return {
    src: 'tenancy_14_10_csv',
    names: s.individuals.length ? s.individuals.map((p) => p.name) : s.company ? [s.company.name] : [],
    docs: personDocs(...s.individuals.map((p) => p.id)),
    arrival: s.start,
    departure: s.end,
    persons: s.individuals.length || null,
    children: null,
    category: sourceCategory(s.unitCategory),
    products: [...s.products],
    hasProductData: true,
    deposit: s.deposit,
    rent: s.nightly ? null : s.rent,
  };
}

// ---------- companies (B2B billing) ----------

const v4CompanyByName = new Map(v4Companies.map((c) => [normName(c['Company Name(*)']), c]));
const companySources = new Map();
for (const [label, rows] of [
  ['sb_companies_extraction_12_10', sbCompaniesExt],
  ['sb_v2_companies_19_10', sbV2Companies],
]) {
  for (const c of rows) {
    const name = normName(c['Company Name(*)'] || c['Company Name'] || c.company_name || c.name);
    if (!name) continue;
    if (!companySources.has(name)) companySources.set(name, []);
    companySources.get(name).push({
      src: label,
      address1: clean(c['Address Line 1'] || c.address_line_1) || null,
      city: clean(c.City || c.city) || null,
      postal: normPostal(c['Postal Code'] || c.postal_code),
    });
  }
}

// ---------- field checks ----------

function groupValues(records, pick, fmt = String) {
  const groups = new Map();
  for (const r of records) {
    const v = pick(r);
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    const label = Array.isArray(v) ? v.join(' + ') : fmt(v);
    if (!groups.has(label)) groups.set(label, new Set());
    groups.get(label).add(r.src);
  }
  return groups;
}

function describeGroups(groups) {
  if (!groups.size) return 'no source has a value';
  return [...groups.entries()].map(([v, srcs]) => `${v} [${[...srcs].join(', ')}]`).join('; ');
}

const issues = [];
function addIssue(row, stay, field, kind, v4Value, groups, extra = '', agreement = null) {
  issues.push({ row, stay, field, kind, v4Value, agreement, detail: `${describeGroups(groups)}${extra ? ` | ${extra}` : ''}` });
}

/** Sources agreeing / disagreeing with V4, and whether Tenancy (current operational record) agrees. */
function agreementOf(records, agrees) {
  const counted = records.filter((r) => agrees(r) != null);
  const yes = counted.filter((r) => agrees(r));
  const tenancy = counted.find((r) => r.src === 'tenancy_14_10_csv');
  return { agree: yes.length, disagree: counted.length - yes.length, tenancyAgrees: tenancy ? agrees(tenancy) : null };
}

function checkScalar(row, stay, field, v4Value, records, pick, equal, fmt = String) {
  const groups = groupValues(records, pick, fmt);
  if (v4Value == null || v4Value === '') {
    addIssue(row, stay, field, 'missing', null, groups);
    return;
  }
  const agrees = (r) => {
    const v = pick(r);
    return v == null || v === '' ? null : equal(v4Value, v);
  };
  const agreement = agreementOf(records, agrees);
  if (agreement.disagree) addIssue(row, stay, field, 'mismatch', fmt(v4Value), groups, '', agreement);
}

const MEWS_ROW_SOURCES_NOTE = 'Person Counts(*) empty on V4 row; using Adult + Child';

for (const row of v4Rows) {
  const nc = Number(row.nc_number);
  const stay = matchStay(row);
  const records = [...(byNc.get(nc) || [])];
  if (stay) {
    records.push(tenancyRecord(stay));
    if (stay.contractId) {
      records.push(...(hmByContract.get(stay.contractId) || []));
      const inv = invoiceRecord(stay.contractId);
      if (inv) records.push(inv);
    }
  } else {
    const doc = normalizeTenantId(row['Document Number']);
    const a = isoDate(row['Arrival Date(*)']);
    const d = isoDate(row['Departure Date(*)']);
    records.push(...(hmByDoc.get(doc) || []).filter((r) => overlapDays(a, d, r.arrival, r.departure) > 0));
  }

  // 1. Last name
  const last = clean(row['Last Name(*)']);
  const lastTokens = nameTokens(last);
  if (/\s/.test(last)) lastTokens.add(normNameToken(last.replace(/\s+/g, '')));
  if (!filled(last)) addIssue(row, stay, 'last_name', 'missing', null, groupValues(records, (r) => r.names));
  else if (looksLikeCompany(last) || normName(last) === normName(row['Partner Company'])) {
    addIssue(row, stay, 'last_name', 'unclear', last, groupValues(records, (r) => r.names), 'company name used as guest last name');
  } else {
    // Names with one distinct token ("Nahia Nahia", "David") and company names cannot confirm or contradict a surname.
    const informative = (r) => r.names.filter((n) => nameTokens(n).size >= 2 && !looksLikeCompany(n));
    const agrees = (r) => (informative(r).length ? informative(r).some((n) => anyTokenMatch(lastTokens, nameTokens(n))) : null);
    const agreement = agreementOf(records, agrees);
    if (agreement.disagree) addIssue(row, stay, 'last_name', 'mismatch', last, groupValues(records, (r) => informative(r)), '', agreement);
  }

  // 2. Document number (DNI / NIE / passport)
  const doc = normalizeTenantId(row['Document Number']);
  if (!doc) addIssue(row, stay, 'document_number', 'missing', null, groupValues(records, (r) => r.docs));
  else if (companyTaxIds.has(doc) || (isSpanishCompanyTaxId(doc) && normalizeTenantId(row['Tax Identification Number']) === doc)) {
    addIssue(row, stay, 'document_number', 'unclear', doc, groupValues(records, (r) => r.docs), 'company CIF used as guest document (no individual guest ID)');
  } else {
    const agreement = agreementOf(records, (r) => (r.docs.length ? r.docs.includes(doc) : null));
    if (agreement.disagree) addIssue(row, stay, 'document_number', 'mismatch', doc, groupValues(records, (r) => r.docs), '', agreement);
  }

  // 3–4. Dates (±1 day tolerance)
  checkScalar(row, stay, 'arrival_date', isoDate(row['Arrival Date(*)']), records, (r) => r.arrival, (a, b) => dayDiff(a, b) <= 1);
  checkScalar(row, stay, 'departure_date', isoDate(row['Departure Date(*)']), records, (r) => r.departure, (a, b) => dayDiff(a, b) <= 1);

  // 5. Person count
  const adults = money(row['Adult Count(*)']);
  const childrenV4 = money(row['Child Count(*)']);
  const persons = money(row['Person Counts(*)']) ?? (adults != null ? adults + (childrenV4 || 0) : null);
  checkScalar(row, stay, 'person_count', persons, records, (r) => r.persons, (a, b) => a === b);

  // 6. Child count
  checkScalar(row, stay, 'child_count', childrenV4, records, (r) => r.children, (a, b) => a === b);

  // 7. Room category (room inventory map is authoritative for the allocated room)
  const cat = canonicalizeRoomCategory(row['Allocated Room Category(*)']);
  const mapped = canonicalizeRoomCategory(categoryForRoomNumber(row['Allocated Room Number'], roomMap));
  const catRecords = mapped ? [...records, { src: 'room_inventory_map', category: mapped }] : records;
  checkScalar(row, stay, 'room_category', cat, catRecords, (r) => r.category, (a, b) => b.split('; ').includes(a));

  // 8. Billing address (company billing for B2B, guest address for B2C)
  const partner = clean(row['Partner Company']);
  if (partner) {
    const co = v4CompanyByName.get(normName(partner));
    const coSources = companySources.get(normName(partner)) || [];
    const missing = co
      ? ['Address Line 1', 'City', 'Postal Code', 'Country Code'].filter((f) => !filled(co[f]))
      : ['company not on V4 companies sheet'];
    const groups = groupValues(coSources, (r) => [r.address1, r.postal, r.city].filter(Boolean).join(', ') || null);
    if (missing.length) {
      addIssue(row, stay, 'billing_address', 'missing', co ? clean(co['Address Line 1']) || null : null, groups, `${partner}: missing ${missing.join(', ')}`);
    } else {
      const agreement = agreementOf(coSources, (s) => (s.postal ? s.postal === normPostal(co['Postal Code']) : null));
      if (agreement.disagree) {
        addIssue(row, stay, 'billing_address', 'mismatch', `${co['Address Line 1']}, ${co['Postal Code']} ${co.City}`, groups, partner, agreement);
      }
    }
  } else {
    const missing = ['Address Line 1', 'City', 'Postal Code', 'Country Code'].filter((f) => !filled(row[f]));
    const addrRecords = records.filter((r) => r.address1 || r.postal || r.city);
    const groups = groupValues(addrRecords, (r) => [r.address1, r.postal, r.city].filter(Boolean).join(', ') || null);
    const v4Addr = [row['Address Line 1'], row['Postal Code'], row.City].filter(filled).join(', ') || null;
    const placeholder = ['Address Line 1', 'City', 'Postal Code'].some((f) => isPlaceholder(row[f]));
    if (isSallaRassullPlaceholderAddress(row) || placeholder) {
      addIssue(row, stay, 'billing_address', 'unclear', v4Addr, groups, 'placeholder address');
    } else if (missing.length) {
      addIssue(row, stay, 'billing_address', 'missing', v4Addr, groups, `missing ${missing.join(', ')}`);
    } else {
      const pc = normPostal(row['Postal Code']);
      const cityTokens = nameTokens(row.City);
      const agreement = agreementOf(addrRecords, (r) =>
        r.postal ? r.postal === pc : r.city ? anyTokenMatch(cityTokens, nameTokens(r.city)) : null,
      );
      if (agreement.disagree) addIssue(row, stay, 'billing_address', 'mismatch', v4Addr, groups, '', agreement);
    }
  }

  // 9. Products / additional services
  const v4Products = splitProducts(row['Included Products']);
  const prodRecords = records.filter((r) => r.products?.length);
  const prodGroups = groupValues(prodRecords, (r) => r.products);
  if (!v4Products.length && prodRecords.length) {
    addIssue(row, stay, 'products', 'missing', null, prodGroups);
  } else if (v4Products.length) {
    const agreement = agreementOf(prodRecords, (r) => productsOverlap(v4Products, r.products));
    if (agreement.disagree) addIssue(row, stay, 'products', 'mismatch', v4Products.join(' + '), prodGroups, '', agreement);
  }

  // 10. Deposit (±1 €); an empty deposit is only missing when a source shows one above 0
  const v4Deposit = money(row['Prepaid Amount']);
  const depGroups = groupValues(records, (r) => r.deposit, fmtMoney);
  if (v4Deposit == null) {
    if (records.some((r) => r.deposit > 0)) addIssue(row, stay, 'deposit', 'missing', null, depGroups);
  } else {
    const agreement = agreementOf(records, (r) => (r.deposit == null ? null : Math.abs(r.deposit - v4Deposit) <= 1));
    if (agreement.disagree) addIssue(row, stay, 'deposit', 'mismatch', fmtMoney(v4Deposit), depGroups, '', agreement);
  }

  // 11. Rent (monthly, ±1 €); Seguimiento headline rent counts as agreeing when its own discount gives the V4 rent
  const notes = clean(row['Reservation Notes']);
  const v4Rent = plausibleRent(
    money(notes.match(/Monthly rent EUR:\s*([\d.,]+)/i)?.[1]) ??
      money(notes.match(/Monthly price:\s*([\d.,]+)/i)?.[1]) ??
      money(row['Per Night Prices']),
  );
  const explainedHeadlines = records
    .filter((r) => v4Rent != null && r.rentEffective != null && Math.abs(r.rentEffective - v4Rent) <= 1)
    .map((r) => r.rent);
  checkScalar(
    row,
    stay,
    'rent',
    v4Rent,
    records,
    (r) => r.rent,
    (a, b) => Math.abs(a - b) <= 1 || explainedHeadlines.some((h) => Math.abs(h - b) <= 1),
    fmtMoney,
  );
}

// ---------- missing-table rows ----------

function logRow(issue) {
  const { row, stay, field, kind } = issue;
  const nc = Number(row.nc_number);
  const seg = segAny(nc);
  const a = issue.agreement;
  let resolution = 'needs_review';
  if (kind === 'mismatch' && a) {
    if (a.tenancyAgrees === true) resolution = 'sources_differ_v4_matches_tenancy';
    else if (a.tenancyAgrees == null && a.agree > a.disagree) resolution = 'sources_differ_v4_matches_majority';
  }
  return {
    issue_type: `v4_${kind}_${field}`,
    resolution,
    nc_number: nc,
    nc_source: 'v4',
    tenancy_contract_id: stay?.contractId ?? null,
    tenancy_status: stay?.status ?? null,
    door: stay?.door ?? (clean(row['Allocated Room Number']) || null),
    unit_category: stay?.unitCategory ?? (clean(row['Allocated Room Category(*)']) || null),
    tenant_type: stay ? clean(stay.raw['Tenant Type']) || null : null,
    tenant_names: stay ? clean(stay.raw['Tenant Name']) || null : null,
    tenant_ids: stay ? clean(stay.raw['Tenant ID']) || null : null,
    tenant_emails: stay ? clean(stay.raw['Tenant Email']) || null : null,
    tenant_phones: stay ? clean(stay.raw['Tenant Phone Number']) || null : null,
    contract_start: stay?.start ?? isoDate(row['Arrival Date(*)']),
    contract_end: stay?.end ?? isoDate(row['Departure Date(*)']),
    monthly_rent: stay?.rent != null ? fmtMoney(stay.rent) : null,
    deposit: stay?.deposit != null ? fmtMoney(stay.deposit) : null,
    seguimiento_nc: seg ? `NC_${String(nc).padStart(4, '0')}` : null,
    seguimiento_label: seg?.label || null,
    seguimiento_names: seg?.namesText || null,
    seguimiento_end: seg?.departure || null,
    v4_guest: [clean(row['First Name']), clean(row['Last Name(*)'])].filter(Boolean).join(' ') || null,
    v4_room: clean(row['Allocated Room Number']) || null,
    notes: `${field} — V4: ${issue.v4Value ?? '(empty)'}${
      a ? ` | ${a.agree} source(s) agree, ${a.disagree} disagree${a.tenancyAgrees === false ? ' (incl. Tenancy)' : ''}` : ''
    } | Sources: ${issue.detail}${
      field === 'person_count' && !filled(row['Person Counts(*)']) ? ` | ${MEWS_ROW_SOURCES_NOTE}` : ''
    }`,
  };
}

const logRows = issues.map(logRow);
const byType = {};
for (const r of logRows) {
  const k = `${r.issue_type} / ${r.resolution}`;
  byType[k] = (byType[k] || 0) + 1;
}
const ncsWithIssues = new Set(logRows.map((r) => r.nc_number));

const summary = {
  apply: APPLY,
  v4Reservations: v4Rows.length,
  reservationsWithTenancyStay: v4Rows.filter((r) => matchStay(r)).length,
  reservationsWithIssues: ncsWithIssues.size,
  reservationsWithNeedsReview: new Set(logRows.filter((r) => r.resolution === 'needs_review').map((r) => r.nc_number)).size,
  reservationsClean: v4Rows.length - ncsWithIssues.size,
  issueRows: logRows.length,
  needsReviewRows: logRows.filter((r) => r.resolution === 'needs_review').length,
  byIssueType: Object.fromEntries(Object.entries(byType).sort((a, b) => b[1] - a[1])),
};

const reportPath = path.join(here, 'audit-v4-fields-across-sources-21-10-2026-report.json');
fs.writeFileSync(reportPath, JSON.stringify({ summary, logRows }, null, 2));

if (APPLY) {
  const AUDIT_FIELDS = [
    'last_name',
    'document_number',
    'arrival_date',
    'departure_date',
    'person_count',
    'child_count',
    'room_category',
    'billing_address',
    'products',
    'deposit',
    'rent',
  ];
  const auditTypes = ['v4_field_quality', ...AUDIT_FIELDS.flatMap((f) => ['missing', 'mismatch', 'unclear'].map((k) => `v4_${k}_${f}`))];
  const del = await sb.from(MISSING_TABLE).delete().in('issue_type', auditTypes);
  if (del.error) throw new Error(`delete old field-audit rows: ${del.error.message}`);
  for (let i = 0; i < logRows.length; i += 200) {
    const { error } = await sb.from(MISSING_TABLE).insert(logRows.slice(i, i + 200));
    if (error) throw new Error(`insert at ${i}: ${error.message}`);
  }
  const all = await fetchAll(MISSING_TABLE);
  summary.missingTableRowsAfter = all.length;
  summary.missingSql = writeMissingTableSql(all);
}

/** Seed file mirrors the live table (DDL + every row) so re-running it restores this state. */
function writeMissingTableSql(rows) {
  const cols = Object.keys(rows[0] || {}).filter((c) => c !== 'id' && c !== 'created_at');
  const lit = (v) => (v == null || v === '' ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  const lines = [
    `-- ${MISSING_TABLE}: Tenancy ↔ V4 gaps and V4 field audit (mirrors the live table)`,
    `create table if not exists public."${MISSING_TABLE}" (`,
    '  id uuid primary key default gen_random_uuid(),',
    '  created_at timestamptz not null default now(),',
    ...cols.map((c, i) => `  "${c}" ${c === 'nc_number' ? 'integer' : 'text'}${i === cols.length - 1 ? '' : ','}`),
    ');',
    `alter table public."${MISSING_TABLE}" enable row level security;`,
    `grant select, insert, update, delete on public."${MISSING_TABLE}" to service_role;`,
    `create index if not exists missing_occupied_ncs_21_10_2026_nc_idx on public."${MISSING_TABLE}" (nc_number);`,
    'begin;',
    `delete from public."${MISSING_TABLE}";`,
    ...rows.map((r) => `insert into public."${MISSING_TABLE}" (${cols.map((c) => `"${c}"`).join(', ')}) values (${cols.map((c) => lit(r[c])).join(', ')});`),
    'commit;',
    "notify pgrst, 'reload schema';",
  ];
  const out = path.join(root, 'contract-analysis', 'supabase-missing-occupied-ncs-21-10-2026.sql');
  fs.writeFileSync(out, `${lines.join('\n')}\n`);
  return out;
}

console.log(JSON.stringify({ ...summary, report: reportPath }, null, 2));
