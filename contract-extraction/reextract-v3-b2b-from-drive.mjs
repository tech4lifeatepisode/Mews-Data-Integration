/**
 * Re-extract full contract fields for every NC in V3_Final_B2B_All_Fields_Match_Mews_Import_20_10_2026
 * from Google Drive (Supabase Storage). Updates Customers_Contracts_Extraction_12_10_2026, then
 * optionally rebuilds Final_Format customers and V3 B2B import table.
 *
 * CLI:
 *   node reextract-v3-b2b-from-drive.mjs [--dry-run] [--nc=1006] [--rebuild]
 * Render:
 *   POST/GET /extract-v3-b2b-contracts?rebuild=1
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { isChamariEntity, stripChamariFromCustomerRow } from './chamari-strip.mjs';
import { clean } from './company-match-utils.mjs';
import { plainTextFromContractBuffer } from './contract-plain-text.mjs';
import {
  isIndividualDeOtraParte,
  parseDeOtraParteCompany,
} from './b2b-de-otra-parte-extract.mjs';
import { DRIVE_EXTRACTION_LOG_TABLE } from './extract-drive-ai.mjs';
import { findContractUploadForNc, mimeForUpload, ncLabel } from './drive-contract-upload.mjs';
import { COMPANY_HEADERS, CUSTOMER_HEADERS } from './extraction sandbox/sandbox-common.mjs';
import {
  extractContract,
  toCustomerRow,
  toCompanyRow,
  filledCount,
  missingKeyFields,
  LOG_HEADERS,
} from './extraction sandbox/extract.mjs';
import {
  extractB2bContract,
  toB2bCompanyRow,
  toB2bCustomerRows,
} from './extraction sandbox/extract-b2b.mjs';

const V3_B2B = 'V3_Final_B2B_All_Fields_Match_Mews_Import_20_10_2026';
const CUSTOMERS_EXT = 'Customers_Contracts_Extraction_12_10_2026';
const COMPANIES_EXT = 'Companies_Extraction_12_10_2026';
const ALLOWLIST_JSON = 'v3-b2b-nc-allowlist.json';
const MAX_EXTRACT_BYTES = 25 * 1024 * 1024;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'Contracts';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '.env') });
dotenv.config({ path: path.join(here, 'extraction sandbox', '.env') });

function loadSupabaseKey() {
  const transcript =
    'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
  const transcriptText = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    [...transcriptText.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0]
  );
}

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

function blankToNull(value) {
  const text = value == null ? '' : String(value).trim();
  return text ? text : null;
}

async function fetchAll(sb, table, select = '*') {
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

function rowMatchesNc(row, nc) {
  const label = ncLabel(nc);
  if (row.nc_number != null && Number(row.nc_number) === nc) return true;
  const gc = clean(row['Group Code']);
  const notes = clean(row['Internal Guest Notes']);
  return gc === label || gc === String(nc) || notes.includes(label) || gc.includes(label);
}

function mergeDeOtraIntoB2bParsed(parsed, deOtra) {
  if (!deOtra || deOtra.client_type !== 'company') return parsed;
  const out = { ...parsed };
  if (deOtra.company_name && (!out.company_name || isChamariEntity(out.company_name))) {
    out.company_name = deOtra.company_name;
  }
  if (deOtra.tax_id_number && (!out.tax_id_number || isChamariEntity(out.tax_id_number))) {
    out.tax_id_number = deOtra.tax_id_number;
    out.fiscal_identifier = deOtra.tax_id_number;
  }
  if (deOtra.address_line_1 && !out.address_line_1) out.address_line_1 = deOtra.address_line_1;
  if (deOtra.contact_person && !out.contact_person) out.contact_person = deOtra.contact_person;
  return out;
}

function customerRecordFromRow(row, upload) {
  const record = {
    storage_path: upload.storage_path,
    drive_upload_id: upload.id,
    source_document: upload.drive_name,
  };
  for (const header of CUSTOMER_HEADERS) record[header] = blankToNull(row[header]);
  return record;
}

async function upsertCustomerByNc(sb, nc, row, upload, dryRun) {
  const record = customerRecordFromRow(row, upload);
  const existing = (await fetchAll(sb, CUSTOMERS_EXT)).filter((r) => rowMatchesNc(r, nc));
  if (dryRun) return { updated: existing.length, inserted: existing.length ? 0 : 1 };
  if (existing.length) {
    for (const r of existing) {
      const { error } = await sb.from(CUSTOMERS_EXT).update(record).eq('id', r.id);
      if (error) throw error;
    }
    return { updated: existing.length, inserted: 0 };
  }
  const { error } = await sb.from(CUSTOMERS_EXT).insert(record);
  if (error) throw error;
  return { updated: 0, inserted: 1 };
}

async function upsertCompanyFromB2b(sb, parsed, upload, dryRun) {
  const companyRow = toB2bCompanyRow(parsed);
  const name = clean(companyRow['Company Name(*)']);
  if (!name || isChamariEntity(name)) return false;
  const { data: existing } = await sb.from(COMPANIES_EXT).select('id').eq('Company Name(*)', name).limit(1);
  if (existing?.length) return false;
  const record = { storage_path: upload.storage_path, source_document: upload.drive_name };
  for (const h of COMPANY_HEADERS) record[h] = blankToNull(companyRow[h]);
  if (dryRun) return true;
  const { error } = await sb.from(COMPANIES_EXT).insert(record);
  if (error) throw error;
  return true;
}

async function writeExtractionLog(sb, fields, dryRun) {
  if (dryRun) return;
  const record = { storage_path: fields.storage_path || null };
  for (const header of LOG_HEADERS) record[header] = blankToNull(fields[header]);
  const { error } = await sb.from(DRIVE_EXTRACTION_LOG_TABLE).insert(record);
  if (error) console.error('log insert failed', error.message);
}

async function extractRowForNcFromBytes(openai, upload, nc, bytes) {
  const fileName = upload.drive_name || path.basename(upload.storage_path || 'contract');
  const mimeType = mimeForUpload(upload);
  const plain = plainTextFromContractBuffer(bytes, mimeType, fileName);
  const deOtra = plain ? parseDeOtraParteCompany(plain) : null;
  const individual =
    deOtra?.client_type === 'individual' || (plain && isIndividualDeOtraParte(plain));

  if (individual) {
    const parsed = await extractContract(openai, fileName, bytes, mimeType);
    const { row, tenancyDays, companions } = toCustomerRow(parsed, fileName);
    row['Group Code'] = ncLabel(nc);
    row['Internal Guest Notes'] = ncLabel(nc);
    stripChamariFromCustomerRow(row);
    const company = toCompanyRow(parsed);
    if (company && !row['Tax Identification Number'] && company['Tax ID Number']) {
      row['Tax Identification Number'] = company['Tax ID Number'];
    }
    stripChamariFromCustomerRow(row);
    return { mode: 'b2c', parsed, row, tenancyDays, companions };
  }

  try {
    let parsed = await extractB2bContract(openai, fileName, bytes, mimeType);
    parsed = mergeDeOtraIntoB2bParsed(parsed, deOtra);
    if (isChamariEntity(parsed.company_name)) {
      throw new Error('B2B company is CHAMARI');
    }

    const rows = toB2bCustomerRows(parsed, fileName);
    let row = rows.find((r) => {
      const m = String(r['Group Code'] || '').match(/(\d+)/);
      return m && Number(m[1]) === nc;
    });
    if (!row && rows.length === 1) {
      row = { ...rows[0] };
      row['Group Code'] = ncLabel(nc);
      row['Internal Guest Notes'] = ncLabel(nc);
    }
    if (!row) throw new Error(`B2B extract did not return row for NC_${nc}`);
    return { mode: 'b2b', parsed, row, tenancyDays: null, companions: [] };
  } catch (b2bError) {
    const parsed = await extractContract(openai, fileName, bytes, mimeType);
    const { row, tenancyDays, companions } = toCustomerRow(parsed, fileName);
    row['Group Code'] = ncLabel(nc);
    row['Internal Guest Notes'] = ncLabel(nc);
    stripChamariFromCustomerRow(row);
    return {
      mode: 'b2c_fallback',
      parsed,
      row,
      tenancyDays,
      companions,
      b2bError: b2bError instanceof Error ? b2bError.message : String(b2bError),
    };
  }
}

async function loadTargetNcs(sb, ncFilter) {
  let fromDb = [];
  try {
    fromDb = await fetchAll(sb, V3_B2B, 'nc_number');
  } catch {
    fromDb = [];
  }
  let ncs = fromDb.map((r) => Number(r.nc_number)).filter(Number.isFinite);
  if (!ncs.length) {
    const allowPath = path.join(here, ALLOWLIST_JSON);
    if (!fs.existsSync(allowPath)) throw new Error(`No rows in ${V3_B2B} and missing ${ALLOWLIST_JSON}`);
    ncs = JSON.parse(fs.readFileSync(allowPath, 'utf8'));
  }
  ncs = [...new Set(ncs)].sort((a, b) => a - b);
  if (ncFilter?.size) ncs = ncs.filter((nc) => ncFilter.has(nc));
  return ncs;
}

function runNodeScript(scriptName) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(here, scriptName)], {
      cwd: here,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${scriptName} exited ${code}`))));
  });
}

export async function runV3B2bContractReextract(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const rebuild = Boolean(options.rebuild);
  const ncFilter = options.ncFilter ?? null;

  const key = loadSupabaseKey();
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
  const url = process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co';
  const sb = createClient(url, key);

  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 5 * 60 * 1000,
    maxRetries: 0,
  });

  const targets = await loadTargetNcs(sb, ncFilter);
  const uploads = await fetchAll(
    sb,
    'contract_drive_uploads',
    'id, drive_name, storage_path, mime_type, size_bytes, file_format, nc_number, ai_extraction, status, item_type',
  );
  const uploadFiles = uploads.filter(
    (u) => u.item_type === 'file' && u.status === 'uploaded' && u.ai_extraction === 'Yes',
  );

  console.log(JSON.stringify({ dryRun, rebuild, targetNcs: targets.length, sample: targets.slice(0, 12) }, null, 2));

  const results = [];
  for (const nc of targets) {
    const upload = findContractUploadForNc(uploadFiles, nc);
    if (!upload) {
      results.push({ nc, status: 'no_upload' });
      continue;
    }
    const started = Date.now();
    const fileName = upload.drive_name || path.basename(upload.storage_path || 'document');
    try {
      if (upload.size_bytes != null && Number(upload.size_bytes) > MAX_EXTRACT_BYTES) {
        throw new Error(`File too large (${upload.size_bytes} bytes)`);
      }
      const { data, error: dlErr } = await sb.storage.from(BUCKET).download(upload.storage_path);
      if (dlErr) throw dlErr;
      const bytes = Buffer.from(await data.arrayBuffer());
      if (bytes.length > MAX_EXTRACT_BYTES) throw new Error(`Downloaded ${bytes.length} bytes, over limit`);

      const extracted = await extractRowForNcFromBytes(openai, upload, nc, bytes);
      const upsert = await upsertCustomerByNc(sb, nc, extracted.row, upload, dryRun);
      let companyInserted = false;
      if (extracted.mode === 'b2b') {
        companyInserted = await upsertCompanyFromB2b(sb, extracted.parsed, upload, dryRun);
      }

      await writeExtractionLog(
        sb,
        {
          timestamp: new Date().toISOString(),
          document: fileName,
          file_format: upload.file_format || 'PDF',
          file_bytes: String(bytes.length),
          status: 'success',
          failure_reason: '',
          model: process.env.OPENAI_MODEL_DEFAULT || 'gpt-5.2-2025-12-11',
          duration_ms: String(Date.now() - started),
          nc_number: String(nc),
          storage_path: upload.storage_path,
          guest_name: [extracted.row['First Name'], extracted.row['Last Name(*)']].filter(Boolean).join(' '),
          arrival_date: extracted.row['Arrival Date(*)'],
          departure_date: extracted.row['Departure Date(*)'],
          tenancy_days: extracted.tenancyDays != null ? String(extracted.tenancyDays) : '',
          unit: extracted.row['Allocated Room Category(*)'],
          meal_plan_extracted: extracted.mode === 'b2c' && extracted.parsed?.meal_plan_present ? 'yes' : 'no',
          parking_extracted: extracted.mode === 'b2c' && extracted.parsed?.parking_present ? 'yes' : 'no',
          guarantor_extracted: extracted.mode === 'b2c' && extracted.parsed?.has_guarantor ? 'yes' : 'no',
          other_guest_count: String(extracted.companions?.length || 0),
          customer_fields_filled: String(filledCount(extracted.row)),
          key_fields_missing:
            extracted.mode === 'b2c' ? missingKeyFields(extracted.row, extracted.parsed) : '',
        },
        dryRun,
      );

      results.push({
        nc,
        status: 'ok',
        mode: extracted.mode,
        upload: upload.drive_name,
        partner: extracted.row['Partner Company'],
        upsert,
        companyInserted,
      });
      console.log(
        `OK NC_${nc} [${extracted.mode}]: ${extracted.row['Partner Company'] || extracted.row['Last Name(*)']} ← ${upload.drive_name}`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await writeExtractionLog(
        sb,
        {
          timestamp: new Date().toISOString(),
          document: fileName,
          file_format: upload.file_format || 'PDF',
          file_bytes: upload.size_bytes != null ? String(upload.size_bytes) : '',
          status: 'failed',
          failure_reason: message,
          model: process.env.OPENAI_MODEL_DEFAULT || 'gpt-5.2-2025-12-11',
          duration_ms: String(Date.now() - started),
          nc_number: String(nc),
          storage_path: upload.storage_path,
        },
        dryRun,
      );
      results.push({ nc, status: 'failed', error: message, upload: upload.drive_name });
      console.error(`FAIL NC_${nc}: ${message}`);
    }
  }

  const summary = {
    dryRun,
    rebuild,
    targetNcs: targets.length,
    ok: results.filter((r) => r.status === 'ok').length,
    failed: results.filter((r) => r.status === 'failed').length,
    noUpload: results.filter((r) => r.status === 'no_upload').length,
    results,
  };

  const outPath = path.join(here, 'reextract-v3-b2b-results.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`Wrote ${outPath}`);

  if (rebuild && !dryRun && summary.ok > 0) {
    console.log('Rebuilding Final_Format customers from 12_10…');
    await runNodeScript('build-upload-final-format-customers.mjs');
    console.log('Rebuilding V3 B2B Mews import table…');
    await runNodeScript('upload-v3-b2b-mews-import-20-10-2026.mjs');
  }

  return summary;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) {
  const dryRun = process.argv.includes('--dry-run');
  const rebuild = process.argv.includes('--rebuild');
  const ncFilter = parseNcFilterArg(process.argv);
  runV3B2bContractReextract({ dryRun, rebuild, ncFilter }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
