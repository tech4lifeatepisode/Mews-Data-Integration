/**
 * Copy Customers_Contracts_Extraction_12_10_2026 → current/future stays only
 * (no per-guest dedupe). Writes CSV + loads Final_Format_Customers_Contracts_Extraction_15_10_2026.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { CUSTOMER_HEADERS } from './extraction sandbox/sandbox-common.mjs';

const SOURCE_TABLE = 'Customers_Contracts_Extraction_12_10_2026';
const TARGET_TABLE = 'Final_Format_Customers_Contracts_Extraction_15_10_2026';
const AS_OF = process.env.AS_OF || '2026-10-15';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const csvOut = path.join(
  repoRoot,
  'contract-analysis',
  'External Data Sources',
  'Final Format_Customers_Contracts_Extraction_15.10.2026.csv',
);

const DATA_COLUMNS = [
  ...CUSTOMER_HEADERS,
  'storage_path',
  'drive_upload_id',
  'source_document',
];

const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
const text = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  [...text.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];
const url = process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co';
if (!key) throw new Error('Missing Supabase service key');

const supabase = createClient(url, key);

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function parseDate(value) {
  const v = clean(value);
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function departureDate(row) {
  return parseDate(row['Departure Date(*)'] || row['Departure Date']);
}

function arrivalDate(row) {
  return parseDate(row['Arrival Date(*)'] || row['Arrival Date']);
}

function isCurrentOrFuture(row, asOfIso) {
  const dep = departureDate(row);
  if (dep) return dep >= asOfIso;
  const arr = arrivalDate(row);
  if (arr) return arr >= asOfIso;
  const notes = clean(row['Reservation Notes']).toLowerCase();
  if (notes.includes('status: occupied') || notes.includes('status: booked')) return true;
  return false;
}

async function fetchAll(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + 999);
    if (error) throw new Error(`${table} select: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

function toExportRow(row) {
  const out = {};
  for (const col of DATA_COLUMNS) {
    const v = row[col];
    out[col] = v == null ? '' : String(v);
  }
  return out;
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(rows) {
  if (process.env.FF_SKIP_CSV_EXPORT === '1') return null;
  const lines = [DATA_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(DATA_COLUMNS.map((h) => csvEscape(row[h])).join(','));
  }
  try {
    fs.mkdirSync(path.dirname(csvOut), { recursive: true });
    fs.writeFileSync(csvOut, `\uFEFF${lines.join('\r\n')}`, 'utf8');
    return csvOut;
  } catch (e) {
    console.warn(`CSV export skipped (${csvOut}):`, e instanceof Error ? e.message : e);
    return null;
  }
}

function toInsertRow(row) {
  const out = {};
  for (const col of DATA_COLUMNS) {
    const v = row[col];
    out[col] = v == null || String(v).trim() === '' ? null : v;
  }
  return out;
}

async function uploadRows(rows) {
  const { error: tableError } = await supabase.from(TARGET_TABLE).select('id').limit(1);
  if (tableError) {
    throw new Error(
      `${tableError.message}. Run contract-analysis/supabase-final-format-customers-contracts-15-10-2026.sql in Supabase SQL editor first.`,
    );
  }

  const { error: delError } = await supabase.from(TARGET_TABLE).delete().gte('created_at', '1970-01-01');
  if (delError) throw new Error(`Clear ${TARGET_TABLE}: ${delError.message}`);

  const batchSize = 80;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize).map(toInsertRow);
    const { error } = await supabase.from(TARGET_TABLE).insert(chunk);
    if (error) throw new Error(`Insert ${TARGET_TABLE}: ${error.message}`);
  }
}

const asOfIso = AS_OF.slice(0, 10);
const all = await fetchAll(SOURCE_TABLE);
const kept = all.filter((row) => isCurrentOrFuture(row, asOfIso));
const exportRows = kept.map(toExportRow);

await uploadRows(kept);
const csvWritten = writeCsv(exportRows);

console.log(
  JSON.stringify(
    {
      sourceTable: SOURCE_TABLE,
      targetTable: TARGET_TABLE,
      asOf: asOfIso,
      sourceRows: all.length,
      currentOrFutureRows: kept.length,
      excludedPast: all.length - kept.length,
      csv: csvWritten,
      note: 'Multiple current/future rows per guest are kept (no dedupe).',
    },
    null,
    2,
  ),
);

console.log(`Uploaded ${kept.length} rows to public.${TARGET_TABLE}`);
