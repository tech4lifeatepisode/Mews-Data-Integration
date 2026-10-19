/**
 * Merge solved mismatch CSVs (Actual Value) into Mews import tables 19_10_2026.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { parseMoney, formatMoney } from './b2b-contract-authoritative.mjs';
import { CUSTOMER_HEADERS } from './mews-customer-headers.mjs';
import { COMPANY_HEADERS } from './mews-company-headers.mjs';

const CUSTOMERS_15 = 'Final_Format_All_Fields_Match_Mews_Import_15_10_2026';
const COMPANIES_15 = 'Final_Format_All_Fields_Match_Mews_Import_Companies_15_10_2026';
const CUSTOMERS_19 = 'Final_Format_All_Fields_Match_Mews_Import_19_10_2026';
const COMPANIES_19 = 'Final_Format_All_Fields_Match_Mews_Import_Companies_19_10_2026';

const CSV_DIR = path.join(process.env.USERPROFILE || '', 'Downloads');
const CSV_FILES = [
  'Final_Mismatchs 16.10.2026 - Final_Format_Mismatch_Rent_15_10_2026_rows.csv',
  'Final_Mismatchs 16.10.2026 - Final_Format_Mismatch_Deposits_15_10_2026_rows.csv',
  'Final_Mismatchs 16.10.2026 - Final_Format_Mismatch_Names_15_10_2026_rows.csv',
  'Final_Mismatchs 16.10.2026 - Final_Format_Mismatch_Unit_Types_15_10_2026_rows .csv',
];

const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
const transcriptText = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
function lastMatch(pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const m = [...transcriptText.matchAll(new RegExp(pattern.source, flags))];
  return m.length ? m.at(-1)[0] : null;
}
const url = process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  lastMatch(/sb_secret_[A-Za-z0-9_\-]+/);
if (!key) throw new Error('Missing Supabase service key (SUPABASE_SERVICE_ROLE_KEY or .env)');
const sb = createClient(url, key);

function clean(v) {
  return v == null ? '' : String(v).trim();
}

function actualFromRow(row) {
  return clean(row['Acutal Value'] || row['Actual Value']);
}

function ncLabel(n) {
  return `NC_${String(n).padStart(4, '0')}`;
}

function parseCsv(text) {
  const rows = [];
  let i = 0;
  const len = text.length;
  const readField = () => {
    let out = '';
    if (text[i] === '"') {
      i++;
      while (i < len) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            out += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          out += text[i++];
        }
      }
      if (text[i] === ',') i++;
      return out;
    }
    while (i < len && text[i] !== '\n' && text[i] !== '\r' && text[i] !== ',') out += text[i++];
    if (text[i] === ',') i++;
    return out;
  };
  const headers = [];
  while (i < len && text[i] !== '\n' && text[i] !== '\r') headers.push(readField());
  if (text[i] === '\r') i++;
  if (text[i] === '\n') i++;
  while (i < len) {
    const row = {};
    for (let h = 0; h < headers.length; h++) {
      if (i >= len) break;
      row[headers[h]] = readField();
    }
    if (Object.values(row).some((v) => clean(v))) rows.push(row);
    while (i < len && (text[i] === '\r' || text[i] === '\n')) i++;
  }
  return rows;
}

function loadCorrections() {
  /** @type {Map<number, { rent?: string, deposit?: string, unit?: string, name?: string, guestDocument?: string }>} */
  const byNc = new Map();
  const note = (nc, patch) => {
    const n = Number(nc);
    if (!Number.isFinite(n)) return;
    const cur = byNc.get(n) || {};
    byNc.set(n, { ...cur, ...patch });
  };

  for (const file of CSV_FILES) {
    const p = path.join(CSV_DIR, file);
    if (!fs.existsSync(p)) throw new Error(`Missing CSV: ${p}`);
    const rows = parseCsv(fs.readFileSync(p, 'utf8'));
    for (const row of rows) {
      const actual = actualFromRow(row);
      if (!actual) continue;
      const nc = Number(row.nc_number);
      if (file.includes('Rent')) note(nc, { rent: actual });
      else if (file.includes('Deposits')) note(nc, { deposit: actual });
      else if (file.includes('Names')) {
        note(nc, {
          name: actual,
          guestDocument: clean(row.guest_document_number) || undefined,
        });
      } else if (file.includes('Unit_Types')) note(nc, { unit: actual });
    }
  }
  return byNc;
}

function applyNameToRow(row, actual, guestDocument) {
  const a = actual;
  if (/^NC_0*\d+$/i.test(a)) {
    const m = a.match(/NC_0*(\d+)/i);
    const code = ncLabel(Number(m[1]));
    row['Group Code'] = code;
    row['Internal Guest Notes'] = code;
    return;
  }
  const tokens = a.split(/\s+/).filter(Boolean);
  if (tokens.length >= 3) {
    row['First Name'] = tokens[0];
    row['Second Last Name'] = tokens[tokens.length - 1];
    row['Last Name(*)'] = tokens.slice(1, -1).join(' ');
  } else if (tokens.length === 2) {
    row['First Name'] = tokens[0];
    row['Last Name(*)'] = tokens[1];
    row['Second Last Name'] = null;
  } else if (tokens.length === 1) {
    row['Last Name(*)'] = tokens[0];
    row['First Name'] = null;
  }
  if (guestDocument) row['Document Number'] = guestDocument;
}

