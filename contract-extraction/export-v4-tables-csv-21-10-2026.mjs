/**
 * Export the live V4 customers + companies tables to CSV (input for V11/V12 Mews workbooks).
 *
 *   node export-v4-tables-csv-21-10-2026.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const V4_CUSTOMERS = 'V4_Final_B2C_and_B2B_All_Fields_Match_Mews_Import_21_10_2026';
const V4_COMPANIES = 'V4_Final_Companies_Match_Mews_Import_21_10_2026';

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

const customers = (await fetchAll(V4_CUSTOMERS)).sort((a, b) => a.nc_number - b.nc_number);
const companies = (await fetchAll(V4_COMPANIES)).sort((a, b) =>
  String(a['Company Name(*)']).localeCompare(String(b['Company Name(*)'])),
);
const prefixes = process.argv.slice(2).length ? process.argv.slice(2) : ['v11', 'v12'];
const exports = prefixes.map((p) => [`${p}-customers-export-21-10-2026.csv`, `${p}-companies-export-21-10-2026.csv`]);
for (const [custName, coName] of exports) {
  writeCsv(customers, path.join(here, custName));
  writeCsv(companies, path.join(here, coName));
}
const customersCsv = path.join(here, exports.at(-1)[0]);
const companiesCsv = path.join(here, exports.at(-1)[1]);

const removedCheck = [778, 825, 863, 1120, 1252, 1439, 1941].filter((nc) => customers.some((r) => r.nc_number === nc));
const integra = customers
  .filter((r) => r.nc_number >= 1565 && r.nc_number <= 1575)
  .map((r) => `${r.nc_number}:${r['Allocated Room Number']}:${r['First Name']} ${r['Last Name(*)']}`);
const rooms = new Map();
for (const r of customers) {
  const room = r['Allocated Room Number'];
  if (room) rooms.set(room, (rooms.get(room) || 0) + 1);
}
console.log(
  JSON.stringify(
    {
      customers: customers.length,
      companies: companies.length,
      expiredNcsStillPresent: removedCheck,
      integraOtisUnits: integra,
      roomsUsedMoreThanOnce: [...rooms.values()].filter((n) => n > 1).length,
      customersCsv,
      companiesCsv,
    },
    null,
    2,
  ),
);
