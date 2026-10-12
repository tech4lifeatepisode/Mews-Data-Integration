/**
 * Extract contract_drive_uploads rows with ai_extraction = Yes from the
 * Google Drive folder in Supabase Storage, using the sandbox Mews prompt.
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { isEnvTruthy } from './extract-from-storage.mjs';
import {
  CUSTOMER_HEADERS,
  LOG_HEADERS,
  extractContract,
  toCustomerRow,
  toCompanyRow,
  filledCount,
  missingKeyFields,
  mimeFromName,
  fileFormat,
  ncFromFileName,
} from './extraction sandbox/extract.mjs';

/** Dots are not usable in PostgREST table names, so 12.10.2026 is written with underscores. */
export const DRIVE_EXTRACTION_TABLE = 'Contracts_Extraction_12_10_2026';
export const DRIVE_EXTRACTION_LOG_TABLE = 'Logged_Extractions_12_10_2026';

const PAGE = 1000;
/** A 23.7MB file peaked near 224MB RSS. The next file, 30.8MB, killed the 512MB process before a failure row could be saved. */
const MAX_EXTRACT_BYTES = 25 * 1024 * 1024;
const MODEL_TIMEOUT_MS = 5 * 60 * 1000;

function supabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  return createClient(url, key);
}

function storageFolder() {
  return (process.env.SUPABASE_STORAGE_FOLDER || process.env.SUPABASE_UPLOAD_FOLDER || 'Google Drive')
    .replace(/^\/+|\/+$/g, '');
}

function blankToNull(value) {
  const text = value == null ? '' : String(value).trim();
  return text ? text : null;
}

