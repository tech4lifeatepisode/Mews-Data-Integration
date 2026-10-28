/**
 * Patch Supabase customer rows that still have CHAMARI landlord as Partner Company
 * using Companies_Extraction_12_10_2026 (nc_number → real client company).
 *
 *   node patch-chamari-from-companies-extract.mjs [--dry-run]
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { isChamariEntity, stripChamariFromCustomerRow } from './chamari-strip.mjs';
import { clean } from './company-match-utils.mjs';
import { pickCompaniesExtractByNc } from './b2b-partner-company-resolve.mjs';

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

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '.env') });
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

const dryRun = process.argv.includes('--dry-run');

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

function rowHasChamariCompany(row) {
  return (
    isChamariEntity(row?.['Partner Company']) ||
    isChamariEntity(row?.['Company Id']) ||
    isChamariEntity(row?.['Tax Identification Number'])
  );
}

function patchFromSources(nc, companiesExtract, v2CompanyByNc) {
  const co = pickCompaniesExtractByNc(nc, companiesExtract);
  const v2Co = v2CompanyByNc.get(nc);
  const name =
    clean(v2Co?.['Company Name(*)']) ||
    clean(co?.['Company Name(*)']);
  const tax =
    clean(v2Co?.['Tax ID Number']) ||
    clean(v2Co?.['Fiscal Identifier']) ||
    clean(co?.['Tax ID Number']) ||
    clean(co?.['Fiscal Identifier']);
  if (!name || isChamariEntity(name)) return null;
  const customerPatch = {
    'Partner Company': name,
    'Company Id': name,
    'Tax Identification Number': tax && !isChamariEntity(tax) ? tax : null,
  };
  stripChamariFromCustomerRow(customerPatch);
  return { customerPatch, companyPatch: co || v2Co };
}

async function updateByNc(table, nc, patch) {
  if (dryRun) {
    const { data } = await sb.from(table).select('id').eq('nc_number', nc).limit(5);
    return data?.length || 0;
  }
  const { data, error } = await sb.from(table).update(patch).eq('nc_number', nc).select('id');
  if (error) throw error;
  return data?.length || 0;
}

async function resolveV2CompaniesTable() {
  for (const t of V2_COMPANIES_CANDIDATES) {
    const { error } = await sb.from(t).select('nc_number').limit(1);
    if (!error) return t;
  }
  return null;
}

async function main() {
  let companiesExtract = [];
  try {
    companiesExtract = await fetchAll(COMPANIES_EXT);
  } catch (e) {
    console.warn(`Companies extract unavailable: ${e.message}`);
  }
  const v2CoTable = await resolveV2CompaniesTable();
  const v2CompanyRows = v2CoTable ? await fetchAll(v2CoTable) : [];
  const v2CompanyByNc = new Map(v2CompanyRows.map((r) => [Number(r.nc_number), r]));
  const byNc = new Map(companiesExtract.map((r) => [Number(r.nc_number), r]));

  const tables = [CUSTOMERS_EXT, FF_CUSTOMERS, V2_CUSTOMERS, V3_B2B];
  const chamariNcs = new Set();
  for (const table of tables) {
    let rows;
    try {
      rows = await fetchAll(table);
    } catch (e) {
      console.warn(`Skip ${table}: ${e.message}`);
      continue;
    }
    for (const row of rows) {
      if (!rowHasChamariCompany(row)) continue;
      const nc = Number(row.nc_number);
      if (Number.isFinite(nc)) chamariNcs.add(nc);
    }
  }

  const results = [];
  for (const nc of [...chamariNcs].sort((a, b) => a - b)) {
    const built = patchFromSources(nc, companiesExtract, v2CompanyByNc);
    if (!built) {
      results.push({ nc, status: 'no_company_extract' });
      continue;
    }
    const { customerPatch, companyPatch } = built;
    const counts = {};
    for (const table of tables) {
      try {
        counts[table] = await updateByNc(table, nc, customerPatch);
      } catch (e) {
        counts[table] = `err:${e.message}`;
      }
    }
    if (v2CoTable && companyPatch) {
      const coPatch = {
        'Company Name(*)': customerPatch['Partner Company'],
        'Tax ID Number': customerPatch['Tax Identification Number'],
        'Fiscal Identifier': customerPatch['Tax Identification Number'],
      };
      counts[v2CoTable] = await updateByNc(v2CoTable, nc, coPatch);
    }
    results.push({
      nc,
      status: 'patched',
      company: customerPatch['Partner Company'],
      tax: customerPatch['Tax Identification Number'],
      counts,
    });
    console.log(`NC_${nc} → ${customerPatch['Partner Company']}`);
  }

  const summary = {
    dryRun,
    chamariNcs: chamariNcs.size,
    patched: results.filter((r) => r.status === 'patched').length,
    noExtract: results.filter((r) => r.status === 'no_company_extract').length,
    companiesInExtract: byNc.size,
  };
  fs.writeFileSync(path.join(here, 'patch-chamari-from-companies-extract-results.json'), JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
