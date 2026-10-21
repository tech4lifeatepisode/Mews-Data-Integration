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

function parseDepartureIso(row) {
  const raw = clean(row?.['Departure Date(*)'] || row?.['Departure Date']);
  if (!raw || raw === '/') return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, d, mo, y] = dmy;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

export function isCurrentOrFutureByDeparture(row, minDeparture = MIN_DEPARTURE_DATE) {
  const dep = parseDepartureIso(row);
  if (!dep) return false;
  return dep >= minDeparture;
}

/**
 * All B2B NCs for V3: lifecycle-active B2B plus Seguimiento/V2/custExt rows with future checkout.
 * Does not require an active lifecycle row for every NC.
 */
export function buildV3B2bNcSet({
  lifecycleRows,
  custByNc,
  custExtByNc = new Map(),
  segByNc = new Map(),
  v2Rows = [],
  missingGroupCodeNcs = new Set(),
  isB2bReservation,
  shouldExcludeNc,
}) {
  const { activeB2bNcs, activeLifecycleByNc } = buildActiveB2bNcSet({
    lifecycleRows,
    custByNc,
    missingGroupCodeNcs,
  });
  const ncSet = new Set(activeB2bNcs);

  for (const [nc, seg] of segByNc) {
    if (missingGroupCodeNcs.has(nc) || shouldExcludeNc?.(nc)) continue;
    const cust = custByNc.get(nc) || custExtByNc.get(nc);
    if (!isB2bReservation(nc, cust || seg, seg)) continue;
    if (!isB2bNcFromCustomerContract(nc, cust) && !/b2b/i.test(clean(seg?.['Business Segment']))) continue;
    if (isCurrentOrFutureByDeparture(seg) || isCurrentOrFutureByDeparture(cust) || isCurrentOrFutureByDeparture(custExtByNc.get(nc))) {
      ncSet.add(nc);
    }
  }

  for (const r of v2Rows) {
    const nc = Number(r.nc_number);
    if (!Number.isFinite(nc) || missingGroupCodeNcs.has(nc) || shouldExcludeNc?.(nc)) continue;
    const seg = segByNc.get(nc);
    if (!isB2bReservation(nc, r, seg)) continue;
    if (isCurrentOrFutureByDeparture(r) || isCurrentOrFutureByDeparture(custByNc.get(nc)) || isCurrentOrFutureByDeparture(custExtByNc.get(nc))) {
      ncSet.add(nc);
    }
  }

  for (const [nc, cust] of custExtByNc) {
    if (missingGroupCodeNcs.has(nc) || shouldExcludeNc?.(nc)) continue;
    if (!isB2bNcFromCustomerContract(nc, custByNc.get(nc) || cust)) continue;
    if (isCurrentOrFutureByDeparture(cust)) ncSet.add(nc);
  }

  return { ncSet, activeLifecycleByNc };
}