function applyCorrections(row, patch) {
  if (patch.rent != null) {
    const n = parseMoney(patch.rent);
    const val = n != null ? formatMoney(n) : patch.rent.replace(/[^\d.,]/g, '') || patch.rent;
    row['Allocated Rate'] = val;
    row['Per Night Prices'] = val;
  }
  if (patch.deposit != null) {
    const n = parseMoney(patch.deposit);
    if (n != null) row['Prepaid Amount'] = formatMoney(n);
    else {
      const note = `Deposit (corrected): ${patch.deposit.trim()}`;
      row['Reservation Notes'] = [clean(row['Reservation Notes']), note].filter(Boolean).join(' | ');
    }
  }
  if (patch.unit != null) row['Allocated Room Category(*)'] = patch.unit;
  if (patch.name != null) applyNameToRow(row, patch.name, patch.guestDocument);
}

async function fetchAll(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').order('nc_number').range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function fetchSourcesForNc(nc) {
  const tables = [
    'Final_Format_Customers_Contracts_Extraction_15_10_2026',
    'Final_Format_Seguimiento_15_10_2026',
    'Final_Format_HouseMonk_15_10_2026',
    'Customers_Contracts_Extraction_12_10_2026',
  ];
  const code = ncLabel(nc);
  const out = [];
  for (const t of tables) {
    const { data, error } = await sb
      .from(t)
      .select('*')
      .or(`Group Code.eq.${code},Internal Guest Notes.eq.${code}`)
      .limit(5);
    if (!error && data?.length) out.push(...data);
  }
  return out[0] || null;
}

function stubFromSource(src, nc) {
  const code = ncLabel(nc);
  const row = { nc_number: nc };
  for (const h of CUSTOMER_HEADERS) row[h] = src[h] ?? null;
  row['Group Code'] = code;
  row['Internal Guest Notes'] = code;
  if (!row['Currency Code']) row['Currency Code'] = 'EUR';
  return row;
}

const MISSING_COL_RE = /Could not find the '([^']+)' column/;
const MISSING_TABLE_RE = /Could not find the table '([^']+)'/;

function stripMeta(row) {
  const { id, created_at, ...rest } = row;
  return rest;
}

async function replaceTable(table, rows) {
  const { error: delError } = await sb.from(table).delete().gte('nc_number', 0);
  if (delError && !/does not exist|schema cache/i.test(delError.message)) {
    if (MISSING_TABLE_RE.test(delError.message)) return { skipped: true, omitted: [] };
    throw delError;
  }
  const omit = new Set();
  for (;;) {
    let failed = null;
    for (let i = 0; i < rows.length; i += 60) {
      const chunk = rows.slice(i, i + 60).map((r) => {
        const out = stripMeta({ ...r });
        for (const c of omit) delete out[c];
        return out;
      });
      if (!chunk.length) continue;
      const { error } = await sb.from(table).insert(chunk);
      if (error) {
        failed = error;
        break;
      }
    }
    if (!failed) break;
    const m = MISSING_COL_RE.exec(failed.message);
    if (MISSING_TABLE_RE.test(failed.message)) return { skipped: true, omitted: [] };
    if (!m) throw failed;
    if (omit.has(m[1])) throw failed;
    omit.add(m[1]);
    await sb.from(table).delete().gte('nc_number', 0);
  }
  return { skipped: false, omitted: [...omit] };
}

const corrections = loadCorrections();
const [baseCustomers, baseCompanies] = await Promise.all([fetchAll(CUSTOMERS_15), fetchAll(COMPANIES_15)]);

const byNc = new Map(baseCustomers.map((r) => [Number(r.nc_number), { ...r }]));
const correctedNcs = [...corrections.keys()];
let addedFromSources = 0;

for (const nc of correctedNcs) {
  if (!byNc.has(nc)) {
    const src = await fetchSourcesForNc(nc);
    if (src) {
      byNc.set(nc, stubFromSource(src, nc));
      addedFromSources++;
    }
  }
}

let patched = 0;
for (const [nc, patch] of corrections) {
  const row = byNc.get(nc);
  if (!row) continue;
  applyCorrections(row, patch);
  patched++;
}

const customersOut = [...byNc.values()].sort((a, b) => a.nc_number - b.nc_number);
const companiesOut = baseCompanies.map((r) => ({ ...r }));

const custUp = await replaceTable(CUSTOMERS_19, customersOut);
const coUp = await replaceTable(COMPANIES_19, companiesOut);

const summary = {
  correctionsFromCsv: corrections.size,
  patchedInMewsImport: patched,
  addedFromSources,
  missingCorrectionNcs: correctedNcs.filter((nc) => !byNc.has(nc)),
  customersTable: CUSTOMERS_19,
  companiesTable: COMPANIES_19,
  customerRows: customersOut.length,
  companyRows: companiesOut.length,
  customersUpload: custUp,
  companiesUpload: coUp,
  ddlCustomers: path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'contract-analysis',
    'supabase-all-fields-match-mews-import-19-10-2026.sql',
  ),
  ddlCompanies: path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'contract-analysis',
    'supabase-all-fields-match-mews-import-companies-19-10-2026.sql',
  ),
};

const summaryPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mews-import-19-10-2026-summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