async function selectAll(supabase, build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

async function yesUploadRows(supabase) {
  return selectAll(supabase, (from, to) =>
    supabase
      .from('contract_drive_uploads')
      .select(
        'id, drive_name, storage_path, storage_bucket, file_format, nc_number, mime_type, size_bytes, status, item_type, ai_extraction',
      )
      .eq('ai_extraction', 'Yes')
      .eq('item_type', 'file')
      .eq('status', 'uploaded')
      .order('storage_path', { ascending: true })
      .range(from, to),
  );
}

async function alreadySuccessful(supabase) {
  const rows = await selectAll(supabase, (from, to) =>
    supabase
      .from(DRIVE_EXTRACTION_LOG_TABLE)
      .select('storage_path, document, status')
      .eq('status', 'success')
      .range(from, to),
  );
  const paths = new Set();
  for (const row of rows) {
    if (row.storage_path) paths.add(row.storage_path);
    if (row.document) paths.add(row.document);
  }
  return paths;
}

function inGoogleDriveFolder(storagePath, folder) {
  const pathValue = String(storagePath || '').replace(/^\/+/, '');
  return pathValue === folder || pathValue.startsWith(`${folder}/`);
}

async function downloadObject(supabase, bucket, objectPath) {
  const { data, error } = await supabase.storage.from(bucket).download(objectPath);
  if (error) throw new Error(error.message);
  const bytes = Buffer.from(await data.arrayBuffer());
  return bytes;
}

function customerRecord(parsed, fileName, uploadRow) {
  const { row, tenancyDays, companions } = toCustomerRow(parsed, fileName);
  const company = toCompanyRow(parsed);
  if (company && !row['Tax Identification Number'] && company['Tax ID Number']) {
    row['Tax Identification Number'] = company['Tax ID Number'];
  }
  const record = {
    storage_path: uploadRow.storage_path,
    drive_upload_id: uploadRow.id,
    source_document: uploadRow.drive_name,
  };
  for (const header of CUSTOMER_HEADERS) record[header] = blankToNull(row[header]);
  return { record, row, tenancyDays, companions, parsed };
}

function logRecord(fields) {
  const record = { storage_path: fields.storage_path || null };
  for (const header of LOG_HEADERS) record[header] = blankToNull(fields[header]);
  return record;
}

async function insertRow(supabase, table, record) {
  const { error } = await supabase.from(table).insert(record);
  if (error) throw new Error(`${table}: ${error.message}`);
}

export async function runDriveAiExtraction() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  const supabase = supabaseClient();
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: MODEL_TIMEOUT_MS,
    maxRetries: 0,
  });
  const folder = storageFolder();
  const bucketDefault = process.env.SUPABASE_STORAGE_BUCKET || 'Contracts';
  const limit = Math.max(1, Number(process.env.MAX_EXTRACTION_FILES) || 10);
  const skipDone = isEnvTruthy('SKIP_ALREADY_EXTRACTED') || process.env.SKIP_ALREADY_EXTRACTED == null;

  const uploads = (await yesUploadRows(supabase)).filter((row) =>
    inGoogleDriveFolder(row.storage_path, folder),
  );
  const attempted = new Set();
  let success = 0;
  let failed = 0;
  let remaining = uploads.length;

  while (true) {
    const done = skipDone ? await alreadySuccessful(supabase) : new Set();
    const pending = uploads.filter((row) => {
      const key = row.storage_path || row.drive_name;
      if (!key || attempted.has(key)) return false;
      return !done.has(row.storage_path) && !done.has(row.drive_name);
    });
    remaining = pending.length;
    const batch = pending.slice(0, limit);
    if (!batch.length) break;
    console.log(`Drive AI extraction: ${batch.length} in this batch, ${pending.length} still pending`);

    for (const upload of batch) {
      attempted.add(upload.storage_path || upload.drive_name);
      // #region agent log
      fetch('http://127.0.0.1:7786/ingest/4229d02c-1770-4fd5-9da6-3795ca151e32',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'002cbb'},body:JSON.stringify({sessionId:'002cbb',hypothesisId:'B',location:'extract-drive-ai.mjs:loop-start',message:'before file',data:{bytes:upload.size_bytes??null,pending:pending.length,rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    const started = Date.now();
    const fileName = upload.drive_name || path.basename(upload.storage_path || 'document');
    const mimeType = upload.mime_type || mimeFromName(fileName) || 'application/pdf';
    const baseLog = {
      timestamp: new Date().toISOString(),
      document: fileName,
      file_format: upload.file_format || fileFormat(fileName),
      file_bytes: upload.size_bytes != null ? String(upload.size_bytes) : '',
      model: process.env.OPENAI_MODEL_DEFAULT || 'gpt-5.2-2025-12-11',
      nc_number: upload.nc_number || ncFromFileName(fileName),
      storage_path: upload.storage_path,
    };
    try {
      if (upload.size_bytes != null && Number(upload.size_bytes) > MAX_EXTRACT_BYTES) {
        throw new Error(
          `File is ${upload.size_bytes} bytes, over the ${MAX_EXTRACT_BYTES} byte limit for a 512MB instance`,
        );
      }
      const bucket = upload.storage_bucket || bucketDefault;
      let bytes = await downloadObject(supabase, bucket, upload.storage_path);
      baseLog.file_bytes = String(bytes.length);
      if (bytes.length > MAX_EXTRACT_BYTES) {
        const size = bytes.length;
        bytes = null;
        throw new Error(`File is ${size} bytes, over the ${MAX_EXTRACT_BYTES} byte limit for a 512MB instance`);
      }
      // #region agent log
      fetch('http://127.0.0.1:7786/ingest/4229d02c-1770-4fd5-9da6-3795ca151e32',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'002cbb'},body:JSON.stringify({sessionId:'002cbb',hypothesisId:'A',location:'extract-drive-ai.mjs:after-download',message:'file downloaded',data:{bytes:bytes.length,rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const parsed = await extractContract(client, fileName, bytes, mimeType);
      bytes = null;
      const { record, row, tenancyDays, companions } = customerRecord(parsed, fileName, upload);
      await insertRow(supabase, DRIVE_EXTRACTION_TABLE, record);
      await insertRow(
        supabase,
        DRIVE_EXTRACTION_LOG_TABLE,
        logRecord({
          ...baseLog,
          status: 'success',
          failure_reason: '',
          duration_ms: String(Date.now() - started),
          guest_name: [row['First Name'], row['Last Name(*)'], row['Second Last Name']].filter(Boolean).join(' '),
          arrival_date: row['Arrival Date(*)'],
          departure_date: row['Departure Date(*)'],
          tenancy_days: tenancyDays,
          unit: row['Allocated Room Category(*)'],
          meal_plan_extracted: parsed.meal_plan_present ? 'yes' : 'no',
          parking_extracted: parsed.parking_present ? 'yes' : 'no',
          guarantor_extracted: parsed.has_guarantor ? 'yes' : 'no',
          other_guest_count: String(companions.length),
          customer_fields_filled: String(filledCount(row)),
          key_fields_missing: missingKeyFields(row, parsed),
        }),
      );
      success += 1;
      console.log(`OK: ${upload.storage_path}`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      try {
        await insertRow(
          supabase,
          DRIVE_EXTRACTION_LOG_TABLE,
          logRecord({
            ...baseLog,
            status: 'failed',
            failure_reason: message,
            duration_ms: String(Date.now() - started),
            guest_name: '',
            arrival_date: '',
            departure_date: '',
            tenancy_days: '',
            unit: '',
            meal_plan_extracted: '',
            parking_extracted: '',
            guarantor_extracted: '',
            other_guest_count: '',
            customer_fields_filled: '',
            key_fields_missing: '',
          }),
        );
      } catch (logError) {
        console.error('Could not write extraction log:', logError instanceof Error ? logError.message : logError);
      }
      // #region agent log
      fetch('http://127.0.0.1:7786/ingest/4229d02c-1770-4fd5-9da6-3795ca151e32',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'002cbb'},body:JSON.stringify({sessionId:'002cbb',runId:'post-fix',hypothesisId:'A',location:'extract-drive-ai.mjs:catch',message:'file failed',data:{bytes:baseLog.file_bytes,overLimit:message.includes('512MB'),rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      console.error(`FAIL: ${upload.storage_path} — ${message}`);
    }
  }
  }

  return {
    ok: true,
    folder,
    eligible: uploads.length,
    pending: remaining,
    attempted: attempted.size,
    success,
    failed,
    extractionTable: DRIVE_EXTRACTION_TABLE,
    logTable: DRIVE_EXTRACTION_LOG_TABLE,
  };
}

const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isCli) {
  runDriveAiExtraction()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
