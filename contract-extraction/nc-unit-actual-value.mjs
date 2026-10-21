import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { canonicalizeRoomCategory } from './mews-room-format.mjs';
import { clean } from './room-number-to-category.mjs';

const MISMATCH_UNITS = 'Final_Format_Mismatch_Unit_Types_15_10_2026';

const here = path.dirname(fileURLToPath(import.meta.url));
const CSV_CANDIDATES = [
  path.join(process.env.USERPROFILE || '', 'Downloads', 'Final_Mismatchs 16.10.2026 - Final_Format_Mismatch_Unit_Types_15_10_2026_rows .csv'),
  path.join(here, '..', 'contract-analysis', 'Final_Format_Mismatch_Unit_Types_15_10_2026_rows.csv'),
];

let cachedByNc = null;

function actualFromRow(row) {
  return clean(row['Actual Value'] || row['Acutal Value']);
}

function ncFromRow(row) {
  const n = Number(row.nc_number);
  if (Number.isFinite(n)) return n;
  const m = clean(row.nc_code || row['Group Code']).match(/NC_0*(\d+)/i);
  return m ? Number(m[1]) : null;
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
        } else out += text[i++];
      }
      if (text[i] === ',') i++;
      return out;
    }
    while (i < len && text[i] !== '\n' && text[i] !== '\r' && text[i] !== ',') out += text[i++];
    if (text[i] === ',') i++;
    return out;
  };
  if (i < len && text.charCodeAt(0) === 0xfeff) i++;
  const headers = [];
  while (i < len && text[i] !== '\n' && text[i] !== '\r') headers.push(readField());
  if (text[i] === '\r') i++;
  if (text[i] === '\n') i++;
  while (i < len) {
    const row = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = readField();
    if (Object.values(row).some((v) => clean(v))) rows.push(row);
    while (i < len && (text[i] === '\r' || text[i] === '\n')) i++;
  }
  return rows;
}

function loadFromCsv() {
  for (const p of CSV_CANDIDATES) {
    if (!fs.existsSync(p)) continue;
    const map = new Map();
    for (const row of parseCsv(fs.readFileSync(p, 'utf8'))) {
      const nc = ncFromRow(row);
      const actual = actualFromRow(row);
      if (nc == null || !actual) continue;
      map.set(nc, canonicalizeRoomCategory(actual) || actual);
    }
    if (map.size) return map;
  }
  return null;
}

async function loadFromSupabase() {
  const transcript =
    'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
  const transcriptText = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    [...transcriptText.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];
  if (!key) return new Map();
  const sb = createClient(process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co', key);
  const map = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(MISMATCH_UNITS).select('*').range(from, from + 999);
    if (error) return map;
    if (!data?.length) break;
    for (const row of data) {
      const nc = ncFromRow(row);
      const actual = actualFromRow(row);
      if (nc == null || !actual) continue;
      map.set(nc, canonicalizeRoomCategory(actual) || actual);
    }
    if (data.length < 1000) break;
  }
  return map;
}

/** NC → canonical Mews room category from solved unit-type mismatches (Actual Value). */
export async function loadUnitActualValueByNc() {
  if (cachedByNc) return cachedByNc;
  cachedByNc = loadFromCsv() || (await loadFromSupabase());
  return cachedByNc;
}

export function applyUnitActualValueCategory(row, byNc) {
  const nc = Number(row?.nc_number);
  if (!Number.isFinite(nc) || !byNc?.size) return row;
  const cat = byNc.get(nc);
  if (cat) row['Allocated Room Category(*)'] = cat;
  return row;
}
