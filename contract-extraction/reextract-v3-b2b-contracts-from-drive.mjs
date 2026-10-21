/**
 * Full contract re-extraction for every NC in V3_Final_B2B_All_Fields_Match_Mews_Import_20_10_2026.
 * Reads contracts from Supabase Storage (Google Drive folder), updates
 * Customers_Contracts_Extraction_12_10_2026 (+ Companies when B2B).
 *
 * After this job on Render, run locally or on CI:
 *   node build-upload-final-format-customers.mjs
 *   node upload-v2-mews-import-19-10-2026.mjs
 *   node upload-v3-b2b-mews-import-20-10-2026.mjs
 *
 * CLI: node reextract-v3-b2b-contracts-from-drive.mjs [--dry-run] [--nc=2037,2038] [--limit=20]
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { isChamariEntity, stripChamariFromCustomerRow } from './chamari-strip.mjs';
import { clean } from './company-match-utils.mjs';
import { plainTextFromContractBuffer } from './contract-plain-text.mjs';
import {
  filterDriveExtractableUploads,
  findBestUploadForNc,
  ncLabel,
} from './contract-drive-nc-upload.mjs';
import { parseNcNumbersFromQuery } from './parse-nc-query.mjs';
import { extractClientCompanyFromContract, isIndividualDeOtraParte } from './b2b-de-otra-parte-extract.mjs';
import {
  COMPANY_HEADERS,
  CUSTOMER_HEADERS,
  MODEL,
  mimeFromName,
} from './extraction sandbox/sandbox-common.mjs';
import {
  extractB2bContract,
  ncsFromLabel,
  toB2bCompanyRow,
  toB2bCustomerRows,
} from './extraction sandbox/extract-b2b.mjs';
import {
  extractContract,
  filledCount,
  missingKeyFields,
  toCustomerRow,
  toCompanyRow,
} from './extraction sandbox/extract.mjs';

const V3_B2B = 'V3_Final_B2B_All_Fields_Match_Mews_Import_20_10_2026';
const CUSTOMERS_EXT = 'Customers_Contracts_Extraction_12_10_2026';
const COMPANIES_EXT = 'Companies_Extraction_12_10_2026';
const LOG_TABLE = 'Logged_Extractions_12_10_2026';
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'Contracts';
const MAX_EXTRACT_BYTES = 25 * 1024 * 1024;

const here = path.dirname(fileURLToPath(import.meta.url));
const V3_B2B_NC_ALLOWLIST_JSON = path.join(here, 'v3-b2b-nc-allowlist.json');
dotenv.config({ path: path.join(here, '.env') });
dotenv.config({ path: path.join(here, 'extraction sandbox', '.env') });

function loadBundledV3B2bNcs() {
  if (!fs.existsSync(V3_B2B_NC_ALLOWLIST_JSON)) return [];
  return JSON.parse(fs.readFileSync(V3_B2B_NC_ALLOWLIST_JSON, 'utf8'))
    .map((n) => Number(n))
    .filter(Number.isFinite);
}

function supabaseKey() {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    null
  );
}

function createSb() {
  const key = supabaseKey();
  const url = process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co';
  if (!key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

function blankToNull(value) {
  const text = value == null ? '' : String(value).trim();
  return text ? text : null;
}

function parseNcFilterArg(argv) {
  const ncArg = argv.find((a) => a.startsWith('--nc='));
  if (!ncArg) return null;
  const ncs = parseNcNumbersFromQuery(ncArg.slice(5));
  return ncs.length ? new Set(ncs) : null;
}

function rowMatchesNc(row, nc) {
  const label = ncLabel(nc);
  if (row.nc_number != null && Number(row.nc_number) === nc) return true;
  const gc = clean(row['Group Code']);
  const notes = clean(row['Internal Guest Notes']);
  return gc === label || gc === String(nc) || notes.includes(label) || gc.includes(label);
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

function contractLooksB2bCompany(plainText) {
  return /De otra parte,[\s\S]{0,1200}?sociedad\s+constituida/i.test(String(plainText || ''));
}

async function mergeClientCompanyOntoB2bParsed(client, fileName, bytes, mimeType, parsed) {
  if (!isChamariEntity(parsed.company_name) && !isChamariEntity(parsed.tax_id_number)) return parsed;
  const fixed = await extractClientCompanyFromContract(client, fileName, bytes, mimeType);
  if (fixed.client_type === 'individual') {
    return { ...parsed, company_name: null, tax_id_number: null, fiscal_identifier: null };
  }
  return {
    ...parsed,
    company_name: fixed.company_name || parsed.company_name,
    tax_id_number: fixed.tax_id_number || parsed.tax_id_number,
    fiscal_identifier: fixed.fiscal_identifier || fixed.tax_id_number,
    address_line_1: fixed.address_line_1 || parsed.address_line_1,
    city: fixed.city || parsed.city,
    postal_code: fixed.postal_code || parsed.postal_code,
    contact_person: fixed.contact_person || parsed.contact_person,
    invoicing_email: fixed.invoicing_email || parsed.invoicing_email,
    telephone: fixed.telephone || parsed.telephone,
  };
}

function customerRecordFromRow(row, upload, extractionMode) {
  const record = {
    storage_path: upload.storage_path,
    drive_upload_id: upload.id,
    source_document: upload.drive_name,
  };
  for (const header of CUSTOMER_HEADERS) record[header] = blankToNull(row[header]);
  stripChamariFromCustomerRow(record);
  return record;
}

async function upsertCustomersForNc(sb, nc, record, dryRun) {
  const rows = await fetchAll(sb, CUSTOMERS_EXT);
  const ids = rows.filter((r) => rowMatchesNc(r, nc)).map((r) => r.id);
  if (dryRun) return { updated: ids.length, inserted: ids.length ? 0 : 1 };
  if (ids.length) {
    for (const id of ids) {
      const { error } = await sb.from(CUSTOMERS_EXT).update(record).eq('id', id);
      if (error) throw error;
    }
    return { updated: ids.length, inserted: 0 };
  }
  const { error } = await sb.from(CUSTOMERS_EXT).insert(record);
  if (error) throw error;
  return { updated: 0, inserted: 1 };
}

async function upsertCompanyFromParsed(sb, parsed, upload, dryRun) {
  const companyRow = toB2bCompanyRow(parsed);
  const name = clean(companyRow['Company Name(*)']);
  if (!name || isChamariEntity(name)) return false;
  const record = {
    storage_path: upload.storage_path,
    source_document: upload.drive_name,
  };
  for (const header of COMPANY_HEADERS) record[header] = blankToNull(companyRow[header]);
  if (dryRun) return true;
  const { data: existing } = await sb
    .from(COMPANIES_EXT)
    .select('id')
    .filter('Company Name(*)', 'eq', name)
    .limit(1);
  if (existing?.length) return false;
  const { error } = await sb.from(COMPANIES_EXT).insert(record);
  if (error) throw error;
  return true;
}

async function writeLog(sb, fields, dryRun) {
  if (dryRun) return;
  const record = {};
  for (const [k, v] of Object.entries(fields)) record[k] = blankToNull(v);
  const { error } = await sb.from(LOG_TABLE).insert(record);
  if (error) console.error('Log insert failed:', error.message);
}

function pickB2bRowForNc(parsed, fileName, nc) {
  const forced = { ...parsed, nc_numbers: [nc], nc_range_start: null, nc_range_end: null };
  const rows = toB2bCustomerRows(forced, fileName);
  const label = ncLabel(nc);
  return rows.find((r) => clean(r['Group Code']) === label) || rows[0];
}

/**
 * @param {{ dryRun?: boolean, ncFilter?: Set<number>|null, limit?: number, force?: boolean }} [options]
 */
