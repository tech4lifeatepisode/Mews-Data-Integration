/**
 * Copy contract extraction from multi-NC Drive folders (e.g. NC_2037-2065) onto each NC row.
 * Run after V3 B2B re-extract, before build-upload-final-format-customers.mjs.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
import { createClient } from '@supabase/supabase-js';
import { ncsFromLabel } from './extraction sandbox/extract-b2b.mjs';
import { CUSTOMER_HEADERS } from './extraction sandbox/sandbox-common.mjs';
import { clean } from './company-match-utils.mjs';

const CUSTOMERS_EXT = 'Customers_Contracts_Extraction_12_10_2026';
const here = path.dirname(__filename);
dotenv.config({ path: path.join(here, '.env') });
dotenv.config({ path: path.join(here, 'extraction sandbox', '.env') });

const url = process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!key) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY');
const sb = createClient(url, key);

function ncLabel(n) {
  return `NC_${String(n).padStart(4, '0')}`;
}

function rowMatchesNc(row, nc) {
  const label = ncLabel(nc);
  if (row.nc_number != null && Number(row.nc_number) === nc) return true;
  const gc = clean(row['Group Code']);
  const notes = clean(row['Internal Guest Notes']);
  return gc === label || gc === String(nc) || notes.includes(label);
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

function cloneForNc(template, nc) {
  const label = ncLabel(nc);
  const record = {};
  for (const h of CUSTOMER_HEADERS) record[h] = template[h] ?? null;
  record['Group Code'] = label;
  record['Internal Guest Notes'] = label;
  record.storage_path = template.storage_path;
  record.drive_upload_id = template.drive_upload_id;
  record.source_document = template.source_document;
  return record;
}

export async function runPropagateCustomersExtMultiNc() {
  const rows = await fetchAll(CUSTOMERS_EXT);
  const byPath = new Map();
  for (const row of rows) {
    const blob = `${row.storage_path || ''} ${row.source_document || ''} ${row['Group Code'] || ''}`;
    const ncs = ncsFromLabel(blob);
    if (ncs.length < 2) continue;
    const key = String(row.storage_path || row.source_document || ncs.join(','));
    if (!byPath.has(key)) byPath.set(key, { ncs, template: row });
  }

  let updated = 0;
  let inserted = 0;
  for (const { ncs, template } of byPath.values()) {
    for (const nc of ncs) {
      const existing = rows.filter((r) => rowMatchesNc(r, nc));
      const patch = cloneForNc(template, nc);
      if (existing.length) {
        for (const row of existing) {
          const { error } = await sb.from(CUSTOMERS_EXT).update(patch).eq('id', row.id);
          if (error) throw error;
          updated += 1;
        }
      } else {
        const { error } = await sb.from(CUSTOMERS_EXT).insert(patch);
        if (error) throw error;
        inserted += 1;
      }
    }
  }
  return { multiNcGroups: byPath.size, updated, inserted };
}

async function main() {
  const result = await runPropagateCustomersExtMultiNc();
  console.log(JSON.stringify(result, null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
