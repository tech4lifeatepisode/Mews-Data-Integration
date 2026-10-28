/**
 * Build one Mews Companies sheet row per distinct billing entity referenced on customer/reservation rows.
 * Column set matches Mews_import_v2.10.0.xlsx Companies sheet.
 */
import { clean, normId, normName } from './company-match-utils.mjs';
import { isChamariEntity, stripChamariFromCompanyRow } from './chamari-strip.mjs';

export const MEWS_COMPANY_HEADERS = [
  'Company Name(*)',
  'Telephone',
  'Contact Person',
  'Contact Notes',
  'Website',
  'Notes',
  'Department',
  'Address Line 1',
  'Address Line 2',
  'City',
  'Postal Code',
  'Country Code',
  'Mother Company Id',
  'Reference ID',
  'Fiscal Identifier',
  'Tax ID Number',
  'Additional Tax Identifier',
  'Accounting Code',
  'Billing Code',
  'External Identifier',
  'Invoice Due Interval',
  'Invoicing Email',
  'Invoiceable',
  'Add Fees To Invoices',
  'Add Tax Deducted Payment To Invoices',
  'IATA',
  'DUNS Number',
  'Cod. destinatario',
  'Fiscal code',
  'Tender Code (CIG)',
  'Project Code (CUP)',
];

function isFilled(v) {
  const c = clean(v);
  return Boolean(c && c !== '/' && c !== '-');
}

export function companyDedupeKey(name, tax) {
  const tid = normId(tax);
  if (tid && tid.length >= 3) return `tax:${tid}`;
  const n = normName(name);
  if (n) return `name:${n}`;
  return null;
}

function pickLonger(a, b) {
  const ca = clean(a);
  const cb = clean(b);
  if (!ca) return cb || null;
  if (!cb) return ca;
  return ca.length >= cb.length ? ca : cb;
}

function mergeCompanyFields(target, source) {
  if (!source) return target;
  for (const h of MEWS_COMPANY_HEADERS) {
    if (!isFilled(source[h])) continue;
    if (!isFilled(target[h])) target[h] = clean(source[h]);
    else if (h === 'Company Name(*)') target[h] = pickLonger(target[h], source[h]);
  }
  return target;
}

function customerBillingHints(customer) {
  return {
    'Company Name(*)': clean(customer['Partner Company'] || customer['Company Id']),
    'Tax ID Number': clean(customer['Tax Identification Number']),
    'Fiscal Identifier': clean(customer['Tax Identification Number']),
    'Accounting Code': clean(customer['Accounting Code']),
    'Billing Code': clean(customer['Billing Code']),
    'Invoiceable': clean(customer.Invoiceable),
  };
}

function v2RowToMewsCompany(row) {
  if (!row) return null;
  return {
    'Company Name(*)': clean(row['Company Name(*)']),
    Telephone: clean(row.Telephone),
    'Contact Person': clean(row['Contact Person']),
    'Contact Notes': clean(row['Contact Notes']),
    Website: clean(row.Website),
    Notes: clean(row.Notes),
    Department: clean(row.Department),
    'Address Line 1': clean(row['Address Line 1']),
    'Address Line 2': clean(row['Address Line 2']),
    City: clean(row.City),
    'Postal Code': clean(row['Postal Code']),
    'Country Code': clean(row['Country Code']),
    'Mother Company Id': clean(row['Mother Company Id']),
    'Reference ID': clean(row['Reference ID']),
    'Fiscal Identifier': clean(row['Fiscal Identifier']) || clean(row['Tax ID Number']),
    'Tax ID Number': clean(row['Tax ID Number']) || clean(row['Fiscal Identifier']),
    'Additional Tax Identifier': clean(row['Additional Tax Identifier']),
    'Accounting Code': clean(row['Accounting Code']),
    'Billing Code': clean(row['Billing Code']),
    'External Identifier': clean(row['External Identifier']),
    'Invoice Due Interval': clean(row['Invoice Due Interval']),
    'Invoicing Email': clean(row['Invoicing Email']),
    Invoiceable: clean(row.Invoiceable),
    'Add Fees To Invoices': clean(row['Add Fees To Invoices']),
    'Add Tax Deducted Payment To Invoices': clean(row['Add Tax Deducted Payment To Invoices']),
    IATA: clean(row.IATA),
    'DUNS Number': clean(row['DUNS Number']),
    'Cod. destinatario': clean(row['Cod. destinatario']),
    'Fiscal code': clean(row['Fiscal code']),
    'Tender Code (CIG)': clean(row['Tender Code (CIG)']),
    'Project Code (CUP)': clean(row['Project Code (CUP)']),
  };
}

function findV2CompanyForCustomer(customer, v2ByNc, v2ByKey) {
  const name = clean(customer['Partner Company'] || customer['Company Id']);
  const tax = clean(customer['Tax Identification Number']);
  const nc = Number(customer.nc_number);
  const byNc = Number.isFinite(nc) ? v2ByNc.get(nc) : null;
  if (
    byNc &&
    (normName(byNc['Company Name(*)']) === normName(name) ||
      (isFilled(tax) && normId(byNc['Tax ID Number'] || byNc['Fiscal Identifier']) === normId(tax)))
  ) {
    return byNc;
  }
  const key = companyDedupeKey(name, tax);
  if (key && v2ByKey.get(key)) return v2ByKey.get(key);
  const nameKey = companyDedupeKey(name, null);
  if (nameKey && v2ByKey.get(nameKey)) return v2ByKey.get(nameKey);
  return null;
}

