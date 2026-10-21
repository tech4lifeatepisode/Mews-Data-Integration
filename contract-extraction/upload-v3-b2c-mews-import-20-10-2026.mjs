/**
 * V3 B2C Mews import: V2 customers minus all B2B reservations (same departure-date window as V2).
 * Source: V2_Final_Format_All_Fields_Match_Mews_Import_19_10_2026 (must be populated first).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { isB2bReservation, isB2cOnlyForV3 } from './b2b-reservation-detect.mjs';
import { sanitizeV3B2cCustomerRow } from './v3-b2c-row-sanitize.mjs';
import { applyMewsRoomAndCategoryStandards } from './mews-room-format.mjs';
import { loadRoomNumberCategoryMap } from './room-number-to-category.mjs';
import { clean } from './room-number-to-category.mjs';
import { shouldExcludeNcFromV2 } from './tenancy-nc-overrides.mjs';
import { applyUnitActualValueCategory, loadUnitActualValueByNc } from './nc-unit-actual-value.mjs';

const V2_CUSTOMERS = 'V2_Final_Format_All_Fields_Match_Mews_Import_19_10_2026';
const V3_CUSTOMERS = 'V3_Final_B2C_All_Fields_Match_Mews_Import_20_10_2026';
const FF_SEG = 'Final_Format_Seguimiento_15_10_2026';
const FF_CUSTOMERS = 'Final_Format_Customers_Contracts_Extraction_15_10_2026';

const MIN_DEPARTURE_DATE = process.env.MEWS_MIN_DEPARTURE_DATE || '2026-11-05';
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
if (!key) throw new Error('Missing Supabase service key (SUPABASE_SERVICE_ROLE_KEY or .env)');
const sb = createClient(url, key);

function ncFromRow(row) {
  const nums = new Set();
  for (const t of [row['Group Code'], row['Internal Guest Notes']].filter(Boolean)) {
    for (const m of String(t).matchAll(/NC_0*(\d+)/gi)) nums.add(Number(m[1]));
  }
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

function stripMeta(row) {
  const { id, created_at, ...rest } = row;
  return rest;
}

const MISSING_COL_RE = /Could not find the '([^']+)' column/;
const MISSING_TABLE_RE = /Could not find the table '([^']+)'/;

function isBenignDeleteError(message = '') {
  return (
    /does not exist/i.test(message) ||
    /schema cache/i.test(message) ||
    MISSING_TABLE_RE.test(message)
  );
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
    `-- Seed ${table} (${rows.length} rows) — run after supabase-v3-b2c-all-fields-match-mews-import-20-10-2026.sql`,
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
  if (delError && !isBenignDeleteError(delError.message)) {
    throw delError;
  }

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

const [v2Rows, ffSeg, ffCust, unitActualByNc] = await Promise.all([
  fetchAll(V2_CUSTOMERS),
  fetchAll(FF_SEG, { orderByNc: false }).catch(() => []),
  fetchAll(FF_CUSTOMERS, { orderByNc: false }).catch(() => []),
  loadUnitActualValueByNc(),
]);
const segByNc = indexFirstByNc(ffSeg);
const custByNc = indexFirstByNc(ffCust);

if (!v2Rows.length) {
  console.error(`No rows in ${V2_CUSTOMERS}. Run upload-v2-mews-import-19-10-2026.mjs first.`);
  process.exit(1);
}

const b2bInV2 = v2Rows.filter((r) => {
  const nc = Number(r.nc_number);
  return isB2bReservation(nc, r, segByNc.get(nc));
});

const b2b2cOrPartnerInV2 = v2Rows.filter((r) => {
  const nc = Number(r.nc_number);
  if (isB2bReservation(nc, r, segByNc.get(nc))) return false;
  return !isB2cOnlyForV3(nc, r, segByNc.get(nc));
});

const excluded = v2Rows.filter((r) => shouldExcludeNcFromV2(r.nc_number));
const pastCheckout = v2Rows.filter((r) => !keepCurrentOrFutureReservation(r));

const customersOut = v2Rows
  .filter((r) => keepCurrentOrFutureReservation(r))
  .filter((r) => !shouldExcludeNcFromV2(r.nc_number))
  .filter((r) => isB2cOnlyForV3(Number(r.nc_number), r, segByNc.get(Number(r.nc_number))))
  .map((r) => {
    const nc = Number(r.nc_number);
    const row = sanitizeV3B2cCustomerRow(stripMeta({ ...r, nc_number: nc }), custByNc.get(nc));
    applyMewsRoomAndCategoryStandards(row, roomMap);
    applyUnitActualValueCategory(row, unitActualByNc);
    return row;
  })
  .sort((a, b) => a.nc_number - b.nc_number);

const upload = await replaceTable(V3_CUSTOMERS, customersOut);

const customersSeedSqlPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'contract-analysis',
  'supabase-v3-b2c-customers-seed-20-10-2026.sql',
);
if (upload.skipped && customersOut.length) {
  writeCustomersSeedSql(V3_CUSTOMERS, customersOut, customersSeedSqlPath);
}

const exportCsvPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'v3-b2c-customers-export-20-10-2026.csv',
);
writeCustomersExportCsv(customersOut, exportCsvPath);

const summary = {
  minDepartureDate: MIN_DEPARTURE_DATE,
  sourceV2Table: V2_CUSTOMERS,
  v3CustomersTable: V3_CUSTOMERS,
  v2RowCount: v2Rows.length,
  v2B2bRowCount: b2bInV2.length,
  v2B2b2cOrPartnerExcludedFromV3: b2b2cOrPartnerInV2.length,
  removedB2b2cOrPartnerSampleNcs: b2b2cOrPartnerInV2.slice(0, 40).map((r) => r.nc_number),
  v3B2cRowCount: customersOut.length,
  removedB2bSampleNcs: b2bInV2.slice(0, 30).map((r) => r.nc_number),
  excludedTenancyMovedOutNcs: excluded.map((r) => r.nc_number),
  removedPastCheckoutCount: pastCheckout.length,
  customersUpload: upload,
  customersSeedSql: upload.skipped ? customersSeedSqlPath : null,
  ddl: path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'contract-analysis',
    'supabase-v3-b2c-all-fields-match-mews-import-20-10-2026.sql',
  ),
  buildXlsx: 'node contract-extraction/build-v3-mews-import-xlsx.mjs',
  localExportCsv: exportCsvPath,
};

const summaryPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'v3-mews-import-20-10-2026-summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
