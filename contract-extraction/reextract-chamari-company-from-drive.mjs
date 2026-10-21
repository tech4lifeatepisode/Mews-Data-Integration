/**
 * Re-extract B2B client company ("De otra parte") for NCs wrongly tagged CHAMARI / B42861468.
 * Downloads PDFs from Supabase Storage (Google Drive folder), runs B2B AI extract, patches tables.
 *
 * Usage:
 *   node reextract-chamari-company-from-drive.mjs [--dry-run] [--nc=1006,1142]
 * Then: node build-upload-final-format-customers.mjs (optional refresh 15_10 from 12_10)
 *       node upload-v2-mews-import-19-10-2026.mjs
 *       node upload-v3-b2b-mews-import-20-10-2026.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { isChamariEntity, stripChamariFromCustomerRow } from './chamari-strip.mjs';
import { clean, normId } from './company-match-utils.mjs';
import {
  COMPANY_HEADERS,
  CUSTOMER_HEADERS,
} from './extraction sandbox/sandbox-common.mjs';
import { extractClientCompanyFromContract } from './b2b-de-otra-parte-extract.mjs';
import { toB2bCompanyRow } from './extraction sandbox/extract-b2b.mjs';

const CUSTOMERS_EXT = 'Customers_Contracts_Extraction_12_10_2026';
const COMPANIES_EXT = 'Companies_Extraction_12_10_2026';
const FF_CUSTOMERS = 'Final_Format_Customers_Contracts_Extraction_15_10_2026';
const V3_B2B = 'V3_Final_B2B_All_Fields_Match_Mews_Import_20_10_2026';
const V2_CUSTOMERS = 'V2_Final_Format_All_Fields_Match_Mews_Import_19_10_2026';
const V2_COMPANIES_CANDIDATES = [
  process.env.V2_COMPANIES_TABLE,
  'V2_Final_Format_All_Fields_Match_Mews_Import_Companies_19_10_2026',
  'V2_Final_Format_All_Fields_Match_Mews_Import_Companies_19_10_20',
].filter(Boolean);

const MAX_EXTRACT_BYTES = 25 * 1024 * 1024;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'Contracts';
const FOLDER = (process.env.SUPABASE_STORAGE_FOLDER || 'Google Drive').replace(/^\/+|\/+$/g, '');

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '.env') });
dotenv.config({ path: path.join(here, 'extraction sandbox', '.env') });
const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
const transcriptText = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  [...transcriptText.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];
const url = process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co';
if (!key) throw new Error('Missing Supabase service key');
const sb = createClient(url, key);

function parseNcFilterArg(argv) {
  const ncArg = argv.find((a) => a.startsWith('--nc='));
  if (!ncArg) return null;
  return new Set(
    ncArg
      .slice(5)
      .split(/[,;\s]+/)
      .map((s) => Number(s.replace(/^NC_/i, '')))
      .filter(Number.isFinite),
  );
}

function ncLabel(n) {
  return `NC_${String(n).padStart(4, '0')}`;
}

function rowHasChamariCompany(row) {
  if (!row) return false;
  return (
    isChamariEntity(row['Partner Company']) ||
    isChamariEntity(row['Company Id']) ||
    isChamariEntity(row['Tax Identification Number'])
  );
}

async function fetchAll(table, select = '*') {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(select).range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

function uploadScore(u, nc) {
  const label = ncLabel(nc);
  const pathS = String(u.storage_path || '');
  const name = String(u.drive_name || '').toLowerCase();
  const blob = `${pathS} ${name}`.toLowerCase();
  if (!pathS.replace(/^\/+/, '').startsWith(FOLDER)) return null;
  if (!pathS || u.mime_type === 'application/vnd.google-apps.folder') return null;
  if (name === '.keep' || blob.includes('/.keep')) return null;
  if (/payment|payments|renta|deposito|transferencia|justificante/.test(blob) && !/contract/.test(blob)) {
    return null;
  }

  let score = 0;
  if (Number(u.nc_number) === nc) score += 40;
  else if (blob.includes(label.toLowerCase())) score += 30;
  else if (new RegExp(`nc_0*${nc}(?:[^0-9]|$)`, 'i').test(blob)) score += 20;
  else return null;

  if (/\/02\.\s*contract\//i.test(pathS) || blob.includes('02. contract')) score += 50;
  if (name.endsWith('.docx')) score += 35;
  else if (name.endsWith('.pdf') && !name.includes('docx.pdf')) score += 25;
  else if (name.endsWith('docx.pdf')) score += 10;
  if (/\.(png|jpg|jpeg|webp|txt)$/.test(name)) score -= 40;
  return score;
}

function findUploadForNc(uploads, nc) {
  const scored = [];
  for (const u of uploads) {
    const score = uploadScore(u, nc);
    if (score != null) scored.push({ u, score });
  }
  scored.sort((a, b) => b.score - a.score || (b.u.size_bytes || 0) - (a.u.size_bytes || 0));
  return scored[0]?.u || null;
}

function companyPatchFromParsed(parsed) {
  if (parsed?.client_type === 'individual') {
    return {
      'Partner Company': null,
      'Company Id': null,
      'Tax Identification Number': null,
      companyRow: null,
      clearedIndividual: true,
    };
  }
  const name = clean(parsed.company_name)?.replace(/^[:\s]+/, '');
  const tax = clean(parsed.tax_id_number) || clean(parsed.fiscal_identifier);
  if (!name || isChamariEntity(name)) return null;
  if (tax && isChamariEntity(tax)) return null;
  return {
    'Partner Company': name,
    'Company Id': name,
    'Tax Identification Number': tax || null,
    companyRow: toB2bCompanyRow(parsed),
  };
}

let v2CompaniesTable = null;
async function resolveV2CompaniesTable() {
  if (v2CompaniesTable) return v2CompaniesTable;
  for (const name of V2_COMPANIES_CANDIDATES) {
    const { error } = await sb.from(name).select('id').limit(1);
    if (!error) {
      v2CompaniesTable = name;
      return name;
    }
  }
  return null;
}

function rowMatchesNc(row, nc) {
  const label = ncLabel(nc);
  if (row.nc_number != null && Number(row.nc_number) === nc) return true;
  const gc = clean(row['Group Code']);
  const notes = clean(row['Internal Guest Notes']);
  return gc === label || gc === String(nc) || notes.includes(label) || gc.includes(label);
}

async function updateRowsByNc(table, nc, patch, dryRun) {
  const rows = await fetchAll(table);
  const ids = rows.filter((row) => rowMatchesNc(row, nc)).map((r) => r.id);
  if (!ids.length) return 0;
  if (dryRun) return ids.length;
  let n = 0;
  for (const id of ids) {
    const { error: upErr } = await sb.from(table).update(patch).eq('id', id);
    if (upErr) throw upErr;
    n++;
  }
  return n;
}

async function upsertCompany(parsed, dryRun) {
  if (parsed?.client_type === 'individual') return false;
  const companyRow = toB2bCompanyRow(parsed);
  const name = clean(companyRow['Company Name(*)']);
  if (!name || isChamariEntity(name)) return false;
  const { data: existing } = await sb
    .from(COMPANIES_EXT)
    .select('id')
    .eq('Company Name(*)', name)
    .limit(1);
  if (existing?.length) return false;
  const record = {};
  for (const h of COMPANY_HEADERS) record[h] = clean(companyRow[h]) || null;
  if (dryRun) return true;
  const { error } = await sb.from(COMPANIES_EXT).insert(record);
  if (error) throw error;
  return true;
}

export async function runChamariCompanyReextract(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const ncFilter = options.ncFilter ?? null;
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY required for B2B company re-extraction');
  }
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 5 * 60 * 1000,
    maxRetries: 0,
  });

  const [v3b2b, v2cust, ffCust, uploads] = await Promise.all([
    fetchAll(V3_B2B),
    fetchAll(V2_CUSTOMERS),
    fetchAll(FF_CUSTOMERS),
    fetchAll(
      'contract_drive_uploads',
      'id, drive_name, storage_path, mime_type, size_bytes, file_format, nc_number, ai_extraction, status, item_type',
    ),
  ]);

  const uploadFiles = uploads.filter(
    (u) => u.item_type === 'file' && u.status === 'uploaded' && u.ai_extraction === 'Yes',
  );

  const ncSet = new Set();
  for (const row of [...v3b2b, ...v2cust, ...ffCust]) {
    if (!rowHasChamariCompany(row)) continue;
    const nc = Number(row.nc_number);
    if (Number.isFinite(nc)) ncSet.add(nc);
  }

  const targets = [...ncSet].filter((nc) => !ncFilter || ncFilter.has(nc)).sort((a, b) => a - b);
  console.log(JSON.stringify({ dryRun, targetNcs: targets.length, sample: targets.slice(0, 15) }, null, 2));

  const results = [];
  for (const nc of targets) {
    const upload = findUploadForNc(uploadFiles, nc);
    if (!upload) {
      results.push({ nc, status: 'no_upload' });
      continue;
    }
    try {
      if (upload.size_bytes != null && Number(upload.size_bytes) > MAX_EXTRACT_BYTES) {
        throw new Error(`File too large (${upload.size_bytes} bytes)`);
      }
      const { data, error: dlErr } = await sb.storage.from(BUCKET).download(upload.storage_path);
      if (dlErr) throw dlErr;
      const bytes = Buffer.from(await data.arrayBuffer());
      if (bytes.length > MAX_EXTRACT_BYTES) throw new Error(`Downloaded ${bytes.length} bytes, over limit`);

      const parsed = await extractClientCompanyFromContract(
        client,
        upload.drive_name || path.basename(upload.storage_path),
        bytes,
        upload.mime_type || 'application/pdf',
      );
      const patch = companyPatchFromParsed(parsed);
      if (!patch) throw new Error(`Model returned CHAMARI or empty company: ${parsed.company_name}`);

      const customerPatch = {
        'Partner Company': patch['Partner Company'],
        'Company Id': patch['Company Id'],
        'Tax Identification Number': patch['Tax Identification Number'],
      };
      stripChamariFromCustomerRow(customerPatch);

      const counts = {
        customersExt: await updateRowsByNc(CUSTOMERS_EXT, nc, customerPatch, dryRun),
        ffCustomers: await updateRowsByNc(FF_CUSTOMERS, nc, customerPatch, dryRun),
        v2Customers: await updateRowsByNc(V2_CUSTOMERS, nc, customerPatch, dryRun),
        v3B2b: await updateRowsByNc(V3_B2B, nc, customerPatch, dryRun),
        v2Companies: 0,
      };
      const v2CoTable = await resolveV2CompaniesTable();
      if (v2CoTable) {
        counts.v2Companies = await updateRowsByNc(
          v2CoTable,
          nc,
          {
            'Company Name(*)': patch['Partner Company'],
            'Tax ID Number': patch['Tax Identification Number'],
            'Fiscal Identifier': patch['Tax Identification Number'],
          },
          dryRun,
        );
      }

      const companyInserted = patch.clearedIndividual ? false : await upsertCompany(parsed, dryRun);

      results.push({
        nc,
        status: 'ok',
        company: patch['Partner Company'],
        tax: patch['Tax Identification Number'],
        clearedIndividual: Boolean(patch.clearedIndividual),
        upload: upload.drive_name,
        counts,
        companyInserted,
      });
      const okLabel = patch.clearedIndividual
        ? 'cleared CHAMARI (individual cliente)'
        : `${patch['Partner Company']} (${patch['Tax Identification Number'] || 'no tax'})`;
      console.log(`OK NC_${nc}: ${okLabel}`);
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null
            ? JSON.stringify(e)
            : String(e);
      results.push({ nc, status: 'failed', error: message, upload: upload?.drive_name });
      console.error(`FAIL NC_${nc}: ${message}`);
    }
  }

  const summary = {
    dryRun,
    targetNcs: targets.length,
    results,
    ok: results.filter((r) => r.status === 'ok').length,
    failed: results.filter((r) => r.status === 'failed').length,
    noUpload: results.filter((r) => r.status === 'no_upload').length,
  };
  const outPath = path.join(here, 'reextract-chamari-company-results.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`Wrote ${outPath}`);
  return summary;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) {
  const dryRun = process.argv.includes('--dry-run');
  const ncFilter = parseNcFilterArg(process.argv);
  runChamariCompanyReextract({ dryRun, ncFilter }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
