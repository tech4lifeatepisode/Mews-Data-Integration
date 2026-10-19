import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { B2B_SYNC_FIELDS, ncLabel } from './b2b-contract-authoritative.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_JSON = path.join(here, 'b2b2c-signed-housemonk-trust-ncs-16-10-2026.json');

let cached = null;

export function loadB2b2cSignedHousemonkTrustNcs(jsonPath = DEFAULT_JSON) {
  if (cached && jsonPath === DEFAULT_JSON) return cached;
  const nums = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const set = new Set(nums.map((n) => Number(n)).filter(Number.isFinite));
  if (jsonPath === DEFAULT_JSON) cached = set;
  return set;
}

export function isB2b2cSignedHousemonkTrustNc(nc, allowlist = loadB2b2cSignedHousemonkTrustNcs()) {
  return nc != null && allowlist.has(Number(nc));
}

/** Signed B2B2C sheet: if NC is on the list and exists in HouseMonk, HM fills contract + counts as match. */
export function housemonkTrustForNc(nc, h, allowlist = loadB2b2cSignedHousemonkTrustNcs()) {
  return isB2b2cSignedHousemonkTrustNc(nc, allowlist) && Boolean(h);
}

export function customerPatchFromHousemonk(h, nc) {
  if (!h) return null;
  const code = ncLabel(nc);
  const out = {};
  for (const f of B2B_SYNC_FIELDS) out[f] = h[f] ?? null;
  out['Group Code'] = code;
  out['Internal Guest Notes'] = code;
  const notes = (out['Reservation Notes'] || '').replace(
    /\s*\|\s*B2B2C signed — synced from HouseMonk 16-10-2026/g,
    '',
  ).trim();
  out['Reservation Notes'] = notes
    ? `${notes} | B2B2C signed — synced from HouseMonk 16-10-2026`
    : 'B2B2C signed — synced from HouseMonk 16-10-2026';
  out.Source = 'B2B2C signed — synced from HouseMonk 16-10-2026';
  return out;
}
