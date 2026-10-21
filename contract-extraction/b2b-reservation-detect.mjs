import { isB2bContractAuthoritativeNc, loadAllB2bNcs } from './b2b-contract-authoritative.mjs';
import { isLikelyCompanyLabel } from './company-match-utils.mjs';
import { clean } from './room-number-to-category.mjs';

const B2B_NCS = loadAllB2bNcs();

/** Same B2B rules as V2 upload (authoritative NC ∪ seguimiento, segment, company-as-guest on Seguimiento). */
export function isB2bReservation(nc, row, seg) {
  if (isB2bContractAuthoritativeNc(nc, B2B_NCS)) return true;
  if (clean(row?.['Business Segment']).toUpperCase() === 'B2B') return true;
  if (clean(seg?.['Business Segment']).toUpperCase() === 'B2B') return true;
  if (clean(row?.Source) === 'Seguimiento Leasing' && isLikelyCompanyLabel(row?.['Last Name(*)'])) return true;
  return false;
}

/** V3 B2C-only: excludes B2B, B2B2C (segment/source), and any row with a corporate partner. */
export function isB2cOnlyForV3(nc, row, seg) {
  if (isB2bReservation(nc, row, seg)) return false;
  const segment = clean(row?.['Business Segment'] || seg?.['Business Segment']).toUpperCase();
  if (segment === 'B2B2C' || segment === 'B2B') return false;
  if (clean(row?.['Partner Company'])) return false;
  const src = clean(row?.Source);
  if (/b2b2c/i.test(src)) return false;
  return true;
}

export { B2B_NCS, loadAllB2bNcs };
