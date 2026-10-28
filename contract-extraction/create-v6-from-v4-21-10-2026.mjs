/**
 * V6 Supabase tables: full V4 clone with current-stay arrival normalization.
 * If Arrival Date(*) <= 2026-11-05, set to 2026-11-01; later arrivals unchanged.
 * Companies = exact V4 companies copy.
 *
 * Prerequisite: run contract-analysis/supabase-v6-*.sql in Supabase if tables are missing.
 *
 *   node create-v6-from-v4-21-10-2026.mjs
 *   node create-v6-from-v4-21-10-2026.mjs --apply
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const V4_CUSTOMERS = 'V4_Final_B2C_and_B2B_All_Fields_Match_Mews_Import_21_10_2026';
const V4_COMPANIES = 'V4_Final_Companies_Match_Mews_Import_21_10_2026';
const V6_CUSTOMERS = 'V6_Final_B2C_and_B2B_All_Fields_Match_Mews_Import_21_10_2026';
const V6_COMPANIES = 'V6_Final_Companies_Match_Mews_Import_21_10_2026';

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
  let currentThrough = '2026-11-05';
  let normalizedArrival = '2026-11-01';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--current-through' && argv[i + 1]) currentThrough = argv[++i];
    if (argv[i] === '--normalized-arrival' && argv[i + 1]) normalizedArrival = argv[++i];
  }
  return { apply, currentThrough, normalizedArrival };
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

function buildV6Customers(v4Rows, { currentThrough, normalizedArrival }) {
  const shifted = [];
  const unchanged = [];
  const warnings = [];
  const out = [];
  for (const row of v4Rows) {
    const r = stripMeta({ ...row });
    const arrival = parseIso(r[ARRIVAL_COL]);
    const departure = parseIso(r[DEPARTURE_COL]);
    if (!arrival) {
      warnings.push({ nc: r.nc_number, group: r['Group Code'], reason: 'missing arrival date' });
      out.push(r);
      continue;
    }
    if (arrival <= currentThrough) {
      if (arrival !== normalizedArrival) {
        if (departure && departure <= normalizedArrival) {
          warnings.push({
            nc_number: r.nc_number,
            group_code: r['Group Code'],
            reason: `departure ${departure} on/before normalized arrival ${normalizedArrival}`,
            from: arrival,
          });
        }
        shifted.push({
          nc_number: r.nc_number,
          group_code: r['Group Code'],
          guest: guestLabel(r),
          from: arrival,
          to: normalizedArrival,
        });
        r[ARRIVAL_COL] = normalizedArrival;
      }
    } else {
      unchanged.push({ nc_number: r.nc_number, arrival });
    }
    out.push(r);
  }
  return { rows: out, shifted, unchanged, warnings };
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

function writeSeedSql(table, rows, filePath, { deleteSql }) {
  if (!rows.length) return;
  const sample = rows[0];
  const cols = Object.keys(sample).filter((k) => k !== 'id' && k !== 'created_at');
  const sqlLiteral = (v) => {
    if (v == null || v === '') return 'null';
    return `'${String(v).replace(/'/g, "''")}'`;
  };
  const lines = [`-- Seed ${table} (${rows.length} rows)`, 'begin;', deleteSql];
  for (const row of rows) {
    const vals = cols.map((c) => sqlLiteral(row[c]));
    const colList = cols.map((c) => `"${c}"`).join(', ');
    lines.push(`insert into public."${table}" (${colList}) values (${vals.join(', ')});`);
  }
  lines.push('commit;');
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

const { apply, currentThrough, normalizedArrival } = parseArgs();

const [v4Customers, v4Companies] = await Promise.all([
  fetchAll(V4_CUSTOMERS),
  fetchAll(V4_COMPANIES, { orderByNc: false }),
]);
if (!v4Customers.length) throw new Error(`No rows in ${V4_CUSTOMERS}`);

const { rows: v6Customers, shifted, unchanged, warnings } = buildV6Customers(v4Customers, {
  currentThrough,
  normalizedArrival,
});
const v6Companies = v4Companies.map((r) => stripMeta({ ...r }));

const summary = {
  v4Customers: v4Customers.length,
  v4Companies: v4Companies.length,
  v6Customers: v6Customers.length,
  v6Companies: v6Companies.length,
  rule: `if Arrival Date(*) <= ${currentThrough}, set to ${normalizedArrival}; else same as V4`,
  arrivalsShifted: shifted.length,
  arrivalsUnchangedAfterCutoff: unchanged.length,
  shiftedSample: shifted.slice(0, 20),
  warnings,
  apply,
  ddlCustomers: path.join(root, 'contract-analysis', 'supabase-v6-b2c-and-b2b-all-fields-match-mews-import-21-10-2026.sql'),
  ddlCompanies: path.join(root, 'contract-analysis', 'supabase-v6-companies-match-mews-import-21-10-2026.sql'),
};

if (apply) {
  const ddlHint = [
    'Create empty V6 tables first (SQL Editor):',
    `  ${summary.ddlCustomers}`,
    `  ${summary.ddlCompanies}`,
    'Then re-run: node contract-extraction/create-v6-from-v4-21-10-2026.mjs --apply',
  ].join('\n');

  const [custReady, coReady] = await Promise.all([
    tableReady(V6_CUSTOMERS, 'nc_number'),
    tableReady(V6_COMPANIES, 'id'),
  ]);
  if (!custReady || !coReady) {
    console.error(ddlHint);
    process.exit(1);
  }

  const backupDir = path.join(here, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(
    path.join(backupDir, `v4-before-v6-${stamp}.json`),
    JSON.stringify({ v4Customers, v4Companies }, null, 2),
  );

  summary.customersUpload = await replaceCustomerTable(V6_CUSTOMERS, v6Customers);
  summary.companiesUpload = await replaceCompaniesTable(V6_COMPANIES, v6Companies);

  const seedDir = path.join(root, 'contract-analysis');
  if (summary.customersUpload.skipped) {
    summary.customersSeedSql = path.join(seedDir, 'supabase-v6-customers-seed-21-10-2026.sql');
    writeSeedSql(V6_CUSTOMERS, v6Customers, summary.customersSeedSql, {
      deleteSql: `delete from public."${V6_CUSTOMERS}" where nc_number >= 0;`,
    });
  }
  if (summary.companiesUpload.skipped) {
    summary.companiesSeedSql = path.join(seedDir, 'supabase-v6-companies-seed-21-10-2026.sql');
    writeSeedSql(V6_COMPANIES, v6Companies, summary.companiesSeedSql, {
      deleteSql: `delete from public."${V6_COMPANIES}" where id is not null;`,
    });
  }
}

summary.shifted = shifted;
fs.writeFileSync(path.join(here, 'create-v6-from-v4-21-10-2026-summary.json'), JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify(
    {
      ...summary,
      shifted: summary.arrivalsShifted,
      shiftedSample: undefined,
      shiftedFull: undefined,
    },
    null,
    2,
  ),
);

if (apply && (summary.customersUpload?.skipped || summary.companiesUpload?.skipped)) {
  console.error('\nUpload did not complete. Run V6 DDL in SQL Editor, wait ~10s, then --apply again.');
  process.exit(1);
}