export async function runV3B2bContractReextract(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const ncFilter = options.ncFilter ?? null;
  const limit =
    options.limit != null && Number.isFinite(Number(options.limit))
      ? Math.max(1, Number(options.limit))
      : 9999;

  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

  const sb = createSb();
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 5 * 60 * 1000,
    maxRetries: 0,
  });

  const uploadsRaw = await fetchAll(
    sb,
    'contract_drive_uploads',
    'id, drive_name, storage_path, storage_bucket, mime_type, size_bytes, file_format, nc_number, ai_extraction, status, item_type',
  );

  const ncSet = new Set(loadBundledV3B2bNcs());
  if (!ncSet.size) {
    throw new Error(`Missing ${V3_B2B_NC_ALLOWLIST_JSON} — cannot determine V3 B2B NC list`);
  }
  if (process.env.V3_B2B_REEXTRACT_NCS_FROM_TABLE === 'true') {
    try {
      const v3Rows = await fetchAll(sb, V3_B2B, 'nc_number');
      for (const row of v3Rows) {
        const nc = Number(row.nc_number);
        if (Number.isFinite(nc)) ncSet.add(nc);
      }
    } catch (e) {
      console.warn(
        `Optional ${V3_B2B} nc_number read failed (using allowlist only):`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  let targets = [...ncSet].sort((a, b) => a - b);
  if (ncFilter?.size) {
    const filtered = targets.filter((nc) => ncFilter.has(nc));
    if (filtered.length) targets = filtered;
    else {
      console.warn(
        `ncFilter matched 0 NCs (filter=${JSON.stringify([...ncFilter].slice(0, 20))}); using full allowlist`,
      );
    }
  }
  targets = targets.slice(0, limit);

  const uploads = filterDriveExtractableUploads(uploadsRaw);

  console.log(
    JSON.stringify(
      {
        dryRun,
        ncSource: 'v3-b2b-nc-allowlist.json',
        v3B2bNcs: ncSet.size,
        targets: targets.length,
        sample: targets.slice(0, 12),
      },
      null,
      2,
    ),
  );

  const results = [];
  for (let i = 0; i < targets.length; i += 1) {
    const nc = targets[i];
    if (i > 0 && i % 10 === 0) {
      console.log(
        `V3 B2B re-extract: ${i} processed, ${targets.length - i} remaining (Drive-style batch progress)`,
      );
    }
    const upload = findBestUploadForNc(uploads, nc);
    if (!upload) {
      results.push({ nc, status: 'no_upload' });
      console.error(`FAIL: (no upload) NC_${nc} — no contract file in Google Drive folder`);
      continue;
    }

    const started = Date.now();
    const fileName = upload.drive_name || path.basename(upload.storage_path);
    const mimeType = upload.mime_type || mimeFromName(fileName) || 'application/pdf';
    const baseLog = {
      timestamp: new Date().toISOString(),
      document: fileName,
      file_format: upload.file_format || 'PDF',
      file_bytes: upload.size_bytes != null ? String(upload.size_bytes) : '',
      model: process.env.OPENAI_MODEL_DEFAULT || MODEL,
      nc_number: String(nc),
      storage_path: upload.storage_path,
    };

    try {
      if (upload.size_bytes != null && Number(upload.size_bytes) > MAX_EXTRACT_BYTES) {
        throw new Error(`File too large (${upload.size_bytes} bytes)`);
      }
      const bucket = upload.storage_bucket || BUCKET;
      const { data, error: dlErr } = await sb.storage.from(bucket).download(upload.storage_path);
      if (dlErr) throw dlErr;
      const bytes = Buffer.from(await data.arrayBuffer());
      if (bytes.length > MAX_EXTRACT_BYTES) throw new Error(`Downloaded ${bytes.length} bytes, over limit`);

      const plain = plainTextFromContractBuffer(bytes, mimeType, fileName);
      const useB2b = contractLooksB2bCompany(plain) && !isIndividualDeOtraParte(plain);

      let extractionMode = useB2b ? 'b2b' : 'b2c';
      let row;
      let parsed;
      let companyInserted = false;

      if (useB2b) {
        parsed = await extractB2bContract(client, fileName, bytes, mimeType);
        parsed = await mergeClientCompanyOntoB2bParsed(client, fileName, bytes, mimeType, parsed);
        row = pickB2bRowForNc(parsed, fileName, nc);
        if (!row) throw new Error('B2B extract produced no customer row for NC');
        companyInserted = await upsertCompanyFromParsed(sb, parsed, upload, dryRun);
      } else {
        parsed = await extractContract(client, fileName, bytes, mimeType);
        const { row: b2cRow } = toCustomerRow(parsed, fileName);
        row = b2cRow;
        row['Group Code'] = ncLabel(nc);
        row['Internal Guest Notes'] = ncLabel(nc);
        const company = toCompanyRow(parsed);
        if (company && !isChamariEntity(company['Company Name(*)'])) {
          row['Partner Company'] = company['Company Name(*)'];
          row['Company Id'] = company['Company Name(*)'];
          if (company['Tax ID Number']) row['Tax Identification Number'] = company['Tax ID Number'];
        } else {
          try {
            const fixed = await extractClientCompanyFromContract(client, fileName, bytes, mimeType);
            if (fixed.client_type === 'individual') {
              row['Partner Company'] = null;
              row['Company Id'] = null;
              row['Tax Identification Number'] = null;
            } else if (fixed.company_name) {
              row['Partner Company'] = fixed.company_name;
              row['Company Id'] = fixed.company_name;
              row['Tax Identification Number'] = fixed.tax_id_number || null;
              companyInserted = await upsertCompanyFromParsed(
                sb,
                { ...fixed, anexo_ii_notes: null },
                upload,
                dryRun,
              );
            }
          } catch {
            stripChamariFromCustomerRow(row);
          }
        }
        extractionMode = 'b2c';
      }

      const record = customerRecordFromRow(row, upload, extractionMode);
      const counts = await upsertCustomersForNc(sb, nc, record, dryRun);

      const siblingNcs = [
        ...new Set(
          ncsFromLabel(`${upload.storage_path || ''} ${upload.drive_name || ''}`).filter(
            (n) => n !== nc && ncSet.has(n),
          ),
        ),
      ];
      for (const sibling of siblingNcs) {
        const siblingRecord = customerRecordFromRow(
          { ...row, 'Group Code': ncLabel(sibling), 'Internal Guest Notes': ncLabel(sibling) },
          upload,
          extractionMode,
        );
        await upsertCustomersForNc(sb, sibling, siblingRecord, dryRun);
      }

      await writeLog(
        sb,
        {
          ...baseLog,
          status: 'success',
          failure_reason: '',
          duration_ms: String(Date.now() - started),
          guest_name: [record['First Name'], record['Last Name(*)'], record['Second Last Name']]
            .filter(Boolean)
            .join(' '),
          arrival_date: record['Arrival Date(*)'],
          departure_date: record['Departure Date(*)'],
          unit: record['Allocated Room Category(*)'],
          customer_fields_filled: String(filledCount(row)),
          key_fields_missing: useB2b ? '' : missingKeyFields(row, parsed),
        },
        dryRun,
      );

      results.push({
        nc,
        status: 'ok',
        mode: extractionMode,
        upload: fileName,
        company: record['Partner Company'],
        tax: record['Tax Identification Number'],
        counts,
        companyInserted,
      });
      console.log(
        `OK: ${upload.storage_path || fileName} (NC_${nc}, ${extractionMode}, updated=${counts.updated}, inserted=${counts.inserted})`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await writeLog(
        sb,
        {
          ...baseLog,
          status: 'failed',
          failure_reason: message,
          duration_ms: String(Date.now() - started),
        },
        dryRun,
      );
      results.push({ nc, status: 'failed', error: message, upload: fileName });
      console.error(`FAIL NC_${nc}: ${message}`);
    }
  }

  const summary = {
    dryRun,
    v3B2bTable: V3_B2B,
    targetNcs: targets.length,
    ok: results.filter((r) => r.status === 'ok').length,
    failed: results.filter((r) => r.status === 'failed').length,
    noUpload: results.filter((r) => r.status === 'no_upload').length,
    results,
    nextSteps: [
      'node build-upload-final-format-customers.mjs',
      'node upload-v2-mews-import-19-10-2026.mjs',
      'node upload-v3-b2b-mews-import-20-10-2026.mjs',
    ],
  };

  const outPath = path.join(here, 'reextract-v3-b2b-contracts-results.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`Wrote ${outPath}`);
  return summary;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) {
  const dryRun = process.argv.includes('--dry-run');
  const ncFilter = parseNcFilterArg(process.argv);
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice(8)) : undefined;
  runV3B2bContractReextract({ dryRun, ncFilter, limit }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
