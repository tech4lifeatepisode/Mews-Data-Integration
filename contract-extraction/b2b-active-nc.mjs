import { isB2bContractAuthoritativeNc } from './b2b-contract-authoritative.mjs';
import { clean } from './room-number-to-category.mjs';

export const MIN_DEPARTURE_DATE = process.env.MEWS_MIN_DEPARTURE_DATE || '2026-11-05';

function isFilledMewsField(v) {
  const c = clean(v);
  return Boolean(c && c !== '/' && c !== '-');
}

/** B2B contract NC from Final_Format customers (company on contract, not B2C-only). */
export function isB2bNcFromCustomerContract(nc, cust) {
  const n = Number(nc);
  if (!Number.isFinite(n)) return false;
  if (!cust) return isB2bContractAuthoritativeNc(n);
  if (isFilledMewsField(cust['Partner Company'])) return true;
  if (isFilledMewsField(cust['Company Id'])) return true;
  if (/^b2b$/i.test(clean(cust['Business Segment']))) return true;
  return isB2bContractAuthoritativeNc(n);
}

export { isFilledMewsField };

function reservationEndIso(row) {
  return clean(row.check_out_date || row.move_out_date) || null;
}

/** Active / future stay per HouseMonk_Tenancy_Lifecycle (not cancelled, not past checkout). */
export function isActiveTenancyLifecycleRow(row) {
  if (!row) return false;
  if (clean(row.cancellation_reason)) return false;
  const st = clean(row.tenancy_status);
  if (/cancel/i.test(st)) return false;
  const flags = clean(row.lifecycle_flags);
  if (flags.includes('move_out_before_snapshot')) return false;
  if (row.same_guest_has_occupied_stay) return false;
  const end = reservationEndIso(row);
  if (!end || end < MIN_DEPARTURE_DATE) return false;
  return true;
}

function preferLifecycleRow(a, b) {
  if (a.is_occupied && !b.is_occupied) return true;
  if (b.is_occupied && !a.is_occupied) return false;
  const stA = clean(a.tenancy_status);
  const stB = clean(b.tenancy_status);
  if (stA === 'Occupied' && stB !== 'Occupied') return true;
  if (stB === 'Occupied' && stA !== 'Occupied') return false;
  return reservationEndIso(a) >= reservationEndIso(b);
}

/** NC → best active lifecycle row. */
export function indexActiveLifecycleByNc(lifecycleRows) {
  const map = new Map();
  for (const row of lifecycleRows) {
    if (!isActiveTenancyLifecycleRow(row)) continue;
    const nc = Number(row.nc_number);
    if (!Number.isFinite(nc)) continue;
    const prev = map.get(nc);
    if (!prev || preferLifecycleRow(row, prev)) map.set(nc, row);
  }
  return map;
}

export function indexMissingGroupCodeNcs(missingRows) {
  const set = new Set();
  for (const r of missingRows) {
    const nc = Number(r.nc_number);
    if (Number.isFinite(nc)) set.add(nc);
    for (const t of [r['Group Code'], r['Internal Guest Notes']].filter(Boolean)) {
      for (const m of String(t).matchAll(/NC_0*(\d+)/gi)) set.add(Number(m[1]));
    }
  }
  return set;
}

/** B2B contract NCs with active lifecycle, excluding Missing_Group_Code cohort. */
export function buildActiveB2bNcSet({ lifecycleRows, custByNc, missingGroupCodeNcs = new Set() }) {
  const activeByNc = indexActiveLifecycleByNc(lifecycleRows);
  const out = new Set();
  for (const [nc, lifecycle] of activeByNc) {
    if (missingGroupCodeNcs.has(nc)) continue;
    const cust = custByNc.get(nc);
    if (!isB2bNcFromCustomerContract(nc, cust)) continue;
    out.add(nc);
  }
  return { activeB2bNcs: out, activeLifecycleByNc: activeByNc };
}
