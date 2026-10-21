import { bestCompanyMatch, clean, normName } from './company-match-utils.mjs';
import { stripChamariFromCompanyRow } from './chamari-strip.mjs';
import { isChamariEntity } from './chamari-strip.mjs';
import { mewsB2bCompanyPatchFromTenancy, mewsPatchFromTenancy } from './tenancy-nc-overrides.mjs';

export function companyNameFromSeguimientoLabel(label) {
  const c = clean(label);
  if (!c || c === '/') return null;
  return c;
}

export function pickCompaniesExtractMatch(rows, companiesExtract, preferredName) {
  if (preferredName) {
    const pref = normName(preferredName);
    for (const co of companiesExtract) {
      if (normName(co['Company Name(*)']) === pref) return co;
      if (normName(co['Company Name(*)']).includes(pref) || pref.includes(normName(co['Company Name(*)'])))
        return co;
    }
  }
  const best = bestCompanyMatch(rows.filter(Boolean), companiesExtract);
  if (best && best.tier !== 'none') return best.company;
  return null;
}

export function buildV2CompanyRow(nc, { seg, cust, hm, customerRow, companiesExtract, tenancyRow, existingCompanyRow }) {
  const preferredName = companyNameFromSeguimientoLabel(
    clean(seg?.['Partner Company']) || clean(seg?.['Company Id']) || clean(customerRow?.['Partner Company']),
  );

  const matched = pickCompaniesExtractMatch([customerRow, cust, hm, seg], companiesExtract, preferredName);
  const tenancyPatch = mewsPatchFromTenancy(tenancyRow);

  const row = {
    nc_number: nc,
    'Company Name(*)':
      preferredName ||
      clean(existingCompanyRow?.['Company Name(*)']) ||
      clean(tenancyPatch['Partner Company']) ||
      clean(matched?.['Company Name(*)']) ||
      null,
    Telephone: clean(existingCompanyRow?.Telephone) || clean(matched?.Telephone) || null,
    'Contact Person': clean(existingCompanyRow?.['Contact Person']) || clean(matched?.['Contact Person']) || null,
    'Address Line 1':
      clean(existingCompanyRow?.['Address Line 1']) || clean(matched?.['Address Line 1']) || null,
    'Address Line 2': clean(existingCompanyRow?.['Address Line 2']) || clean(matched?.['Address Line 2']) || null,
    City: clean(existingCompanyRow?.City) || clean(matched?.City) || null,
    'Postal Code': clean(existingCompanyRow?.['Postal Code']) || clean(matched?.['Postal Code']) || null,
    'Country Code': clean(existingCompanyRow?.['Country Code']) || clean(matched?.['Country Code']) || null,
    'Tax ID Number':
      clean(existingCompanyRow?.['Tax ID Number']) ||
      clean(matched?.['Tax ID Number']) ||
      clean(tenancyPatch['Tax Identification Number']) ||
      clean(customerRow?.['Tax Identification Number']) ||
      null,
    'Fiscal Identifier':
      clean(existingCompanyRow?.['Fiscal Identifier']) || clean(matched?.['Fiscal Identifier']) || null,
    'Invoicing Email':
      clean(existingCompanyRow?.['Invoicing Email']) || clean(matched?.['Invoicing Email']) || clean(tenancyPatch.Email) || null,
    Invoiceable: clean(existingCompanyRow?.Invoiceable) || clean(matched?.Invoiceable) || null,
    'Billing Code': clean(existingCompanyRow?.['Billing Code']) || clean(matched?.['Billing Code']) || null,
    'Accounting Code': clean(existingCompanyRow?.['Accounting Code']) || clean(matched?.['Accounting Code']) || null,
  };

  stripChamariFromCompanyRow(row);
  if (!clean(row['Company Name(*)']) || isChamariEntity(row['Company Name(*)'])) return null;
  return row;
}

export function reapplyB2bCompanyOnCustomer(out, nc, { seg, cust, hm, companiesExtract, tenancyRow }) {
  const preferredName = companyNameFromSeguimientoLabel(
    clean(seg?.['Partner Company']) || clean(seg?.['Company Id']) || clean(cust?.['Partner Company']),
  );
  const tenancyPatch = mewsB2bCompanyPatchFromTenancy(tenancyRow);
  const matched = pickCompaniesExtractMatch([out, cust, hm, seg], companiesExtract, preferredName);

  const companyName =
    (preferredName && !isChamariEntity(preferredName) ? preferredName : null) ||
    (clean(tenancyPatch['Partner Company']) && !isChamariEntity(tenancyPatch['Partner Company'])
      ? clean(tenancyPatch['Partner Company'])
      : null) ||
    (clean(matched?.['Company Name(*)']) && !isChamariEntity(matched?.['Company Name(*)'])
      ? clean(matched?.['Company Name(*)'])
      : null);

  if (companyName) {
    out['Partner Company'] = companyName;
    out['Company Id'] = companyName;
  }

  const tax =
    clean(matched?.['Tax ID Number']) ||
    clean(matched?.['Fiscal Identifier']) ||
    clean(tenancyPatch['Tax Identification Number']) ||
    null;
  if (tax && !isChamariEntity(tax)) {
    out['Tax Identification Number'] = tax;
  }

  if (matched) {
    for (const [k, v] of [
      ['Address Line 1', matched['Address Line 1']],
      ['City', matched.City],
      ['Postal Code', matched['Postal Code']],
      ['Country Code', matched['Country Code']],
    ]) {
      if (!clean(out[k]) && clean(v)) out[k] = v;
    }
  }

  return out;
}
