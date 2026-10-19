/**
 * Re-run AI extraction of rent sections f)/g) for NCs in Final_Format_Mismatch_Rent_15_10_2026
 * and update Final_Format + Customers_Contracts_Extraction_12_10_2026 Allocated Rate (g) over f)).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { MODEL, mimeFromName, prepareFileInput } from './extraction sandbox/sandbox-common.mjs';
import { isB2bContractAuthoritativeNc, loadB2bContractAuthoritativeNcs } from './b2b-contract-authoritative.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, 'extraction sandbox', '.env') });
dotenv.config({ path: path.join(here, '.env') });

export const MISMATCH_RENT = 'Final_Format_Mismatch_Rent_15_10_2026';
export const CUSTOMERS_FINAL = 'Final_Format_Customers_Contracts_Extraction_15_10_2026';
export const CUSTOMERS_EXT = 'Customers_Contracts_Extraction_12_10_2026';
export const DEFAULT_LOG_PATH = path.join(here, 'reextract-rent-mismatch-16-10-2026.json');

function ncNumbersFromRow(row) {
  const nums = new Set();
  for (const field of ['Group Code', 'Internal Guest Notes']) {
    for (const m of String(row?.[field] || '').matchAll(/NC_0*(\d+)/gi)) nums.add(Number(m[1]));
  }
  return [...nums];
}

async function fetchAllRows(sb, table) {
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

function indexExtByNc(extRows) {
  const map = new Map();
  for (const r of extRows) {
    for (const n of ncNumbersFromRow(r)) {
      if (!map.has(n)) map.set(n, r);
    }
  }
  return map;
}

async function applyRentPatch(sb, { finalId, extId, rentStr }) {
  const patch = { 'Allocated Rate': rentStr, 'Per Night Prices': rentStr };
  const out = { finalUpdated: false, extUpdated: false };
  if (finalId) {
    const { error } = await sb.from(CUSTOMERS_FINAL).update(patch).eq('id', finalId);
    if (error) throw new Error(`${CUSTOMERS_FINAL}: ${error.message}`);
    out.finalUpdated = true;
  }
  if (extId) {
    const { error } = await sb.from(CUSTOMERS_EXT).update(patch).eq('id', extId);
    if (error) throw new Error(`${CUSTOMERS_EXT}: ${error.message}`);
    out.extUpdated = true;
  }
  return out;
}

const RENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    precio_section_f_euros: { type: ['string', 'null'] },
    precio_section_f_text: { type: ['string', 'null'] },
    has_discount_section_g: { type: 'boolean' },
    discounted_monthly_amount_section_g_euros: { type: ['string', 'null'] },
    discount_section_g_text: { type: ['string', 'null'] },
    discount_applies_to_whole_stay: { type: ['boolean', 'null'] },
  },
  required: [
    'precio_section_f_euros',
    'precio_section_f_text',
    'has_discount_section_g',
    'discounted_monthly_amount_section_g_euros',
    'discount_section_g_text',
    'discount_applies_to_whole_stay',
  ],
};

export const RENT_SECTION_INSTRUCTIONS = `You are reading a Spanish NODE / Episode lodging contract. Look only at Anexo I Condiciones Particulares.

f) Precio: return the monthly price as written there (e.g. "920,00 €/mes (incluido el IVA del 10%)") in precio_section_f_text, and as digits with a decimal point in precio_section_f_euros (e.g. "920.00").

g) Descuento Aplicado en el Precio: if this section applies a discount, set has_discount_section_g = true, copy the key sentence into discount_section_g_text, and put the monthly amount the tenant actually pays after the discount in discounted_monthly_amount_section_g_euros (e.g. "el importe a abonar mensualmente será de 837,00 €" → "837.00"). Only fill discounted_monthly_amount_section_g_euros when the contract states that monthly amount explicitly; do not compute it. If the section says no discount applies, is empty or is missing, has_discount_section_g = false and the g fields are null.

discount_applies_to_whole_stay: true if the discounted amount applies to every month of the stay, false if it only applies to some months (e.g. only the first month), null if unclear.

Use only text in the document. Use null when a value is absent. Do not guess.`;

function clean(v) {
  return v == null ? '' : String(v).trim();
}

export function parseMoney(v) {
  const raw = clean(v);
  if (!raw) return null;
  let s = raw.replace(/[^\d.,-]/g, '');
  if (!s) return null;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function finalRentFromParsed(parsed) {
  const base = parseMoney(parsed.precio_section_f_euros);
  const discounted = parseMoney(parsed.discounted_monthly_amount_section_g_euros);
  if (parsed.has_discount_section_g && discounted != null && parsed.discount_applies_to_whole_stay !== false) {
    return { rent: discounted, rule: 'g_discounted_monthly' };
  }
  if (base != null) {
    return {
      rent: base,
      rule: parsed.has_discount_section_g ? 'f_precio_discount_not_whole_stay_or_no_amount' : 'f_precio_no_discount',
    };
  }
  return { rent: null, rule: 'no_price_found' };
}

export function supabaseServiceClient() {
  const url = process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY;
  if (key) return createClient(url, key);
  const transcript =
    process.env.REEXTRACT_TRANSCRIPT_PATH ||
    'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
  if (fs.existsSync(transcript)) {
    const fromTranscript = [...fs.readFileSync(transcript, 'utf8').matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];
    if (fromTranscript) return createClient(url, fromTranscript);
  }
  throw new Error('Set SUPABASE_SERVICE_ROLE_KEY or REEXTRACT_TRANSCRIPT_PATH for local runs.');
}

function loadLog(logPath) {
  if (!fs.existsSync(logPath)) return { results: [] };
  return JSON.parse(fs.readFileSync(logPath, 'utf8'));
}

function saveLog(logPath, log) {
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
}

export async function extractRentSection(client, fileName, bytes, mimeType) {
  const response = await client.responses.parse({
    model: MODEL,
    temperature: 0,
    max_output_tokens: 1500,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: `${RENT_SECTION_INSTRUCTIONS}\n\nFile name: ${fileName}` },
          prepareFileInput(bytes, mimeType, fileName),
        ],
      },
    ],
    text: { format: { type: 'json_schema', name: 'contract_rent_section', strict: true, schema: RENT_SCHEMA } },
  });
  if (response.output_parsed) return response.output_parsed;
  if (response.output_text) return JSON.parse(response.output_text);
  throw new Error('Model returned no JSON');
}

/**
 * @param {{ dryRun?: boolean, force?: boolean, concurrency?: number, logPath?: string, bucket?: string }} options
 */
