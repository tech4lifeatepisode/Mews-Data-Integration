/**
 * Build room-number → Mews room category map from category list files + HouseMonk overrides.
 * Run: node build-room-number-category-map.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(here, 'data', 'room-categories-19-10-2026');
const OUT_JSON = path.join(here, 'room-number-to-category-19-10-2026.json');

const CATEGORY_FILES = [
  ['The Comfort', 'the-comfort.txt'],
  ['The Rooftop', 'the-rooftop.txt'],
  ['The Standard', 'the-standard.txt'],
  ['The Standard PMR', 'the-standard-pmr.txt'],
  ['The Standard with Terrace PMR', 'the-standard-with-terrace-pmr.txt'],
  ['The Two Bedroom (Double Single)', 'the-two-bedroom-double-single.txt'],
  ['The Two Bedroom Rooftop', 'the-two-bedroom-rooftop.txt'],
  ['The Two Bedrooms (Double Double)', 'the-two-bedrooms-double-double.txt'],
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
if (!key) throw new Error('Missing Supabase service key');

function clean(v) {
  return v == null ? '' : String(v).trim();
}

export function roomLookupKeys(raw) {
  const s = clean(raw);
  if (!s) return [];
  const keys = new Set([s]);
  if (/^-?\d+$/.test(s)) {
    const n = parseInt(s, 10);
    keys.add(String(n));
    if (n >= 0) keys.add(String(n).padStart(4, '0'));
    if (s.startsWith('0') && s.length > 1) keys.add(s.replace(/^0+/, '') || '0');
  }
  return [...keys];
}

function loadAuthoritativeLists() {
  /** @type {Record<string, string>} */
  const map = {};
  for (const [category, file] of CATEGORY_FILES) {
    const p = path.join(DATA_DIR, file);
    if (!fs.existsSync(p)) continue;
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      let num = t;
      if (num.startsWith('--') && /^--\d+$/.test(num)) num = `-${num.slice(2)}`;
      if (!/^-?\d+$/.test(num)) continue;
      for (const k of roomLookupKeys(num)) map[k] = category;
    }
  }
  return map;
}

async function fetchHmRows() {
  const sb = createClient(url, key);
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('Final_Format_HouseMonk_15_10_2026')
      .select('"Allocated Room Number","Allocated Room Category(*)"')
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

const map = loadAuthoritativeLists();
const hmRows = await fetchHmRows();
for (const r of hmRows) {
  const num = clean(r['Allocated Room Number']);
  const cat = clean(r['Allocated Room Category(*)']);
  if (!num || !cat) continue;
  for (const k of roomLookupKeys(num)) {
    if (!map[k]) map[k] = cat;
  }
}

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(map, null, 0));
console.log(JSON.stringify({ keys: Object.keys(map).length, out: OUT_JSON }, null, 2));