function indexV2Companies(v2CompanyRows) {
  const byNc = new Map();
  const byKey = new Map();
  for (const row of v2CompanyRows || []) {
    const nc = Number(row.nc_number);
    if (Number.isFinite(nc)) byNc.set(nc, row);
    const mews = v2RowToMewsCompany(row);
    for (const key of [
      companyDedupeKey(mews['Company Name(*)'], mews['Tax ID Number']),
      companyDedupeKey(mews['Company Name(*)'], null),
    ]) {
      if (key && !byKey.has(key)) byKey.set(key, row);
    }
  }
  return { byNc, byKey };
}

function buildNameToTaxIndex(customerRows, companyRows) {
  const nameToTax = new Map();
  const add = (name, tax) => {
    const n = normName(name);
    const t = clean(tax);
    if (!n || !isFilled(t) || isChamariEntity(t) || nameToTax.has(n)) return;
    nameToTax.set(n, t);
  };
  for (const r of companyRows || []) add(r['Company Name(*)'], r['Tax ID Number'] || r['Fiscal Identifier']);
  for (const r of customerRows || []) add(r['Partner Company'] || r['Company Id'], r['Tax Identification Number']);
  return nameToTax;
}

function customerCompanyKey(customer, nameToTax) {
  const name = clean(customer['Partner Company'] || customer['Company Id']);
  if (!name || isChamariEntity(name)) return null;
  let tax = clean(customer['Tax Identification Number']);
  if (!isFilled(tax) || isChamariEntity(tax)) tax = nameToTax.get(normName(name)) || '';
  return companyDedupeKey(name, tax);
}

/**
 * @param {object[]} customerRows — V4 combined reservations (B2B + B2C)
 * @param {object[]} [v2CompanyRows] — V2 per-NC / V4 / HouseMonk company rows for enrichment
 */
export function buildV4DedupedCompanies(customerRows, v2CompanyRows = []) {
  const { byNc, byKey } = indexV2Companies(v2CompanyRows);
  const nameToTax = buildNameToTaxIndex(customerRows, v2CompanyRows);
  const groups = new Map();

  for (const customer of customerRows || []) {
    const hints = customerBillingHints(customer);
    const name = hints['Company Name(*)'];
    if (!name || isChamariEntity(name)) continue;
    if (isChamariEntity(hints['Tax ID Number'])) hints['Tax ID Number'] = null;
    if (!isFilled(hints['Tax ID Number'])) {
      hints['Tax ID Number'] = nameToTax.get(normName(name)) || null;
      hints['Fiscal Identifier'] = hints['Tax ID Number'];
    }

    const key = companyDedupeKey(name, hints['Tax ID Number']);
    if (!key) continue;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        reservationNcNumbers: [],
        merged: Object.fromEntries(MEWS_COMPANY_HEADERS.map((h) => [h, null])),
      });
    }
    const g = groups.get(key);
    g.reservationNcNumbers.push(Number(customer.nc_number));
    mergeCompanyFields(g.merged, hints);

    const v2 = findV2CompanyForCustomer(customer, byNc, byKey);
    mergeCompanyFields(g.merged, v2RowToMewsCompany(v2));
  }

  const companiesOut = [];
  for (const g of groups.values()) {
    const row = { ...g.merged };
    if (!isFilled(row['Company Name(*)'])) continue;
    stripChamariFromCompanyRow(row);
    if (isChamariEntity(row['Company Name(*)'])) continue;

    if (!isFilled(row['Reference ID'])) {
      row['Reference ID'] = g.key.startsWith('tax:') ? g.key.slice(4) : g.key.slice(5, 48);
    }
    if (!isFilled(row['Tax ID Number']) && isFilled(row['Fiscal Identifier'])) {
      row['Tax ID Number'] = row['Fiscal Identifier'];
    }
    if (!isFilled(row['Fiscal Identifier']) && isFilled(row['Tax ID Number'])) {
      row['Fiscal Identifier'] = row['Tax ID Number'];
    }

    companiesOut.push({
      ...row,
      _dedupe_key: g.key,
      _reservation_nc_count: new Set(g.reservationNcNumbers.filter(Number.isFinite)).size,
    });
  }

  companiesOut.sort((a, b) => clean(a['Company Name(*)']).localeCompare(clean(b['Company Name(*)'])));
  return companiesOut.map(({ _dedupe_key, _reservation_nc_count, ...rest }) => rest);
}

/** Point each reservation's Partner Company / Company Id at the exact Companies-sheet name. */
export function canonicalizeCustomerCompanyNames(customerRows, companyRows) {
  const nameToTax = buildNameToTaxIndex(customerRows, companyRows);
  const keyToCompany = new Map();
  for (const co of companyRows || []) {
    const key = companyDedupeKey(co['Company Name(*)'], co['Tax ID Number'] || co['Fiscal Identifier']);
    if (key && !keyToCompany.has(key)) keyToCompany.set(key, co);
    const nameKey = companyDedupeKey(co['Company Name(*)'], null);
    if (nameKey && !keyToCompany.has(nameKey)) keyToCompany.set(nameKey, co);
  }
  let changed = 0;
  for (const customer of customerRows || []) {
    const key = customerCompanyKey(customer, nameToTax);
    if (!key) continue;
    const co = keyToCompany.get(key);
    if (!co) continue;
    const name = clean(co['Company Name(*)']);
    const tax = clean(co['Tax ID Number']);
    if (customer['Partner Company'] !== name || customer['Company Id'] !== name) changed++;
    customer['Partner Company'] = name;
    customer['Company Id'] = name;
    if (isFilled(tax)) customer['Tax Identification Number'] = tax;
  }
  return changed;
}

export function countCompanyLinks(customerRows) {
  let withCompany = 0;
  for (const r of customerRows || []) {
    const name = clean(r['Partner Company'] || r['Company Id']);
    if (name && !isChamariEntity(name)) withCompany++;
  }
  return withCompany;
}
