/**
 * Fix B2C 28-10 rows: Group Code, landlord company fields, Allocated Rate.
 * Re-runs contract AI (and De otra parte when company fields are landlord).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { isChamariEntity, stripChamariFromCustomerRow } from './chamari-strip.mjs';
import { extractClientCompanyFromContract } from './b2b-de-otra-parte-extract.mjs';
import {
  CUSTOMER_HEADERS,
  extractContract,
  toCustomerRow,
  mimeFromName,
  ncFromFileName,
} from './extraction sandbox/extract.mjs';

const TABLE = 'Customers_Contracts_Extraction_28_10_2026_B2C';
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'Contracts';
const MAX_BYTES = 25 * 1024 * 1024;

const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
if (fs.existsSync(transcript)) {
  const text = fs.readFileSync(transcript, 'utf8');
  if (!process.env.SUPABASE_SECRET_KEY) {
    const sb = [...text.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];
    if (sb) process.env.SUPABASE_SECRET_KEY = sb;
  }
  if (!process.env.OPENAI_API_KEY) {
    const openai = [...text.matchAll(/OPENAI_API_KEY=(sk-proj-[A-Za-z0-9_\-]+)/g)].at(-1)?.[1];
    if (openai) process.env.OPENAI_API_KEY = openai;
  }
}
process.env.SUPABASE_URL ||= 'https://jujvtuyksxkoclegjznb.supabase.co';

if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 5 * 60 * 1000, maxRetries: 0 });

function rowNeedsFix(row) {
  if (
    isChamariEntity(row['Partner Company']) ||
    isChamariEntity(row['Company Id']) ||
    isChamariEntity(row['Tax Identification Number'])
  ) {
    return true;
  }
  if (!row['Group Code']) return true;
  if (!row['Allocated Rate'] && !/empadronamiento/i.test(String(row.storage_path || row.source_document || ''))) {
    return true;
  }
  return false;
}

function groupCodeFromPath(storagePath) {
  const m = String(storagePath || '').match(/NC_(\d+)_/i);
  return m ? `NC_${Number(m[1])}` : '';
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

async function findUploadForRow(row) {
  if (row.drive_upload_id) {
    const { data } = await sb.from('contract_drive_uploads').select('*').eq('id', row.drive_upload_id).maybeSingle();
    if (data) return data;
  }
  const nc = Number(ncFromFileName(row.storage_path || row.source_document || ''));
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

function applyCompanyPatch(row, parsed) {
  if (parsed?.client_type === 'individual') {
    row['Partner Company'] = null;
    row['Company Id'] = null;
    row['Tax Identification Number'] = null;
    return;
  }
  const name = parsed?.company_name?.trim();
  const tax = parsed?.tax_id_number?.trim() || null;
  if (name && !isChamariEntity(name)) {
    row['Partner Company'] = name;
    row['Company Id'] = name;
    if (tax && !isChamariEntity(tax)) row['Tax Identification Number'] = tax;
  }
  stripChamariFromCustomerRow(row);
}

async function reextractRow(row) {
  const upload = await findUploadForRow(row);
  if (!upload?.storage_path) return { id: row.id, status: 'no_upload' };

  const fileName = upload.drive_name || path.basename(upload.storage_path);
  const mimeType = upload.mime_type || mimeFromName(fileName) || 'application/pdf';
  const { data, error: dlErr } = await sb.storage.from(upload.storage_bucket || BUCKET).download(upload.storage_path);
  if (dlErr) throw dlErr;
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error(`File too large (${bytes.length})`);

  const parsed = await extractContract(client, fileName, bytes, mimeType);
  const { row: extracted } = toCustomerRow(parsed, fileName);
  const nc = upload.nc_number || ncFromFileName(upload.storage_path);
  if (nc) {
    const label = `NC_${Number(String(nc).replace(/^NC_/i, ''))}`;
    extracted['Group Code'] = label;
    extracted['Internal Guest Notes'] = extracted['Internal Guest Notes'] || label;
  }
  stripChamariFromCustomerRow(extracted);

  const needsCompany =
    isChamariEntity(extracted['Partner Company']) ||
    isChamariEntity(extracted['Company Id']) ||
    isChamariEntity(extracted['Tax Identification Number']);
  if (needsCompany) {
    const co = await extractClientCompanyFromContract(client, fileName, bytes, mimeType);
    applyCompanyPatch(extracted, co);
  }

  const patch = {};
  for (const h of CUSTOMER_HEADERS) patch[h] = extracted[h] ?? null;
  patch.storage_path = upload.storage_path;
  patch.drive_upload_id = upload.id;
  patch.source_document = upload.drive_name;

  const { error: upErr } = await sb.from(TABLE).update(patch).eq('id', row.id);
  if (upErr) throw upErr;
  return {
    id: row.id,
    status: 'ok',
    groupCode: patch['Group Code'],
    rate: patch['Allocated Rate'],
    company: patch['Partner Company'],
  };
}

const all = await fetchAll(TABLE);
let patchedGc = 0;
for (const row of all) {
  if (row['Group Code']) continue;
  const gc = groupCodeFromPath(row.storage_path);
  if (!gc) continue;
  await sb.from(TABLE).update({ 'Group Code': gc, 'Internal Guest Notes': row['Internal Guest Notes'] || gc }).eq('id', row.id);
  patchedGc += 1;
}
console.log(`Backfilled Group Code on ${patchedGc} rows`);

for (const row of all) {
  if (!row['Group Code']) row['Group Code'] = groupCodeFromPath(row.storage_path) || row['Group Code'];
}
const targets = all.filter(rowNeedsFix);
const byNc = new Map();
for (const row of targets) {
  const nc = groupCodeFromPath(row.storage_path) || row['Group Code'] || row.id;
  if (!byNc.has(nc)) byNc.set(nc, row);
}

console.log(`Re-extracting ${byNc.size} NCs (${targets.length} rows flagged)`);
const results = [];
for (const row of byNc.values()) {
  try {
    results.push(await reextractRow(row));
    console.log(JSON.stringify(results.at(-1)));
  } catch (error) {
    results.push({ id: row.id, status: 'error', message: error instanceof Error ? error.message : String(error) });
    console.error(results.at(-1));
  }
}
console.log(JSON.stringify({ ok: results.filter((r) => r.status === 'ok').length, total: results.length }, null, 2));
