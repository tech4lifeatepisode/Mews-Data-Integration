import { clean } from './company-match-utils.mjs';

function isFilled(v) {
  const c = clean(v);
  return Boolean(c && c !== '/' && c !== '-');
}

/** Contract fields from Customers_Contracts_Extraction_12_10_2026 override stale V2/HM values. */
export const CONTRACT_EXTRACTION_FIELDS = [
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
  'Companions',
  'Sex',
  'Birth Date',
];

export function applyContractExtractionOverlay(row, customersExtRow) {
  if (!customersExtRow) return row;
  const out = { ...row };
  for (const key of CONTRACT_EXTRACTION_FIELDS) {
    if (isFilled(customersExtRow[key])) out[key] = clean(customersExtRow[key]);
  }
  return out;
}
