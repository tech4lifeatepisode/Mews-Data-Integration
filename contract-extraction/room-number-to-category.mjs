import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_JSON = path.join(here, 'room-number-to-category-19-10-2026.json');

export function clean(v) {
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

let cachedMap = null;

export function loadRoomNumberCategoryMap(jsonPath = DEFAULT_JSON) {
  if (cachedMap && jsonPath === DEFAULT_JSON) return cachedMap;
  if (!fs.existsSync(jsonPath)) return {};
  const map = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (jsonPath === DEFAULT_JSON) cachedMap = map;
  return map;
}

export function categoryForRoomNumber(roomNumber, map) {
  const s = clean(roomNumber);
  if (!s) return null;
  let num = s;
  if (num.startsWith('--') && /^--\d+$/.test(num)) num = `-${num.slice(2)}`;

  for (const k of roomLookupKeys(num)) {
    if (map[k]) return map[k];
  }
  return null;
}
