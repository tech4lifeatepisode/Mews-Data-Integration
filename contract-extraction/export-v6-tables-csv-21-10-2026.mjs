/**
 * Export live V6 Supabase customers + companies to CSV (Mews V16 input).
 *
 *   node export-v6-tables-csv-21-10-2026.mjs
 *   node export-v6-tables-csv-21-10-2026.mjs v16
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const V6_CUSTOMERS = 'V6_Final_B2C_and_B2B_All_Fields_Match_Mews_Import_21_10_2026';
const V6_COMPANIES = 'V6_Final_Companies_Match_Mews_Import_21_10_2026';

const here = path.dirname(fileURLToPath(import.meta.url));
const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
const transcriptText = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  [...transcriptText.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];
if (!key) throw new Error('Missing Supabase service key');
const sb = createClient(process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co', key);

async function fetchAll(table, orderByNc = true) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select('*');
    if (orderByNc) q = q.order('nc_number', { ascending: true });
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

function writeCsv(rows, filePath) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => c !== 'id' && c !== 'created_at');
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))];
  fs.writeFileSync(filePath, `\ufeff${lines.join('\n')}\n`, 'utf8');
}

const customers = await fetchAll(V6_CUSTOMERS);
const companies = await fetchAll(V6_COMPANIES, false);
companies.sort((a, b) => String(a['Company Name(*)']).localeCompare(String(b['Company Name(*)'])));

const prefix = process.argv[2] || 'v16';
const customersCsv = path.join(here, `${prefix}-customers-export-21-10-2026.csv`);
const companiesCsv = path.join(here, `${prefix}-companies-export-21-10-2026.csv`);
writeCsv(customers, customersCsv);
writeCsv(companies, companiesCsv);

const minArrival = '2026-11-01';
const early = customers.filter((r) => (r['Arrival Date(*)'] || '').slice(0, 10) < minArrival);
const arrivalCounts = {};
for (const r of customers) {
  const d = (r['Arrival Date(*)'] || '').slice(0, 10);
  arrivalCounts[d] = (arrivalCounts[d] || 0) + 1;
}

console.log(
  JSON.stringify(
    {
      customers: customers.length,
      companies: companies.length,
      arrivalsBefore2026_11_01: early.map((r) => r.nc_number),
      topArrivalDates: Object.fromEntries(
        Object.entries(arrivalCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5),
      ),
      customersCsv,
      companiesCsv,
    },
    null,
    2,
  ),
);
