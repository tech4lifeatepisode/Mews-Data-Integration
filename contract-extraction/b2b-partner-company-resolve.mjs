import { bestCompanyMatch, clean } from './company-match-utils.mjs';
import { isChamariEntity } from './chamari-strip.mjs';

export function isSallaRassullPlaceholderAddress(row) {
  if (!row) return false;
  return (
    /whallyrange/i.test(clean(row['Address Line 1'])) &&
    /manchester/i.test(clean(row.City)) &&
    /m168fa/i.test(clean(row['Postal Code']))
  );
}

export function clearSallaRassullPlaceholderGuestFields(row) {
  if (!isSallaRassullPlaceholderAddress(row)) return row;
  return {
    ...row,
    'Address Line 1': null,
    'Address Line 2': null,
    City: null,
    'Postal Code': null,
    'Country Code': null,
  };
}

function ncFromCompanyExtractRow(co) {
  const direct = Number(co?.nc_number);
  if (Number.isFinite(direct)) return direct;
  const blob = `${co?.storage_path || ''} ${co?.source_document || ''} ${co?.['Reference ID'] || ''}`;
  const m = blob.match(/NC[_\s-]?0*(\d{3,5})/i);
  return m ? Number(m[1]) : null;
}

export function pickCompaniesExtractByNc(nc, companiesExtract) {
  const n = Number(nc);
  if (!Number.isFinite(n) || !Array.isArray(companiesExtract)) return null;
  const direct = companiesExtract.find((co) => Number(co.nc_number) === n);
  if (direct) return direct;
  return companiesExtract.find((co) => ncFromCompanyExtractRow(co) === n) || null;
}

function nonChamariName(value) {
  const c = clean(value);
  if (!c || c === '/' || c === '-') return null;
  return isChamariEntity(c) ? null : c;
}

function nonChamariTax(value) {
  const c = clean(value);
  if (!c || c === '/' || c === '-') return null;
  return isChamariEntity(c) ? null : c;
}

/** Resolve B2B client company (never landlord CHAMARI). */
export function resolveB2bPartnerCompany(nc, ctx = {}) {
  const { customersExt, cust, seg, hm, out, companiesExtract, tenancyPatch = {}, v2CompanyRow } = ctx;
  const byNc = pickCompaniesExtractByNc(nc, companiesExtract);

  let matched = byNc;
  if (!matched && companiesExtract?.length) {
    const best = bestCompanyMatch([out, customersExt, cust, hm, seg, v2CompanyRow].filter(Boolean), companiesExtract);
    if (best && best.tier !== 'none') matched = best.company;
  }

  const nameCandidates = [
    nonChamariName(v2CompanyRow?.['Company Name(*)']),
    nonChamariName(byNc?.['Company Name(*)']),
    nonChamariName(matched?.['Company Name(*)']),
    nonChamariName(customersExt?.['Partner Company']),
    nonChamariName(customersExt?.['Company Id']),
    nonChamariName(seg?.['Partner Company']),
    nonChamariName(seg?.['Company Id']),
    nonChamariName(cust?.['Partner Company']),
    nonChamariName(cust?.['Company Id']),
    nonChamariName(hm?.['Partner Company']),
    nonChamariName(tenancyPatch['Partner Company']),
  ].filter(Boolean);

  const taxCandidates = [
    nonChamariTax(v2CompanyRow?.['Tax ID Number']),
    nonChamariTax(v2CompanyRow?.['Fiscal Identifier']),
    nonChamariTax(byNc?.['Tax ID Number']),
    nonChamariTax(byNc?.['Fiscal Identifier']),
    nonChamariTax(matched?.['Tax ID Number']),
    nonChamariTax(matched?.['Fiscal Identifier']),
    nonChamariTax(customersExt?.['Tax Identification Number']),
    nonChamariTax(cust?.['Tax Identification Number']),
    nonChamariTax(seg?.['Tax Identification Number']),
    nonChamariTax(hm?.['Tax Identification Number']),
    nonChamariTax(tenancyPatch['Tax Identification Number']),
  ].filter(Boolean);

  const companyName = nameCandidates[0] || null;
  const taxId = taxCandidates[0] || null;
  if (!companyName && !taxId) return null;
  return { companyName, taxId, companiesExtractRow: byNc || matched };
}

export function applyResolvedB2bPartnerCompany(out, resolved) {
  if (!out) return out;
  if (!resolved?.companyName) {
    if (isChamariEntity(out['Partner Company'])) out['Partner Company'] = null;
    if (isChamariEntity(out['Company Id'])) out['Company Id'] = null;
    if (isChamariEntity(out['Tax Identification Number'])) out['Tax Identification Number'] = null;
    return out;
  }
  out['Partner Company'] = resolved.companyName;
  out['Company Id'] = resolved.companyName;
  if (resolved.taxId) out['Tax Identification Number'] = resolved.taxId;
  return out;
}