export async function runReextractRentMismatch(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const concurrency = options.concurrency ?? 4;
  const logPath = options.logPath || DEFAULT_LOG_PATH;
  const bucket = options.bucket || process.env.SUPABASE_STORAGE_BUCKET || 'Contracts';
  const mismatchTable = options.mismatchTable || MISMATCH_RENT;
  const customersTable = options.customersTable || CUSTOMERS_FINAL;
  const maxBytes = options.maxBytes ?? 25 * 1024 * 1024;

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set');
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 5 * 60 * 1000, maxRetries: 2 });
  const sb = options.supabase || supabaseServiceClient();

  const { data: mismatches, error: mmErr } = await sb
    .from(mismatchTable)
    .select('nc_number,nc_code,customers_final_id,rent_customers,rent_seguimiento,rent_housemonk');
  if (mmErr) throw mmErr;

  const b2bSkip = loadB2bContractAuthoritativeNcs();
  const extByNc = indexExtByNc(await fetchAllRows(sb, CUSTOMERS_EXT));

  const ids = mismatches.map((r) => r.customers_final_id).filter(Boolean);
  const custRows = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await sb
      .from(customersTable)
      .select('id,storage_path,source_document,Source,"Allocated Rate","Group Code"')
      .in('id', chunk);
    if (error) throw error;
    custRows.push(...data);
  }
  const custById = new Map(custRows.map((r) => [r.id, r]));

  const log = loadLog(logPath);
  const donePaths = force
    ? new Set()
    : new Set(log.results.filter((r) => r.status === 'ok').map((r) => r.storage_path));

  const jobs = [];
  const skipped = [];
  for (const m of mismatches) {
    if (isB2bContractAuthoritativeNc(m.nc_number, b2bSkip)) {
      skipped.push({ nc_code: m.nc_code, reason: 'B2B authoritative NC (contract sync, not f/g OCR)' });
      continue;
    }
    const cFinal = m.customers_final_id ? custById.get(m.customers_final_id) : null;
    const cExt = extByNc.get(Number(m.nc_number));
    const cFile = cFinal?.storage_path ? cFinal : cExt?.storage_path ? cExt : cFinal || cExt;
    if (!cFile) {
      skipped.push({ nc_code: m.nc_code, reason: 'no contract row in Final_Format or 12_10_2026' });
      continue;
    }
    if (!cFile.storage_path) {
      skipped.push({ nc_code: m.nc_code, reason: 'no storage_path on contract row' });
      continue;
    }
    if (donePaths.has(cFile.storage_path)) continue;
    jobs.push({
      m,
      c: cFile,
      finalId: cFinal?.id || null,
      extId: cExt?.id || null,
      rentBefore: clean(cFinal?.['Allocated Rate'] || cExt?.['Allocated Rate']) || null,
    });
  }

  let next = 0;
  let ok = 0;
  let failed = 0;

  async function worker() {
    while (next < jobs.length) {
      const { m, c, finalId, extId, rentBefore } = jobs[next++];
      const fileName = c.source_document || path.basename(c.storage_path);
      const entry = {
        nc_code: m.nc_code,
        customers_final_id: finalId,
        customers_ext_id: extId,
        storage_path: c.storage_path,
        rent_before: rentBefore,
        rent_seguimiento: m.rent_seguimiento,
        rent_housemonk: m.rent_housemonk,
      };
      try {
        const mimeType = mimeFromName(fileName) || mimeFromName(c.storage_path) || 'application/pdf';
        const { data, error } = await sb.storage.from(bucket).download(c.storage_path);
        if (error) throw new Error(`download: ${error.message}`);
        const bytes = Buffer.from(await data.arrayBuffer());
        if (bytes.length > maxBytes) throw new Error(`file too large (${bytes.length} bytes)`);
        const parsed = await extractRentSection(client, fileName, bytes, mimeType);
        const { rent, rule } = finalRentFromParsed(parsed);
        Object.assign(entry, parsed, { rent_after: rent != null ? rent.toFixed(2) : null, rule });
        if (rent != null && !dryRun) {
          const rentStr = rent.toFixed(2);
          const upd = await applyRentPatch(sb, { finalId, extId, rentStr });
          entry.updated = upd.finalUpdated || upd.extUpdated;
          entry.finalUpdated = upd.finalUpdated;
          entry.extUpdated = upd.extUpdated;
        } else {
          entry.updated = false;
        }
        entry.status = 'ok';
        ok += 1;
        console.log(`OK ${m.nc_code}: ${entry.rent_before} -> ${entry.rent_after} (${rule}) HM ${m.rent_housemonk}`);
      } catch (e) {
        entry.status = 'failed';
        entry.error = e instanceof Error ? e.message : String(e);
        failed += 1;
        console.error(`FAIL ${m.nc_code}: ${entry.error}`);
      }
      log.results = log.results.filter((r) => r.storage_path !== entry.storage_path);
      log.results.push(entry);
      saveLog(logPath, log);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  log.skipped = skipped;
  log.lastRun = new Date().toISOString();
  saveLog(logPath, log);

  return {
    ok: true,
    mismatchCount: mismatches.length,
    attempted: jobs.length,
    success: ok,
    failed,
    skipped: skipped.length,
    dryRun,
    logPath,
  };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  runReextractRentMismatch({ dryRun, force })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.failed > 0 ? 1 : 0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
