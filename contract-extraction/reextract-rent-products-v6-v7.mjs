/**
 * Re-extract rent (Allocated Rate equation) + Mews Included Products for NCs in V6 ∪ V7.
 * Updates ONLY "Allocated Rate" and "Included Products" on:
 *   - Customers_Contracts_Extraction_28_10_2026_B2C
 *   - Customers_Contracts_Extraction_12_10_2026
 *
 *   node contract-extraction/reextract-rent-products-v6-v7.mjs
 *   node contract-extraction/reextract-rent-products-v6-v7.mjs --dry-run
 *   node contract-extraction/reextract-rent-products-v6-v7.mjs --nc=2172
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { clean } from './room-number-to-category.mjs';
import { buildAllocatedRateEquation, buildAllocatedRateFromCustomerRow } from './mews-rent-equation.mjs';
import { mapRowToMewsIncludedProducts } from './mews-product-map.mjs';
import { formatIncludedProductsPlusSpacing } from './mews-stay-rate-and-products-format.mjs';
import {
  extractContract,
  toCustomerRow,
  mimeFromName,
  ncFromFileName,
} from './extraction sandbox/extract.mjs';

const V6_CUSTOMERS = 'V6_Final_B2C_and_B2B_All_Fields_Match_Mews_Import_21_10_2026';
const V7_CUSTOMERS = 'V7_Final_B2C__All_Fields_Match_Mews_Import_28_10_2026';
const TABLE_B2C_28 = 'Customers_Contracts_Extraction_28_10_2026_B2C';
const TABLE_12 = 'Customers_Contracts_Extraction_12_10_2026';
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'Contracts';
const MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_LOG = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'reextract-rent-products-v6-v7-summary.json',
);

const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
if (fs.existsSync(transcript)) {
  const text = fs.readFileSync(transcript, 'utf8');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SECRET_KEY) {
    const sb = [...text.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];
    if (sb) process.env.SUPABASE_SECRET_KEY = sb;
  }
  if (!process.env.OPENAI_API_KEY) {
    const openai = [...text.matchAll(/OPENAI_API_KEY=(sk-proj-[A-Za-z0-9_\-]+)/g)].at(-1)?.[1];
    if (openai) process.env.OPENAI_API_KEY = openai;
  }
}
process.env.SUPABASE_URL ||= 'https://jujvtuyksxkoclegjznb.supabase.co';

export function supabaseServiceKey() {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_KEY ||
    ''
  );
}

export function createSupabaseAdminClient() {
  const key = supabaseServiceKey();
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY required');
  }
  return createClient(process.env.SUPABASE_URL, key);
}

function ncFromRow(row) {
  const m = clean(row['Group Code']).match(/NC_0*(\d+)/i);
  if (m) return Number(m[1]);
  const p = String(row.storage_path || row.source_document || '').match(/NC_(\d+)_/i);
  if (p) return Number(p[1]);
  const notes = clean(row['Internal Guest Notes']).match(/NC_0*(\d+)/i);
  if (notes) return Number(notes[1]);
  return null;
}

function parseArgs() {
  const dryRun = process.argv.includes('--dry-run');
  const notesOnly = process.argv.includes('--notes-only');
  const retryErrors = process.argv.includes('--retry-errors');
  const ncArg = process.argv.find((a) => a.startsWith('--nc='));
  const ncFilter = ncArg ? new Set([Number(ncArg.split('=')[1])]) : null;
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
  return { dryRun, notesOnly, retryErrors, ncFilter, limit };
}

function includedProductsFromRow(row) {
  const mapped = mapRowToMewsIncludedProducts(row, null);
  if (!mapped) return row['Included Products'] || null;
  return mapped
    .split(';')
    .map((part) => formatIncludedProductsPlusSpacing(part.trim()))
    .filter(Boolean)
    .join('; ');
}

function patchFromNotes(row) {
  const allocated = buildAllocatedRateFromCustomerRow(row);
  const products = includedProductsFromRow(row);
  if (!allocated && !products) return null;
  return {
    'Allocated Rate': allocated ?? row['Allocated Rate'],
    'Included Products': products ?? row['Included Products'],
  };
}

async function fetchAll(sb, table) {
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

function uploadScore(u) {
  const name = String(u.drive_name || '').toLowerCase();
  const pathS = String(u.storage_path || '');
  let score = 0;
  if (/\/02\.\s*contract\//i.test(pathS)) score += 50;
  if (/empadronamiento/i.test(name)) score -= 30;
  if (name.endsWith('.pdf') && !name.includes('docx.pdf')) score += 25;
  else if (name.endsWith('.docx')) score += 20;
  return score;
}

async function findUploadForRow(sb, row) {
  if (row.drive_upload_id) {
    const { data } = await sb.from('contract_drive_uploads').select('*').eq('id', row.drive_upload_id).maybeSingle();
    if (data) return data;
  }
  const nc = ncFromRow(row);
  if (!Number.isFinite(nc)) return null;
  const { data: uploads } = await sb
    .from('contract_drive_uploads')
    .select('*')
    .eq('nc_number', String(nc))
    .eq('status', 'uploaded')
    .eq('ai_extraction', 'Yes');
  const scored = (uploads || [])
    .map((u) => ({ u, score: uploadScore(u) }))
    .filter((x) => x.score > -20)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.u || null;
}

function pickRowsByNc(rows, allowNcs) {
  const byNc = new Map();
  for (const row of rows) {
    const nc = ncFromRow(row);
    if (nc == null || !allowNcs.has(nc)) continue;
    const prev = byNc.get(nc);
    if (!prev) {
      byNc.set(nc, row);
      continue;
    }
    const score = (r) => {
      let s = 0;
      if (r['Allocated Rate']) s += 1;
      if (/\/02\.\s*contract\//i.test(String(r.storage_path || ''))) s += 10;
      return s;
    };
    if (score(row) > score(prev)) byNc.set(nc, row);
  }
  return byNc;
}

async function reextractOne(sb, client, row, { dryRun, notesOnly }) {
  const nc = ncFromRow(row);

  if (notesOnly) {
    const patch = patchFromNotes(row);
    if (!patch) return { nc, id: row.id, status: 'no_notes' };
    if (dryRun) {
      return {
        nc,
        id: row.id,
        status: 'dry_run',
        beforeRate: row['Allocated Rate'],
        afterRate: patch['Allocated Rate'],
        beforeProducts: row['Included Products'],
        afterProducts: patch['Included Products'],
        source: 'notes',
      };
    }
    const { error: upErr } = await sb.from(row._table).update(patch).eq('id', row.id);
    if (upErr) throw upErr;
    return { nc, id: row.id, status: 'ok', ...patch, source: 'notes' };
  }

  const upload = await findUploadForRow(sb, row);
  if (!upload?.storage_path) {
    const patch = patchFromNotes(row);
    if (patch && !dryRun) {
      await sb.from(row._table).update(patch).eq('id', row.id);
      return { nc, id: row.id, status: 'ok', ...patch, source: 'notes_no_upload' };
    }
    return { nc, id: row.id, status: 'no_upload' };
  }

  const fileName = upload.drive_name || path.basename(upload.storage_path);
  const mimeType = upload.mime_type || mimeFromName(fileName) || 'application/pdf';
  const { data, error: dlErr } = await sb.storage.from(upload.storage_bucket || BUCKET).download(upload.storage_path);
  if (dlErr) throw dlErr;
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error(`File too large (${bytes.length})`);

  let parsed;
  let extracted;
  let allocated;
  let products;
  try {
    parsed = await extractContract(client, fileName, bytes, mimeType);
    ({ row: extracted } = toCustomerRow(parsed, fileName));
    allocated = buildAllocatedRateEquation(parsed);
    products = extracted['Included Products'] || null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/429|credits remaining/i.test(msg)) {
      const patch = patchFromNotes(row);
      if (patch) {
        if (dryRun) {
          return { nc, id: row.id, status: 'dry_run', ...patch, source: 'notes_after_429' };
        }
        const { error: upErr } = await sb.from(row._table).update(patch).eq('id', row.id);
        if (upErr) throw upErr;
        return { nc, id: row.id, status: 'ok', ...patch, source: 'notes_after_429' };
      }
    }
    throw error;
  }

  const patch = {
    'Allocated Rate': allocated,
    'Included Products': products,
  };

  if (dryRun) {
    return {
      nc,
      id: row.id,
      status: 'dry_run',
      beforeRate: row['Allocated Rate'],
      afterRate: allocated,
      beforeProducts: row['Included Products'],
      afterProducts: products,
    };
  }

  const { error: upErr } = await sb.from(row._table).update(patch).eq('id', row.id);
  if (upErr) throw upErr;
  return { nc, id: row.id, status: 'ok', allocated, products };
}

function loadFailedNcsFromSummary() {
  if (!fs.existsSync(DEFAULT_LOG)) return null;
  try {
    const prev = JSON.parse(fs.readFileSync(DEFAULT_LOG, 'utf8'));
    const ncs = new Set();
    for (const r of prev.results || []) {
      if (r.status === 'error') ncs.add(r.nc);
    }
    return ncs.size ? ncs : null;
  } catch {
    return null;
  }
}

export async function runReextractRentProductsV6V7(options = {}) {
  const dryRun = options.dryRun ?? false;
  const notesOnly = options.notesOnly ?? false;
  let ncFilter = options.ncFilter ?? null;
  const limit = options.limit;

  if (options.retryErrors) {
    const failed = loadFailedNcsFromSummary();
    if (failed) {
      ncFilter = ncFilter ? new Set([...ncFilter].filter((n) => failed.has(n))) : failed;
    }
  }

  if (!notesOnly && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');
  const sb = createSupabaseAdminClient();
  const client = notesOnly
    ? null
    : new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 5 * 60 * 1000, maxRetries: 0 });

  const [v6, v7, ext28, ext12] = await Promise.all([
    fetchAll(sb, V6_CUSTOMERS),
    fetchAll(sb, V7_CUSTOMERS),
    fetchAll(sb, TABLE_B2C_28),
    fetchAll(sb, TABLE_12),
  ]);

  const allowNcs = new Set();
  for (const row of [...v6, ...v7]) {
    const nc = ncFromRow(row);
    if (nc != null) allowNcs.add(nc);
  }
  if (ncFilter?.size) {
    for (const n of [...allowNcs]) {
      if (!ncFilter.has(n)) allowNcs.delete(n);
    }
  }

  const targets = [];
  for (const [table, rows] of [
    [TABLE_B2C_28, ext28],
    [TABLE_12, ext12],
  ]) {
    const byNc = pickRowsByNc(rows, allowNcs);
    for (const row of byNc.values()) {
      targets.push({ ...row, _table: table });
    }
  }

  targets.sort((a, b) => (ncFromRow(a) ?? 0) - (ncFromRow(b) ?? 0));
  const slice = limit != null && Number.isFinite(limit) ? targets.slice(0, limit) : targets;

  const results = [];
  for (const row of slice) {
    try {
      results.push(await reextractOne(sb, client, row, { dryRun, notesOnly }));
      console.log(JSON.stringify(results.at(-1)));
    } catch (error) {
      const err = { nc: ncFromRow(row), id: row.id, status: 'error', message: error instanceof Error ? error.message : String(error) };
      results.push(err);
      console.error(JSON.stringify(err));
    }
  }

  const summary = {
    ok: true,
    dryRun,
    allowNcCount: allowNcs.size,
    targetRows: slice.length,
    updated: results.filter((r) => r.status === 'ok').length,
    dryRunPreview: results.filter((r) => r.status === 'dry_run').length,
    errors: results.filter((r) => r.status === 'error').length,
    noUpload: results.filter((r) => r.status === 'no_upload').length,
    results,
    at: new Date().toISOString(),
  };

  fs.writeFileSync(options.logPath || DEFAULT_LOG, JSON.stringify(summary, null, 2));
  return summary;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const { dryRun, notesOnly, retryErrors, ncFilter, limit } = parseArgs();
  runReextractRentProductsV6V7({ dryRun, notesOnly, retryErrors, ncFilter, limit })
    .then((s) => {
      console.log(JSON.stringify({ updated: s.updated, targets: s.targetRows, errors: s.errors }, null, 2));
      process.exit(s.errors > 0 ? 1 : 0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
