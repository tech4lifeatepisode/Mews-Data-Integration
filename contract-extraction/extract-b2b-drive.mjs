/**
 * Render job: B2B contracts with ai_extraction=Yes in the Supabase Google Drive
 * folder. One customer row per NC, one company row per partner.
 */
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import {
  COMPANY_HEADERS,
  CUSTOMER_HEADERS,
  MODEL,
} from './extraction sandbox/sandbox-common.mjs';
import {
  expandB2bNcs,
  extractB2bContract,
  ncsFromLabel,
  toB2bCompanyRow,
  toB2bCustomerRows,
} from './extraction sandbox/extract-b2b.mjs';

export const B2B_COMPANIES_TABLE = 'Companies_Extraction_12_10_2026';
const CUSTOMERS =
  process.env.DRIVE_EXTRACTION_TABLE || 'Customers_Contracts_Extraction_12_10_2026';
const LOG = 'Logged_Extractions_12_10_2026';
const MAX_EXTRACT_BYTES = 25 * 1024 * 1024;

/** Requested B2B NCs. NC_1875, NC_1920, and NC_1954 are excluded. */
export function b2bNcAllowlist() {
  const ncs = new Set([1892, 1928, 1913, 1941, 2082, 2083, 2084, 2085]);
  for (let n = 1963; n <= 2030; n += 1) ncs.add(n);
  for (let n = 2037; n <= 2065; n += 1) ncs.add(n);
  return ncs;
}

function supabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  return createClient(url, key);
}

function blankToNull(value) {
  const cleaned = value == null ? '' : String(value).trim();
  return cleaned ? cleaned : null;
}

function daysBetween(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) return null;
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return String(Math.round(ms / 86400000));
}

