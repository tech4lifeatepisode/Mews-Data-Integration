import { clean } from './company-match-utils.mjs';
import { isChamariEntity } from './chamari-strip.mjs';

function isFilled(v) {
  const c = clean(v);
  return Boolean(c && c !== '/' && c !== '-');
}

/** B2B: commercial / stay fields from contract re-extract (guest PII comes from Tenancy CSV). */
export const CONTRACT_B2B_COMMERCIAL_FIELDS = [
  'Arrival Date(*)',
  'Departure Date(*)',
  'Allocated Rate',
  'Prepaid Amount',
  'Reservation Notes',
  'Partner Company',
  'Company Id',
  'Tax Identification Number',
  'Allocated Room Category(*)',
  'Included Products',
  'Companions',
];

/** Contract fields from Customers_Contracts_Extraction_12_10_2026 override stale V2/HM values. */
export const CONTRACT_EXTRACTION_FIELDS = [
  ...CONTRACT_B2B_COMMERCIAL_FIELDS,
  'Email',
  'First Name',
  'Last Name(*)',
  'Second Last Name',
  'Document Number',
  'Document Type',
  'Telephone',
  'Address Line 1',
  'Address Line 2',
  'City',
  'Postal Code',
  'Country Code',
  'Nationality Code',
  'Sex',
  'Birth Date',
];

export function applyContractExtractionOverlay(row, customersExtRow, options = {}) {
  if (!customersExtRow) return row;
  const fields = options.fields || CONTRACT_EXTRACTION_FIELDS;
  const out = { ...row };
  for (const key of fields) {
    const val = customersExtRow[key];
    if (!isFilled(val)) continue;
    if (isChamariEntity(val)) continue;
    out[key] = clean(val);
  }
  return out;
}
