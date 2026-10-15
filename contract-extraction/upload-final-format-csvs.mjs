/**
 * Upload Final Format CSVs to new Supabase tables (not Customers_Contracts_Extraction_12_10_2026).
 * Requires tables from contract-analysis/supabase-final-format-tables.sql (run once in SQL editor if missing).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(repoRoot, 'contract-analysis', 'External Data Sources');

const UPLOADS = [
  {
    csv: 'Final Format_Current Housemonk data 15.10.2026.csv',
    table: 'Final_Format_HouseMonk_15_10_2026',
  },
  {
    csv: 'Final Format_Current Seguirmento data 15.10.2026.csv',
    table: 'Final_Format_Seguimiento_15_10_2026',
  },
];

const CUSTOMERS_TABLE = 'Customers_Contracts_Extraction_12_10_2026';
const IMPORT_SOURCES = ['HouseMonk', 'Seguimiento Leasing'];

const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
const text = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
function lastMatch(pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const m = [...text.matchAll(new RegExp(pattern.source, flags))];
  return m.length ? m.at(-1)[0] : null;
}

const url = process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  lastMatch(/sb_secret_[A-Za-z0-9_\-]+/);
if (!key) throw new Error('Missing Supabase service key');

const supabase = createClient(url, key);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }
  return rows;
}

function blankToNull(value) {
  const t = value == null ? '' : String(value).trim();
  return t ? t : null;
}

async function deleteImportRowsFromCustomers() {
  for (const source of IMPORT_SOURCES) {
    let query = supabase.from(CUSTOMERS_TABLE).delete().eq('Source', source);
    const { data, error } = await query.select('id');
    if (error) throw new Error(`Cleanup ${CUSTOMERS_TABLE} Source=${source}: ${error.message}`);
    console.log(`Removed ${data?.length ?? 0} rows from ${CUSTOMERS_TABLE} where Source=${source}`);
  }
}

async function ensureTable(tableName) {
  const { error } = await supabase.from(tableName).select('id').limit(1);
  if (error) {
    throw new Error(
      `Table ${tableName} is not available (${error.message}). ` +
        'Run contract-analysis/supabase-final-format-tables.sql in the Supabase SQL editor, then retry.',
    );
  }
}

async function uploadCsv(tableName, csvPath) {
  const raw = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
  const matrix = parseCsv(raw);
  const headers = matrix[0];
  const dataRows = matrix.slice(1);

  await ensureTable(tableName);

  const { error: delError } = await supabase.from(tableName).delete().gte('created_at', '1970-01-01');
  if (delError) throw new Error(`${tableName} clear: ${delError.message}`);

  const batchSize = 80;
  let inserted = 0;
  for (let i = 0; i < dataRows.length; i += batchSize) {
    const chunk = dataRows.slice(i, i + batchSize).map((cells) => {
      const record = {};
      for (let c = 0; c < headers.length; c += 1) {
        record[headers[c]] = blankToNull(cells[c]);
      }
      return record;
    });
    const { error } = await supabase.from(tableName).insert(chunk);
    if (error) throw new Error(`${tableName} insert: ${error.message}`);
    inserted += chunk.length;
  }
  return inserted;
}

async function main() {
  if (process.env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_URL) {
    const { spawnSync } = await import('node:child_process');
    const ddl = spawnSync(process.execPath, ['tmp-apply-ddl-pg.mjs'], {
      cwd: path.dirname(fileURLToPath(import.meta.url)),
      stdio: 'inherit',
      env: process.env,
    });
    if (ddl.status !== 0) {
      console.warn('DDL via Postgres failed; ensure supabase-final-format-tables.sql was run in SQL editor.');
    }
  }

  await deleteImportRowsFromCustomers();

  for (const job of UPLOADS) {
    const csvPath = path.join(ROOT, job.csv);
    if (!fs.existsSync(csvPath)) throw new Error(`Missing ${csvPath}`);
    const count = await uploadCsv(job.table, csvPath);
    console.log(`Uploaded ${count} rows -> public.${job.table}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
