/** Upload Customers_Contracts_Current_Future_15_10_2026.csv to Supabase. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const TABLE = 'Customers_Contracts_Current_Future_15_10_2026';
const CSV = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'contract-analysis',
  'External Data Sources',
  'Customers_Contracts_Current_Future_15_10_2026.csv',
);

const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
const text = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
const key = [...text.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)[0];
const supabase = createClient('https://jujvtuyksxkoclegjznb.supabase.co', key);

function parseCsv(raw) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') inQuotes = false;
      else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((c) => c.length)) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((c) => c.length)) rows.push(row);
  }
  return rows;
}

const raw = fs.readFileSync(CSV, 'utf8').replace(/^\uFEFF/, '');
const matrix = parseCsv(raw);
const headers = matrix[0];
const dataRows = matrix.slice(1);

const { error: delError } = await supabase.from(TABLE).delete().gte('created_at', '1970-01-01');
if (delError) throw new Error(`clear ${TABLE}: ${delError.message}`);

let inserted = 0;
for (let i = 0; i < dataRows.length; i += 80) {
  const chunk = dataRows.slice(i, i + 80).map((cells) => {
    const record = {};
    for (let c = 0; c < headers.length; c += 1) {
      const v = cells[c] == null ? '' : String(cells[c]).trim();
      record[headers[c]] = v || null;
    }
    return record;
  });
  const { error } = await supabase.from(TABLE).insert(chunk);
  if (error) throw new Error(`insert: ${error.message}`);
  inserted += chunk.length;
}
console.log(`Uploaded ${inserted} rows -> public.${TABLE}`);
