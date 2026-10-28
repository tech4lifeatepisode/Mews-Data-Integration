/**
 * V4 Mews import: merge V3 B2C + V3 B2B customers; deduplicated Companies sheet.
 *
 * Prerequisite: run both V3 upload scripts (or existing V3 tables populated).
 * DDL: contract-analysis/supabase-v4-*.sql (run in Supabase SQL editor if tables missing).
 *
 *   node upload-v4-mews-import-21-10-2026.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { clean } from './room-number-to-category.mjs';
import { buildV4DedupedCompanies, countCompanyLinks, MEWS_COMPANY_HEADERS } from './v4-companies-dedupe.mjs';

const V3_B2C = 'V3_Final_B2C_All_Fields_Match_Mews_Import_20_10_2026';
const V3_B2B = 'V3_Final_B2B_All_Fields_Match_Mews_Import_20_10_2026';
const V4_CUSTOMERS = 'V4_Final_B2C_and_B2B_All_Fields_Match_Mews_Import_21_10_2026';
const V4_COMPANIES = 'V4_Final_Companies_Match_Mews_Import_21_10_2026';
const V2_COMPANIES_CANDIDATES = [
  process.env.V2_COMPANIES_TABLE,
  'V2_Final_Format_All_Fields_Match_Mews_Import_Companies_19_10_2026',
  'V2_Final_Format_All_Fields_Match_Mews_Import_Companies_19_10_20',
].filter(Boolean);

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

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

function stripMeta(row) {
  const { id, created_at, ...rest } = row;
  return rest;
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

async function fetchV2CompanyRows() {
  for (const table of V2_COMPANIES_CANDIDATES) {
    try {
      const rows = await fetchAll(table);
      if (rows.length) return rows;
    } catch {
      /* next candidate */
    }
  }
  return [];
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

function writeSeedSql(table, rows, filePath, { deleteSql }) {
  if (!rows.length) return;
  const sample = stripMeta({ ...rows[0] });
  const cols = Object.keys(sample).filter((k) => k !== 'id' && k !== 'created_at');
  const lines = [`-- Seed ${table} (${rows.length} rows)`, 'begin;', deleteSql];
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

function writeCompaniesExportCsv(rows, filePath) {
  if (!rows.length) return;
  const cols = MEWS_COMPANY_HEADERS;
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(',')];
  for (const row of rows) {
    lines.push(cols.map((c) => esc(row[c])).join(','));
  }
  fs.writeFileSync(filePath, `\ufeff${lines.join('\n')}\n`, 'utf8');
}

async function replaceCustomerTable(table, rows) {
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

async function replaceCompaniesTable(table, rows) {
  const { error: delError } = await sb.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (delError && !isBenignDeleteError(delError.message)) throw delError;

  const omit = new Set();
  let tableRetries = 0;
  for (;;) {
    let failed = null;
    for (let i = 0; i < rows.length; i += 60) {
      const chunk = rows.slice(i, i + 60).map((r) => {
        const out = { ...r };
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
    await sb.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
  }
  return { skipped: false, omitted: [...omit], reason: null };
}

function mergeV3CustomerRows(b2cRows, b2bRows) {
  const byNc = new Map();
  const overlap = [];

  for (const row of b2cRows) {
    const nc = Number(row.nc_number);
    if (Number.isFinite(nc)) byNc.set(nc, { ...stripMeta(row), nc_number: nc });
  }
  for (const row of b2bRows) {
    const nc = Number(row.nc_number);
    if (!Number.isFinite(nc)) continue;
    if (byNc.has(nc)) overlap.push(nc);
    byNc.set(nc, { ...stripMeta(row), nc_number: nc });
  }

  const combined = [...byNc.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
  return { combined, overlap: [...new Set(overlap)].sort((a, b) => a - b) };
}

const [b2cRows, b2bRows, v2CompanyRows] = await Promise.all([
  fetchAll(V3_B2C),
  fetchAll(V3_B2B),
  fetchV2CompanyRows(),
]);

if (!b2cRows.length && !b2bRows.length) {
  throw new Error(`No rows in ${V3_B2C} or ${V3_B2B}. Run V3 upload scripts first.`);
}

const { combined: customersOut, overlap } = mergeV3CustomerRows(b2cRows, b2bRows);
const companiesOut = buildV4DedupedCompanies(customersOut, v2CompanyRows);

const customersUpload = await replaceCustomerTable(V4_CUSTOMERS, customersOut);
const companiesUpload = await replaceCompaniesTable(V4_COMPANIES, companiesOut);

const ddlCustomers = path.join(root, 'contract-analysis', 'supabase-v4-b2c-and-b2b-all-fields-match-mews-import-21-10-2026.sql');
const ddlCompanies = path.join(root, 'contract-analysis', 'supabase-v4-companies-match-mews-import-21-10-2026.sql');
const seedCustomers = path.join(root, 'contract-analysis', 'supabase-v4-customers-seed-21-10-2026.sql');
const seedCompanies = path.join(root, 'contract-analysis', 'supabase-v4-companies-seed-21-10-2026.sql');
const exportCustomersCsv = path.join(here, 'v4-customers-export-21-10-2026.csv');
const exportCompaniesCsv = path.join(here, 'v4-companies-export-21-10-2026.csv');

if (customersUpload.skipped && customersOut.length) {
  writeSeedSql(V4_CUSTOMERS, customersOut, seedCustomers, {
    deleteSql: `delete from public."${V4_CUSTOMERS}" where nc_number >= 0;`,
  });
}
if (companiesUpload.skipped && companiesOut.length) {
  writeSeedSql(V4_COMPANIES, companiesOut, seedCompanies, {
    deleteSql: `delete from public."${V4_COMPANIES}" where id is not null;`,
  });
}

writeCustomersExportCsv(customersOut, exportCustomersCsv);
writeCompaniesExportCsv(companiesOut, exportCompaniesCsv);

const summary = {
  v4CustomersTable: V4_CUSTOMERS,
  v4CompaniesTable: V4_COMPANIES,
  sourceB2cRows: b2cRows.length,
  sourceB2bRows: b2bRows.length,
  v4CustomerRows: customersOut.length,
  v4CompanyRows: companiesOut.length,
  reservationsWithPartnerCompany: countCompanyLinks(customersOut),
  b2bOverridesB2cOnNcOverlap: overlap.length,
  overlapNcSample: overlap.slice(0, 20),
  v2CompanyRowsUsedForEnrichment: v2CompanyRows.length,
  customersUpload,
  companiesUpload,
  ddlCustomers,
  ddlCompanies,
  customersSeedSql: customersUpload.skipped ? seedCustomers : null,
  companiesSeedSql: companiesUpload.skipped ? seedCompanies : null,
  localExportCustomersCsv: exportCustomersCsv,
  localExportCompaniesCsv: exportCompaniesCsv,
};

fs.writeFileSync(path.join(here, 'v4-mews-import-21-10-2026-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
