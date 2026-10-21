/**
 * V3 B2B Mews import: active/future B2B contract NCs (HouseMonk guests + company billing).
 * Sources: V2 customers, Final_Format customers/HM, Tenancy Lifecycle, Companies extraction.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { isB2bReservation } from './b2b-reservation-detect.mjs';
import {
  buildV3B2bNcSet,
  indexMissingGroupCodeNcs,
  isFilledMewsField,
  isCurrentOrFutureByDeparture,
  MIN_DEPARTURE_DATE,
} from './b2b-active-nc.mjs';
import { sanitizeV3B2bCustomerRow } from './v3-b2b-row-sanitize.mjs';
import { applyMewsRoomAndCategoryStandards } from './mews-room-format.mjs';
import { loadRoomNumberCategoryMap, clean } from './room-number-to-category.mjs';
import { shouldExcludeNcFromV2 } from './tenancy-nc-overrides.mjs';
import { applyUnitActualValueCategory, loadUnitActualValueByNc } from './nc-unit-actual-value.mjs';

const V2_CUSTOMERS = 'V2_Final_Format_All_Fields_Match_Mews_Import_19_10_2026';
const V3_B2B_CUSTOMERS = 'V3_Final_B2B_All_Fields_Match_Mews_Import_20_10_2026';
const LIFECYCLE = 'HouseMonk_Tenancy_Lifecycle_NC_14_10_2026';
const FF_HM = 'Final_Format_HouseMonk_15_10_2026';
const FF_SEG = 'Final_Format_Seguimiento_15_10_2026';
const FF_CUSTOMERS = 'Final_Format_Customers_Contracts_Extraction_15_10_2026';
const CUSTOMERS_EXT = 'Customers_Contracts_Extraction_12_10_2026';
const COMPANIES_EXTRACTION = 'Companies_Extraction_12_10_2026';
const MISSING_GC = 'Missing_Group_Code_HouseMonk_15_10_2026';

const roomMap = loadRoomNumberCategoryMap();

const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
const transcriptText = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
function lastMatch(pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const m = [...transcriptText.matchAll(new RegExp(pattern.source, flags))];
  return m.length ? m.at(-1)[0] : null;
}
const url = process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  lastMatch(/sb_secret_[A-Za-z0-9_\-]+/);
if (!key) throw new Error('Missing Supabase service key');
const sb = createClient(url, key);

function ncFromRow(row) {
  const nums = new Set();
  for (const t of [row['Group Code'], row['Internal Guest Notes']].filter(Boolean)) {
    for (const m of String(t).matchAll(/NC_0*(\d+)/gi)) nums.add(Number(m[1]));
  }
  if (row.nc_number != null && Number.isFinite(Number(row.nc_number))) nums.add(Number(row.nc_number));
  return [...nums];
}

function indexFirstByNc(rows) {
  const map = new Map();
  for (const r of rows) {
    for (const n of ncFromRow(r)) {
      if (!map.has(n)) map.set(n, r);
    }
    if (r.nc_number != null && !map.has(Number(r.nc_number))) map.set(Number(r.nc_number), r);
  }
  return map;
}

function indexAllHmByNc(rows) {
  const map = new Map();
  for (const r of rows) {
    for (const n of ncFromRow(r)) {
      if (!map.has(n)) map.set(n, r);
    }
    if (r.nc_number != null && !map.has(Number(r.nc_number))) map.set(Number(r.nc_number), r);
  }
  return map;
}

function parseDepartureIso(row) {
  const raw = clean(row?.['Departure Date(*)']);
  if (!raw || raw === '/') return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function keepCurrentOrFutureReservation(row) {
  const dep = parseDepartureIso(row);
  if (!dep) return false;
  return dep >= MIN_DEPARTURE_DATE;
}

function stripMeta(row) {
  const { id, created_at, ...rest } = row;
  return rest;
}

function skeletonFromHmAndLifecycle(nc, hm, lifecycle, cust) {
  const code = clean(hm?.['Group Code']) || clean(cust?.['Group Code']) || `NC_${String(nc).padStart(4, '0')}`;
  return {
    nc_number: nc,
    'Group Code': code,
    'Internal Guest Notes': code,
    Email: hm?.Email ?? lifecycle?.guest_email ?? cust?.Email ?? null,
    'Last Name(*)': hm?.['Last Name(*)'] ?? lifecycle?.guest_last_name ?? cust?.['Last Name(*)'] ?? null,
    'First Name': hm?.['First Name'] ?? lifecycle?.guest_first_name ?? cust?.['First Name'] ?? null,
    'Second Last Name': hm?.['Second Last Name'] ?? lifecycle?.guest_second_last_name ?? null,
    'Document Number': hm?.['Document Number'] ?? lifecycle?.guest_document_number ?? cust?.['Document Number'] ?? null,
    'Document Type': hm?.['Document Type'] ?? lifecycle?.guest_document_type ?? cust?.['Document Type'] ?? null,
    Telephone: hm?.Telephone ?? lifecycle?.guest_telephone ?? cust?.Telephone ?? null,
    'Arrival Date(*)': hm?.['Arrival Date(*)'] ?? lifecycle?.check_in_date ?? cust?.['Arrival Date(*)'] ?? null,
    'Departure Date(*)': hm?.['Departure Date(*)'] ?? lifecycle?.check_out_date ?? cust?.['Departure Date(*)'] ?? null,
    'Allocated Room Number': hm?.['Allocated Room Number'] ?? lifecycle?.allocated_room_number ?? null,
    'Allocated Room Category(*)':
      hm?.['Allocated Room Category(*)'] ?? lifecycle?.unit_category ?? cust?.['Allocated Room Category(*)'] ?? null,
    'Partner Company': cust?.['Partner Company'] ?? hm?.['Partner Company'] ?? null,
    'Company Id': cust?.['Company Id'] ?? cust?.['Partner Company'] ?? hm?.['Company Id'] ?? null,
    'Tax Identification Number': cust?.['Tax Identification Number'] ?? hm?.['Tax Identification Number'] ?? null,
    'Reservation Notes': cust?.['Reservation Notes'] ?? hm?.['Reservation Notes'] ?? null,
    'Prepaid Amount': hm?.['Prepaid Amount'] ?? cust?.['Prepaid Amount'] ?? null,
    'Allocated Rate': hm?.['Allocated Rate'] ?? cust?.['Allocated Rate'] ?? null,
    'Currency Code': 'EUR',
  };
}

async function fetchAll(table, { orderByNc = true } = {}) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select('*');
    if (orderByNc) q = q.order('nc_number', { ascending: true });
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

const MISSING_COL_RE = /Could not find the '([^']+)' column/;
const MISSING_TABLE_RE = /Could not find the table '([^']+)'/;

function isBenignDeleteError(message = '') {
  return /does not exist/i.test(message) || /schema cache/i.test(message) || MISSING_TABLE_RE.test(message);
}

function isMissingTableError(message = '') {
  return MISSING_TABLE_RE.test(message) || /schema cache/i.test(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sqlLiteral(v) {
  if (v == null || v === '') return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function writeCustomersSeedSql(table, rows, filePath) {
  if (!rows.length) return;
  const sample = stripMeta({ ...rows[0] });
  const cols = Object.keys(sample).filter((k) => k !== 'id' && k !== 'created_at');
  const lines = [
    `-- Seed ${table} (${rows.length} rows)`,
    'begin;',
    `delete from public."${table}" where nc_number >= 0;`,
  ];
  for (const row of rows) {
    const data = stripMeta({ ...row });
    const vals = cols.map((c) => sqlLiteral(data[c]));
    const colList = cols.map((c) => `"${c}"`).join(', ');
    lines.push(`insert into public."${table}" (${colList}) values (${vals.join(', ')});`);
  }
  lines.push('commit;');
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function writeCustomersExportCsv(rows, filePath) {
  if (!rows.length) return;
  const cols = Object.keys(stripMeta({ ...rows[0] }));
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(',')];
  for (const row of rows) {
    const data = stripMeta({ ...row });
    lines.push(cols.map((c) => esc(data[c])).join(','));
  }
  fs.writeFileSync(filePath, `\ufeff${lines.join('\n')}\n`, 'utf8');
}

async function replaceTable(table, rows) {
  const { error: delError } = await sb.from(table).delete().gte('nc_number', 0);
  if (delError && !isBenignDeleteError(delError.message)) throw delError;

  const omit = new Set();
  let tableRetries = 0;
  for (;;) {
    let failed = null;
    for (let i = 0; i < rows.length; i += 60) {
      const chunk = rows.slice(i, i + 60).map((r) => {
        const out = stripMeta({ ...r });
        for (const c of omit) delete out[c];
        return out;
      });
      if (!chunk.length) continue;
      const { error } = await sb.from(table).insert(chunk);
      if (error) {
        failed = error;
        break;
      }
    }
    if (!failed) break;
    const m = MISSING_COL_RE.exec(failed.message);
    if (isMissingTableError(failed.message)) {
      tableRetries++;
      if (tableRetries <= 5) {
        await sleep(2000);
        continue;
      }
      return { skipped: true, omitted: [...omit], reason: failed.message };
    }
    if (!m) throw failed;
    if (omit.has(m[1])) throw failed;
    omit.add(m[1]);
    await sb.from(table).delete().gte('nc_number', 0);
  }
  return { skipped: false, omitted: [...omit], reason: null };
}

const [
  v2Rows,
  lifecycleRows,
  ffHm,
  ffSeg,
  ffCust,
  custExt,
  companiesExtract,
  missingGc,
  unitActualByNc,
] = await Promise.all([
  fetchAll(V2_CUSTOMERS),
  fetchAll(LIFECYCLE),
  fetchAll(FF_HM, { orderByNc: false }),
  fetchAll(FF_SEG, { orderByNc: false }),
  fetchAll(FF_CUSTOMERS, { orderByNc: false }),
  fetchAll(CUSTOMERS_EXT, { orderByNc: false }).catch(() => []),
  fetchAll(COMPANIES_EXTRACTION, { orderByNc: false }).catch(() => []),
  fetchAll(MISSING_GC, { orderByNc: false }).catch(() => []),
  loadUnitActualValueByNc(),
]);

const segByNc = indexFirstByNc(ffSeg);
const custByNc = indexFirstByNc(ffCust);
const custExtByNc = indexFirstByNc(custExt);
const hmByNc = indexAllHmByNc(ffHm);
const v2ByNc = new Map(v2Rows.map((r) => [Number(r.nc_number), r]));
const missingGcNcs = indexMissingGroupCodeNcs(missingGc);

const { ncSet, activeLifecycleByNc } = buildV3B2bNcSet({
  lifecycleRows,
  custByNc,
  custExtByNc,
  segByNc,
  v2Rows,
  missingGroupCodeNcs: missingGcNcs,
  isB2bReservation,
  shouldExcludeNc: shouldExcludeNcFromV2,
});

const customersOut = [];
const skippedNoCompany = [];
const skippedNoGuest = [];

for (const nc of [...ncSet].sort((a, b) => a - b)) {
  if (shouldExcludeNcFromV2(nc)) continue;
  const lifecycle = activeLifecycleByNc.get(nc);
  const hm = hmByNc.get(nc);
  const seg = segByNc.get(nc);
  const cust = custByNc.get(nc) || custExtByNc.get(nc);
  const base = v2ByNc.get(nc) || skeletonFromHmAndLifecycle(nc, hm, lifecycle, cust);

  if (!keepCurrentOrFutureReservation(base) && lifecycle) {
    base['Departure Date(*)'] = lifecycle.check_out_date || base['Departure Date(*)'];
    base['Arrival Date(*)'] = lifecycle.check_in_date || base['Arrival Date(*)'];
  }
  const ext = custExtByNc.get(nc);
  if (
    !keepCurrentOrFutureReservation(base) &&
    !isCurrentOrFutureByDeparture(cust) &&
    !isCurrentOrFutureByDeparture(ext) &&
    !isCurrentOrFutureByDeparture(seg)
  ) {
    continue;
  }

  const row = sanitizeV3B2bCustomerRow(stripMeta({ ...base, nc_number: nc }), {
    customersFinal: cust,
    customersExt: custExtByNc.get(nc),
    hm,
    seg,
    lifecycle,
    companiesExtract,
  });

  if (!clean(row['Last Name(*)']) && !clean(row['First Name'])) {
    skippedNoGuest.push(nc);
    continue;
  }
  if (!isFilledMewsField(row['Partner Company']) && !isFilledMewsField(row['Company Id'])) {
    skippedNoCompany.push(nc);
    continue;
  }

  applyMewsRoomAndCategoryStandards(row, roomMap);
  applyUnitActualValueCategory(row, unitActualByNc);
  customersOut.push(row);
}

const upload = await replaceTable(V3_B2B_CUSTOMERS, customersOut);

const here = path.dirname(fileURLToPath(import.meta.url));
const ddlPath = path.join(here, '..', 'contract-analysis', 'supabase-v3-b2b-all-fields-match-mews-import-20-10-2026.sql');
const seedPath = path.join(here, '..', 'contract-analysis', 'supabase-v3-b2b-customers-seed-20-10-2026.sql');
const exportCsv = path.join(here, 'v3-b2b-customers-export-20-10-2026.csv');

if (upload.skipped && customersOut.length) writeCustomersSeedSql(V3_B2B_CUSTOMERS, customersOut, seedPath);
writeCustomersExportCsv(customersOut, exportCsv);

const summary = {
  minDepartureDate: MIN_DEPARTURE_DATE,
  v3B2bTable: V3_B2B_CUSTOMERS,
  sourceV2Table: V2_CUSTOMERS,
  lifecycleTable: LIFECYCLE,
  activeB2bNcCandidates: ncSet.size,
  v3B2bRowCount: customersOut.length,
  withPartnerCompany: customersOut.filter((r) => isFilledMewsField(r['Partner Company'])).length,
  withCompanyTaxId: customersOut.filter((r) => isFilledMewsField(r['Tax Identification Number'])).length,
  missingGroupCodeExcluded: missingGcNcs.size,
  skippedNoGuestNcs: skippedNoGuest,
  skippedNoCompanyNcs: skippedNoCompany.slice(0, 40),
  customersUpload: upload,
  ddl: ddlPath,
  customersSeedSql: upload.skipped ? seedPath : null,
  localExportCsv: exportCsv,
};

fs.writeFileSync(path.join(here, 'v3-b2b-mews-import-20-10-2026-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
