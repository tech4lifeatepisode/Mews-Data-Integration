/**
 * V5 Supabase tables: subset of V4 for Mews future import.
 * Keeps only reservations whose Arrival Date(*) is on or after --min-arrival (default 2026-11-05).
 * Row content matches V4 (no date rewriting). Companies sheet = V4 companies still referenced by kept rows.
 *
 * Prerequisite: run contract-analysis/supabase-v5-*.sql in Supabase if tables are missing.
 *
 *   node create-v5-from-v4-21-10-2026.mjs              (dry-run summary)
 *   node create-v5-from-v4-21-10-2026.mjs --apply        (write V5 + backup)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { applyPuertaDeSevillaPrepayment } from './puerta-de-sevilla-prepayment.mjs';

const V4_CUSTOMERS = 'V4_Final_B2C_and_B2B_All_Fields_Match_Mews_Import_21_10_2026';
const V4_COMPANIES = 'V4_Final_Companies_Match_Mews_Import_21_10_2026';
const V5_CUSTOMERS = 'V5_Final_B2C_and_B2B_All_Fields_Match_Mews_Import_21_10_2026';
const V5_COMPANIES = 'V5_Final_Companies_Match_Mews_Import_21_10_2026';

const ARRIVAL_COL = 'Arrival Date(*)';
const DEPARTURE_COL = 'Departure Date(*)';

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

function parseArgs() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  let minArrival = '2026-11-05';
  let asOf = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--min-arrival' && argv[i + 1]) minArrival = argv[++i];
    if (argv[i] === '--as-of' && argv[i + 1]) asOf = argv[++i];
  }
  return { apply, minArrival, asOf };
}

function parseIso(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

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

function guestLabel(r) {
  return [r['First Name'], r['Last Name(*)']].filter(Boolean).join(' ');
}

function buildV5Customers(v4Rows, { minArrival }) {
  const excluded = [];
  const warnings = [];
  const out = [];
  for (const row of v4Rows) {
    const r = stripMeta({ ...row });
    const arrival = parseIso(r[ARRIVAL_COL]);
    if (!arrival) {
      warnings.push({ nc: r.nc_number, group: r['Group Code'], reason: 'missing arrival date — excluded' });
      continue;
    }
    if (arrival < minArrival) {
      excluded.push({
        nc_number: r.nc_number,
        group_code: r['Group Code'],
        guest: guestLabel(r),
        arrival,
      });
      continue;
    }
    out.push(applyPuertaDeSevillaPrepayment(r));
  }
  return { rows: out, excluded, warnings };
}

function companiesForCustomers(customers, allCompanies) {
  const keys = new Set();
  for (const r of customers) {
    for (const col of ['Partner Company', 'Company Id']) {
      const v = r[col];
      if (v) keys.add(String(v).trim().toLowerCase());
    }
    const tax = r['Tax Identification Number'];
    if (tax) keys.add(String(tax).trim().toLowerCase());
  }
  const picked = [];
  const seen = new Set();
  for (const row of allCompanies) {
    const co = stripMeta({ ...row });
    const name = co['Company Name(*)'];
    if (!name) continue;
    const nameKey = String(name).trim().toLowerCase();
    if (seen.has(nameKey)) continue;
    const taxKey = co['Tax ID Number'] ? String(co['Tax ID Number']).trim().toLowerCase() : '';
    if (keys.has(nameKey) || (taxKey && keys.has(taxKey))) {
      picked.push(co);
      seen.add(nameKey);
    }
  }
  return picked;
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

async function tableReady(table, probeColumn) {
  for (let i = 0; i < 12; i++) {
    const { error, status } = await sb.from(table).select(probeColumn, { count: 'exact', head: true });
    if (!error && status === 200) return true;
    const msg = error?.message || '';
    if (msg && !isMissingTableError(msg)) throw error;
    await sleep(3000);
  }
  return false;
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
      if (tableRetries <= 20) {
        await sleep(3000);
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
      if (tableRetries <= 20) {
        await sleep(3000);
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

function sqlLiteral(v) {
  if (v == null || v === '') return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function writeSeedSql(table, rows, filePath, { deleteSql }) {
  if (!rows.length) return;
  const sample = rows[0];
  const cols = Object.keys(sample).filter((k) => k !== 'id' && k !== 'created_at');
  const lines = [`-- Seed ${table} (${rows.length} rows)`, 'begin;', deleteSql];
  for (const row of rows) {
    const vals = cols.map((c) => sqlLiteral(row[c]));
    const colList = cols.map((c) => `"${c}"`).join(', ');
    lines.push(`insert into public."${table}" (${colList}) values (${vals.join(', ')});`);
  }
  lines.push('commit;');
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

const { apply, minArrival, asOf } = parseArgs();

const [v4Customers, v4Companies] = await Promise.all([
  fetchAll(V4_CUSTOMERS),
  fetchAll(V4_COMPANIES, { orderByNc: false }),
]);
if (!v4Customers.length) throw new Error(`No rows in ${V4_CUSTOMERS}`);

const { rows: v5Customers, excluded, warnings } = buildV5Customers(v4Customers, { minArrival });
const v5Companies = companiesForCustomers(v5Customers, v4Companies);

const summary = {
  v4Customers: v4Customers.length,
  v4Companies: v4Companies.length,
  v5Customers: v5Customers.length,
  v5Companies: v5Companies.length,
  rule: `keep only rows where Arrival Date(*) >= ${minArrival} (same field values as V4)`,
  excludedBelowMinArrival: excluded.length,
  excluded,
  warnings,
  apply,
  ddlCustomers: path.join(root, 'contract-analysis', 'supabase-v5-b2c-and-b2b-all-fields-match-mews-import-21-10-2026.sql'),
  ddlCompanies: path.join(root, 'contract-analysis', 'supabase-v5-companies-match-mews-import-21-10-2026.sql'),
};

if (apply) {
  const ddlHint = [
    'Create empty V5 tables first (SQL Editor — small files only, not the combined seed):',
    `  ${path.join(root, 'contract-analysis', 'supabase-v5-b2c-and-b2b-all-fields-match-mews-import-21-10-2026.sql')}`,
    `  ${path.join(root, 'contract-analysis', 'supabase-v5-companies-match-mews-import-21-10-2026.sql')}`,
    'Then re-run: node contract-extraction/create-v5-from-v4-21-10-2026.mjs --apply',
  ].join('\n');

  const [custReady, coReady] = await Promise.all([
    tableReady(V5_CUSTOMERS, 'nc_number'),
    tableReady(V5_COMPANIES, 'id'),
  ]);
  if (!custReady || !coReady) {
    console.error(ddlHint);
    process.exit(1);
  }

  const backupDir = path.join(here, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(
    path.join(backupDir, `v4-before-v5-${stamp}.json`),
    JSON.stringify({ v4Customers, v4Companies }, null, 2),
  );

  summary.customersUpload = await replaceCustomerTable(V5_CUSTOMERS, v5Customers);
  summary.companiesUpload = await replaceCompaniesTable(V5_COMPANIES, v5Companies);

  const seedDir = path.join(root, 'contract-analysis');
  if (summary.customersUpload.skipped) {
    summary.customersSeedSql = path.join(seedDir, 'supabase-v5-customers-seed-21-10-2026.sql');
    writeSeedSql(V5_CUSTOMERS, v5Customers, summary.customersSeedSql, {
      deleteSql: `delete from public."${V5_CUSTOMERS}" where nc_number >= 0;`,
    });
  }
  if (summary.companiesUpload.skipped) {
    summary.companiesSeedSql = path.join(seedDir, 'supabase-v5-companies-seed-21-10-2026.sql');
    writeSeedSql(V5_COMPANIES, v5Companies, summary.companiesSeedSql, {
      deleteSql: `delete from public."${V5_COMPANIES}" where id is not null;`,
    });
  }
}

fs.writeFileSync(path.join(here, 'create-v5-from-v4-21-10-2026-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

if (apply && (summary.customersUpload?.skipped || summary.companiesUpload?.skipped)) {
  console.error(
    '\nUpload did not complete. If you just created the V5 tables in SQL Editor, wait ~10s and run --apply again.',
  );
  process.exit(1);
}
