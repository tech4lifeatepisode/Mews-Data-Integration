import { clean } from './room-number-to-category.mjs';
import { mapRowToMewsIncludedProducts } from './mews-product-map.mjs';
import { applyPersonCountFills } from './mews-person-count.mjs';
import { applyMewsStayRateAndMonthlyPricing } from './mews-stay-rate-and-products-format.mjs';
import { applyMewsImportReadyFields } from './mews-import-ready.mjs';
import { reapplyB2bCompanyOnCustomer } from './v2-b2b-company-build.mjs';
import { isExtractionArtifactField } from './v3-b2c-row-sanitize.mjs';
import {
  loadTenancyLookup,
  mewsPatchFromTenancy,
  resolveTenancyForCustomer,
} from './tenancy-nc-overrides.mjs';

function isFilledMewsField(v) {
  const c = clean(v);
  return Boolean(c && c !== '/' && c !== '-');
}

function setIfEmpty(row, key, val) {
  if (isFilledMewsField(row[key])) return;
  if (isFilledMewsField(val)) row[key] = clean(val);
}

function nullBlankMewsFields(row, keys) {
  for (const key of keys) {
    if (!isFilledMewsField(row[key])) row[key] = null;
  }
}

/** Apply HouseMonk / lifecycle guest fields when V2 row is thin or company-as-guest. */
export function applyOperationalGuestFields(row, { hm, lifecycle }) {
  const snap = lifecycle?.housemonk_snapshot;
  const src = hm || snap;
  if (src) {
    setIfEmpty(row, 'First Name', src['First Name']);
    setIfEmpty(row, 'Last Name(*)', src['Last Name(*)']);
    setIfEmpty(row, 'Second Last Name', src['Second Last Name']);
    setIfEmpty(row, 'Email', src.Email);
    setIfEmpty(row, 'Telephone', src.Telephone);
    setIfEmpty(row, 'Document Number', src['Document Number']);
    setIfEmpty(row, 'Document Type', src['Document Type']);
    setIfEmpty(row, 'Address Line 1', src['Address Line 1']);
    setIfEmpty(row, 'Address Line 2', src['Address Line 2']);
    setIfEmpty(row, 'City', src.City);
    setIfEmpty(row, 'Postal Code', src['Postal Code']);
    setIfEmpty(row, 'Country Code', src['Country Code']);
    setIfEmpty(row, 'Nationality Code', src['Nationality Code']);
    setIfEmpty(row, 'Allocated Room Number', src['Allocated Room Number']);
  }
  if (lifecycle) {
    setIfEmpty(row, 'First Name', lifecycle.guest_first_name);
    setIfEmpty(row, 'Last Name(*)', lifecycle.guest_last_name);
    setIfEmpty(row, 'Second Last Name', lifecycle.guest_second_last_name);
    setIfEmpty(row, 'Email', lifecycle.guest_email);
    setIfEmpty(row, 'Telephone', lifecycle.guest_telephone);
    setIfEmpty(row, 'Document Number', lifecycle.guest_document_number);
    setIfEmpty(row, 'Document Type', lifecycle.guest_document_type);
    setIfEmpty(row, 'Address Line 1', lifecycle.guest_address_line_1);
    setIfEmpty(row, 'Address Line 2', lifecycle.guest_address_line_2);
    setIfEmpty(row, 'City', lifecycle.guest_city);
    setIfEmpty(row, 'Postal Code', lifecycle.guest_postal_code);
    setIfEmpty(row, 'Country Code', lifecycle.guest_country_code);
    setIfEmpty(row, 'Nationality Code', lifecycle.guest_nationality_code);
    setIfEmpty(row, 'Allocated Room Number', lifecycle.allocated_room_number);
    setIfEmpty(row, 'Arrival Date(*)', lifecycle.check_in_date);
    setIfEmpty(row, 'Departure Date(*)', lifecycle.check_out_date);
  }
}

/** B2B Mews import row: keep Partner Company / tax; same pricing & import-ready rules as V3 B2C. */
export function sanitizeV3B2bCustomerRow(row, ctx) {
  const {
    customersFinal = null,
    customersExt = null,
    hm = null,
    seg = null,
    lifecycle = null,
    companiesExtract = [],
  } = ctx || {};

  const out = { ...row };
  const cust = customersFinal || customersExt;

  if (isExtractionArtifactField(out.Sex)) out.Sex = null;
  if (isExtractionArtifactField(out['Nationality Code'])) out['Nationality Code'] = null;
  if (isExtractionArtifactField(out['Birth Date'])) out['Birth Date'] = null;
  if (isExtractionArtifactField(out.Telephone)) out.Telephone = null;
  if (isExtractionArtifactField(out['Country Code'])) out['Country Code'] = null;

  out['Total Price'] = null;
  out['Business Segment'] = out['Business Segment'] || 'B2B';

  applyOperationalGuestFields(out, { hm, lifecycle });

  const nc = Number(out.nc_number);
  const tenancyRow = resolveTenancyForCustomer(nc, out, loadTenancyLookup());
  Object.assign(out, mewsPatchFromTenancy(tenancyRow));

  reapplyB2bCompanyOnCustomer(out, nc, {
    seg,
    cust: cust || customersFinal,
    hm,
    companiesExtract,
    tenancyRow,
  });

  setIfEmpty(out, 'Partner Company', cust?.['Partner Company']);
  setIfEmpty(out, 'Company Id', cust?.['Company Id'] || cust?.['Partner Company']);
  setIfEmpty(out, 'Tax Identification Number', cust?.['Tax Identification Number']);

  const mapped = mapRowToMewsIncludedProducts(out, cust || customersFinal);
  if (mapped) out['Included Products'] = mapped;

  applyMewsStayRateAndMonthlyPricing(out);
  applyMewsImportReadyFields(out);
  applyPersonCountFills(out, cust || customersFinal, hm);

  nullBlankMewsFields(out, ['Partner Company', 'Company Id', 'Tax Identification Number']);

  out.Source = 'B2B contract + HouseMonk';
  return out;
}