async function selectAll(supabase, build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function coversAllowlist(row, allowlist) {
  const blob = `${row.nc_number || ''} ${row.storage_path || ''} ${row.drive_name || ''}`;
  const numbered = ncsFromLabel(blob);
  if (numbered.some((nc) => allowlist.has(nc))) return true;
  const single = Number(row.nc_number);
  return allowlist.has(single);
}

export async function runB2bDriveExtraction() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  const supabase = supabaseClient();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 5 * 60 * 1000, maxRetries: 0 });
  const allowlist = b2bNcAllowlist();
  const companyProbe = await supabase.from(B2B_COMPANIES_TABLE).select('id').limit(1);
  const companiesReady = !companyProbe.error;

  const uploads = await selectAll(supabase, (from, to) =>
    supabase
      .from('contract_drive_uploads')
      .select('id, drive_name, storage_path, mime_type, size_bytes, file_format, nc_number')
      .eq('ai_extraction', 'Yes')
      .eq('item_type', 'file')
      .eq('status', 'uploaded')
      .order('storage_path', { ascending: true })
      .range(from, to),
  );
  const files = uploads
    .filter((row) => coversAllowlist(row, allowlist))
    .filter((row) => String(row.storage_path || '').replace(/^\/+/, '').startsWith('Google Drive'))
    .sort((a, b) => (/ADENDA|CONSTANCIA/i.test(a.drive_name || '') ? 1 : 0) - (/ADENDA|CONSTANCIA/i.test(b.drive_name || '') ? 1 : 0));

  const saved = await selectAll(supabase, (from, to) =>
    supabase.from(CUSTOMERS).select('"Group Code"').range(from, to),
  );
  const seenNcs = new Set();
  for (const row of saved) {
    const match = String(row['Group Code'] || '').match(/(\d+)/);
    if (match) seenNcs.add(Number(match[1]));
  }
  const seenCompanies = new Set();
  let customers = 0;
  let companies = 0;
  let failed = 0;

  for (const upload of files) {
    const labelNcs = ncsFromLabel(`${upload.storage_path} ${upload.drive_name}`).filter((nc) => allowlist.has(nc));
    if (labelNcs.length && labelNcs.every((nc) => seenNcs.has(nc)) && !companiesReady) continue;
    const started = Date.now();
    try {
      if (upload.size_bytes != null && Number(upload.size_bytes) > MAX_EXTRACT_BYTES) {
        throw new Error(`File is ${upload.size_bytes} bytes, over the ${MAX_EXTRACT_BYTES} byte limit`);
      }
      const { data: file, error: downloadError } = await supabase.storage.from('Contracts').download(upload.storage_path);
      if (downloadError) throw new Error(downloadError.message);
      const bytes = Buffer.from(await file.arrayBuffer());
      if (bytes.length > MAX_EXTRACT_BYTES) {
        throw new Error(`File is ${bytes.length} bytes, over the ${MAX_EXTRACT_BYTES} byte limit`);
      }
      const parsed = await extractB2bContract(client, upload.drive_name, bytes, upload.mime_type || 'application/pdf');
      const companyName = String(parsed.company_name || '').replace(/^[:\s]+/, '').trim();
      if (!companyName) throw new Error('Company name was not found in the contract.');
      const companyKey = companyName.toLowerCase();
      if (companiesReady && !seenCompanies.has(companyKey)) {
        const { data: existingCompany, error: companyReadError } = await supabase
          .from(B2B_COMPANIES_TABLE)
          .select('id')
          .eq('"Company Name(*)"', companyName)
          .limit(1);
        if (companyReadError) throw new Error(companyReadError.message);
        if (!existingCompany?.length) {
          const record = { storage_path: upload.storage_path, source_document: upload.drive_name };
          const companyRow = toB2bCompanyRow(parsed);
          for (const header of COMPANY_HEADERS) record[header] = blankToNull(companyRow[header]);
          const { error } = await supabase.from(B2B_COMPANIES_TABLE).insert(record);
          if (error) throw new Error(`${B2B_COMPANIES_TABLE}: ${error.message}`);
          companies += 1;
        }
        seenCompanies.add(companyKey);
      }
      const ncs = expandB2bNcs(`${upload.storage_path} ${upload.drive_name}`, parsed).filter((nc) => allowlist.has(nc));
      if (String(upload.storage_path).includes('NC_1890_1891_1892_INTEGRA')) ncs.push(1941);
      const wanted = [...new Set(ncs)].filter((nc) => allowlist.has(nc) && !seenNcs.has(nc));
      const forced = { ...parsed, nc_numbers: wanted, nc_range_start: null, nc_range_end: null };
      const customerRows = toB2bCustomerRows(forced, upload.drive_name).filter((row) => {
        const match = String(row['Group Code'] || '').match(/(\d+)/);
        return match && !seenNcs.has(Number(match[1]));
      });
      for (const row of customerRows) {
        const nc = Number(String(row['Group Code']).replace(/^NC_/, ''));
        seenNcs.add(nc);
        const record = {
          storage_path: upload.storage_path,
          drive_upload_id: upload.id,
          source_document: upload.drive_name,
        };
        for (const header of CUSTOMER_HEADERS) record[header] = blankToNull(row[header]);
        const { error } = await supabase.from(CUSTOMERS).insert(record);
        if (error) throw new Error(`${CUSTOMERS}: ${error.message}`);
        const { error: logError } = await supabase.from(LOG).insert({
          storage_path: upload.storage_path,
          timestamp: new Date().toISOString(),
          document: upload.drive_name,
          file_format: upload.file_format || 'PDF',
          file_bytes: String(bytes.length),
          status: 'success',
          failure_reason: null,
          model: MODEL,
          duration_ms: String(Date.now() - started),
          nc_number: String(nc),
          guest_name: companyName,
          arrival_date: blankToNull(row['Arrival Date(*)']),
          departure_date: blankToNull(row['Departure Date(*)']),
          tenancy_days: daysBetween(row['Arrival Date(*)'], row['Departure Date(*)']),
          unit: blankToNull(row['Allocated Room Category(*)']),
          meal_plan_extracted: 'no',
          parking_extracted: 'no',
          guarantor_extracted: 'no',
          other_guest_count: '0',
          customer_fields_filled: String(Object.values(record).filter(Boolean).length),
          key_fields_missing: null,
        });
        if (logError) throw new Error(`${LOG}: ${logError.message}`);
        customers += 1;
      }
      console.log(`B2B OK: ${upload.drive_name} customers=${customerRows.length}`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await supabase.from(LOG).insert({
        storage_path: upload.storage_path,
        timestamp: new Date().toISOString(),
        document: upload.drive_name,
        file_format: upload.file_format || 'PDF',
        file_bytes: upload.size_bytes == null ? null : String(upload.size_bytes),
        status: 'failed',
        failure_reason: message,
        model: MODEL,
        duration_ms: String(Date.now() - started),
      });
      console.error(`B2B FAIL: ${upload.drive_name} — ${message}`);
    }
  }

  return {
    ok: true,
    companiesTable: B2B_COMPANIES_TABLE,
    companiesReady,
    files: files.length,
    customers,
    companies,
    failed,
  };
}
