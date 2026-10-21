import { clean } from './room-number-to-category.mjs';
import { mapRowToMewsIncludedProducts } from './mews-product-map.mjs';
import { applyPersonCountFills } from './mews-person-count.mjs';
import { applyV3PersonaExtraProductLabels } from './mews-persona-extra.mjs';
import { applyMewsStayRateAndMonthlyPricing } from './mews-stay-rate-and-products-format.mjs';
import { applyMewsImportReadyFields } from './mews-import-ready.mjs';
import {
  loadTenancyLookup,
  mewsPatchFromTenancy,
  resolveTenancyForCustomer,
} from './tenancy-nc-overrides.mjs';

/** Values copied from failed JSON / template placeholders, not real Mews data. */
export function isExtractionArtifactField(val) {
  const c = clean(val);
  if (!c) return false;
  if (/^\/\w[\w_]*:/.test(c)) return true;
  return /company_tax_id|company_address|birth_date:|document_type:|number_of_people:|nationality_code:/i.test(c);
}

/** Mews B2C customer import: corporate strip, pricing, products, import-only field cleanup. */
export function sanitizeV3B2cCustomerRow(row, customersFinal = null) {
  const out = { ...row };
  out['Company Id'] = null;
  out['Partner Company'] = null;
  out['Tax Identification Number'] = null;
  if (isExtractionArtifactField(out.Sex)) out.Sex = null;
  if (isExtractionArtifactField(out['Nationality Code'])) out['Nationality Code'] = null;
  if (isExtractionArtifactField(out['Birth Date'])) out['Birth Date'] = null;
  if (isExtractionArtifactField(out.Telephone)) out.Telephone = null;
  if (isExtractionArtifactField(out['Country Code'])) out['Country Code'] = null;
  if (isExtractionArtifactField(out['Address Line 2'])) out['Address Line 2'] = null;

  out['Total Price'] = null;

  const mapped = mapRowToMewsIncludedProducts(out, customersFinal);
  out['Included Products'] = applyV3PersonaExtraProductLabels(mapped, out, customersFinal);
  applyMewsStayRateAndMonthlyPricing(out);
  applyMewsImportReadyFields(out);

  out.Source = null;
  out['Channel number'] = null;
  out['Channel manager number'] = null;
  out['Channel manager integration ID'] = null;
  out['Business Segment'] = null;

  if (clean(out['Document Type']) === 'TaxIdentificationNumber') {
    out['Document Type'] = null;
  }

  applyPersonCountFills(out, customersFinal);

  if (!clean(out['Allocated Room Number']) && out.nc_number != null) {
    const tenancy = resolveTenancyForCustomer(Number(out.nc_number), out, loadTenancyLookup());
    const door = mewsPatchFromTenancy(tenancy, out)['Allocated Room Number'];
    if (door) out['Allocated Room Number'] = door;
  }

  return out;
}
