import { clean, normId, normName } from './company-match-utils.mjs';

const CHAMARI_TAX = normId('B42861468');

export function isChamariEntity(value) {
  const c = clean(value);
  if (!c) return false;
  if (normId(c) === CHAMARI_TAX) return true;
  const n = normName(c);
  return n.includes('chamari');
}

const CUSTOMER_FIELDS = [
  'Partner Company',
  'Company Id',
  'Tax Identification Number',
  'Document Number',
  'Last Name(*)',
  'First Name',
  'Second Last Name',
  'Address Line 1',
  'Address Line 2',
  'Email',
  'Reservation Notes',
];

const COMPANY_FIELDS = [
  'Company Name(*)',
  'Tax ID Number',
  'Fiscal Identifier',
  'Additional Tax Identifier',
  'Mother Company Id',
  'Reference ID',
  'Invoicing Email',
  'Contact Person',
  'Notes',
  'Address Line 1',
];

export function stripChamariFromCustomerRow(row) {
  if (!row) return row;
  for (const key of CUSTOMER_FIELDS) {
    if (isChamariEntity(row[key])) row[key] = null;
  }
  if (isChamariEntity(row['Document Number']) && isChamariEntity(row['Tax Identification Number'])) {
    row['Document Number'] = null;
    row['Tax Identification Number'] = null;
  } else if (isChamariEntity(row['Document Number'])) {
    row['Document Number'] = null;
  }
  return row;
}

export function stripChamariFromCompanyRow(row) {
  if (!row) return row;
  for (const key of COMPANY_FIELDS) {
    if (isChamariEntity(row[key])) row[key] = null;
  }
  return row;
}

export function rowReferencesChamari(row) {
  if (!row) return false;
  return [...CUSTOMER_FIELDS, ...COMPANY_FIELDS].some((k) => isChamariEntity(row[k]));
}
