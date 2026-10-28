import { bestCompanyMatch, clean, normName } from './company-match-utils.mjs';
import { stripChamariFromCompanyRow } from './chamari-strip.mjs';
import { isChamariEntity } from './chamari-strip.mjs';
import { mewsB2bCompanyPatchFromTenancy } from './tenancy-nc-overrides.mjs';
import {
  applyResolvedB2bPartnerCompany,
  isSallaRassullPlaceholderAddress,
  pickCompaniesExtractByNc,
  resolveB2bPartnerCompany,
} from './b2b-partner-company-resolve.mjs';

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

export function buildV2CompanyRow(nc, { seg, cust, hm, customerRow, companiesExtract, tenancyRow, existingCompanyRow, customersExt }) {
  const byNc = pickCompaniesExtractByNc(nc, companiesExtract);
  const preferredName = companyNameFromSeguimientoLabel(
    clean(byNc?.['Company Name(*)']) ||
      clean(seg?.['Partner Company']) ||
      clean(seg?.['Company Id']) ||
      clean(customersExt?.['Partner Company']) ||
      clean(customerRow?.['Partner Company']),
  );

  const matched = byNc || pickCompaniesExtractMatch([customerRow, cust, customersExt, hm, seg], companiesExtract, preferredName);
  const tenancyPatch = mewsB2bCompanyPatchFromTenancy(tenancyRow);

  const row = {
    nc_number: nc,
    'Company Name(*)':
      (preferredName && !isChamariEntity(preferredName) ? preferredName : null) ||
      clean(existingCompanyRow?.['Company Name(*)']) ||
      clean(matched?.['Company Name(*)']) ||
      clean(tenancyPatch['Partner Company']) ||
      null,
    Telephone: clean(existingCompanyRow?.Telephone) || clean(matched?.Telephone) || null,
    'Contact Person': clean(existingCompanyRow?.['Contact Person']) || clean(matched?.['Contact Person']) || null,
    'Address Line 1':
      clean(existingCompanyRow?.['Address Line 1']) ||
      (isSallaRassullPlaceholderAddress(matched) ? null : clean(matched?.['Address Line 1'])) ||
      null,
    'Address Line 2': clean(existingCompanyRow?.['Address Line 2']) || clean(matched?.['Address Line 2']) || null,
    City:
      clean(existingCompanyRow?.City) ||
      (isSallaRassullPlaceholderAddress(matched) ? null : clean(matched?.City)) ||
      null,
    'Postal Code':
      clean(existingCompanyRow?.['Postal Code']) ||
      (isSallaRassullPlaceholderAddress(matched) ? null : clean(matched?.['Postal Code'])) ||
      null,
    'Country Code':
      clean(existingCompanyRow?.['Country Code']) ||
      (isSallaRassullPlaceholderAddress(matched) ? null : clean(matched?.['Country Code'])) ||
      null,
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

export function reapplyB2bCompanyOnCustomer(out, nc, { seg, cust, hm, companiesExtract, tenancyRow, customersExt, v2CompanyRow }) {
  const tenancyPatch = mewsB2bCompanyPatchFromTenancy(tenancyRow);
  const resolved = resolveB2bPartnerCompany(nc, {
    customersExt,
    cust,
    seg,
    hm,
    out,
    companiesExtract,
    tenancyPatch,
    v2CompanyRow,
  });
  applyResolvedB2bPartnerCompany(out, resolved);
  return out;
}
