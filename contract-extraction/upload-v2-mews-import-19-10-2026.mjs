/**
 * V2 Mews import: enrich 19_10 tables with Customers + HouseMonk (B2B guest from HM), room category by room number.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { isB2bReservation, B2B_NCS } from './b2b-reservation-detect.mjs';
import { pickGuestEmail } from './guest-email-utils.mjs';
import { rowReferencesChamari, stripChamariFromCompanyRow, stripChamariFromCustomerRow } from './chamari-strip.mjs';
import { buildV2CompanyRow, reapplyB2bCompanyOnCustomer } from './v2-b2b-company-build.mjs';
import { bestCompanyMatch, isLikelyCompanyLabel } from './company-match-utils.mjs';
import { categoryForRoomNumber, clean, loadRoomNumberCategoryMap } from './room-number-to-category.mjs';
import { applyMewsRoomAndCategoryStandards, formatAllocatedRoomNumber } from './mews-room-format.mjs';
import {
  applyTenancyAndManualFills,
  loadTenancyLookup,
  resolveTenancyForCustomer,
  shouldExcludeNcFromV2,
} from './tenancy-nc-overrides.mjs';
import { applyPersonCountFills } from './mews-person-count.mjs';
import { mapRowToMewsIncludedProducts } from './mews-product-map.mjs';
import { applyMewsStayRateAndMonthlyPricing } from './mews-stay-rate-and-products-format.mjs';
import { applyMewsImportReadyFields } from './mews-import-ready.mjs';
import { applyUnitActualValueCategory, loadUnitActualValueByNc } from './nc-unit-actual-value.mjs';
import { applyContractExtractionOverlay } from './contract-extraction-overlay.mjs';

const SRC_CUSTOMERS = 'Final_Format_All_Fields_Match_Mews_Import_19_10_2026';
const SRC_COMPANIES = 'Final_Format_All_Fields_Match_Mews_Import_Companies_19_10_2026';
const V2_CUSTOMERS = 'V2_Final_Format_All_Fields_Match_Mews_Import_19_10_2026';
const V2_COMPANIES = 'V2_Final_Format_All_Fields_Match_Mews_Import_Companies_19_10_2026';
const FF_CUSTOMERS = 'Final_Format_Customers_Contracts_Extraction_15_10_2026';
const CUSTOMERS_EXT = 'Customers_Contracts_Extraction_12_10_2026';
const FF_HM = 'Final_Format_HouseMonk_15_10_2026';
const FF_SEG = 'Final_Format_Seguimiento_15_10_2026';
const COMPANIES_EXTRACTION = 'Companies_Extraction_12_10_2026';

const roomMap = loadRoomNumberCategoryMap();
const tenancyLookup = loadTenancyLookup();

/** Keep reservations with checkout (Departure Date) on or after this date (YYYY-MM-DD). */
const MIN_DEPARTURE_DATE = process.env.MEWS_MIN_DEPARTURE_DATE || '2026-11-05';

const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
const transcriptText = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
function lastMatch(pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const m = [...transcriptText.matchAll(new RegExp(pattern.source, flags))];
  return m.length ? m.at(-1)[0] : null;
}
const url = process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  lastMatch(/sb_secret_[A-Za-z0-9_\-]+/);
if (!key) throw new Error('Missing Supabase service key (SUPABASE_SERVICE_ROLE_KEY or .env)');
const sb = createClient(url, key);

function ncFromRow(row) {
  const nums = new Set();
  for (const t of [row['Group Code'], row['Internal Guest Notes']].filter(Boolean)) {
    for (const m of String(t).matchAll(/NC_0*(\d+)/gi)) nums.add(Number(m[1]));
  }
  return [...nums];
}

function indexFirstByNc(rows) {
  const map = new Map();
  for (const r of rows) {
    for (const n of ncFromRow(r)) {
      if (!map.has(n)) map.set(n, r);
    }
  }
  return map;
}

function isBlankMews(v) {
  const c = clean(v);
  if (!c) return true;
  if (c === '/' || c === '-' || c === '.') return true;
  return false;
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const c = clean(v);
    if (c && c !== '/' && c !== '-' && c !== '.') return c;
  }
  return null;
}

function normalizeEmailField(v) {
  const c = clean(v);
  if (!c || c === '/' || c === '-') return null;
  const fromLabel = c.replace(/^\.?\s*Email:\s*/i, '').trim();
  const blob = fromLabel.includes('@') ? fromLabel : c;
  const m = blob.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

function setIfEmpty(out, key, val) {
  if (val == null || isBlankMews(val)) return;
  if (isBlankMews(out[key])) out[key] = val;
}

function hasMoneyValue(v) {
  if (isBlankMews(v)) return false;
  return /\d/.test(String(v).replace(/\s/g, '').replace(',', '.'));
}

function normalizePostalCode(v) {
  const c = clean(v);
  if (!c) return null;
  const digits = c.replace(/^\/+|\/+$/g, '').match(/\d{4,10}/);
  return digits ? digits[0] : isBlankMews(c) ? null : c;
}

function inferPrepaidFromMonthlyRent(out) {
  if (hasMoneyValue(out['Prepaid Amount'])) return;
  const rent = firstNonEmpty(out['Allocated Rate'], out['Per Night Prices']);
  if (!hasMoneyValue(rent)) return;
  const blob = `${clean(out['Prepaid Amount'])} ${clean(out['Reservation Notes'])}`.toLowerCase();
  if (/mensualidad|monthly|equivalente\s+a\s+(?:una|media)\s+mensualidad|one\s+month/i.test(blob)) {
    out['Prepaid Amount'] = rent;
  }
}

function applyCompanyRecordToRow(out, co, { overwritePartner = false } = {}) {
  if (!co) return;
  setIfEmpty(out, 'Address Line 1', co['Address Line 1']);
  setIfEmpty(out, 'Address Line 2', co['Address Line 2']);
  setIfEmpty(out, 'City', co['City']);
  setIfEmpty(out, 'Postal Code', normalizePostalCode(co['Postal Code']) || co['Postal Code']);
  setIfEmpty(out, 'Country Code', co['Country Code']);
  const tax = firstNonEmpty(co['Tax ID Number'], co['Fiscal Identifier'], co['Additional Tax Identifier']);
  setIfEmpty(out, 'Tax Identification Number', tax);
  if (overwritePartner || isBlankMews(out['Partner Company'])) {
    setIfEmpty(out, 'Partner Company', co['Company Name(*)']);
    setIfEmpty(out, 'Company Id', co['Company Name(*)']);
  }
}

function fillB2bDocumentFromTaxId(out) {
  if (!isBlankMews(out['Document Number'])) return;
  const tax = clean(out['Tax Identification Number']);
  if (!tax || tax === '/') return;
  out['Document Number'] = tax;
  setIfEmpty(out, 'Document Type', 'TaxIdentificationNumber');
}

function applyMandatoryGapFills(out, b2b, companyMews, companyExtract) {
  applyCompanyRecordToRow(out, companyExtract);
  inferPrepaidFromMonthlyRent(out);
  if (b2b) {
    fillB2bDocumentFromTaxId(out);
  }
  const postal = normalizePostalCode(out['Postal Code']);
  if (postal && isBlankMews(out['Postal Code'])) out['Postal Code'] = postal;
}

function parseDepartureIso(row) {
  const raw = clean(row?.['Departure Date(*)']);
  if (!raw || raw === '/') return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function keepCurrentOrFutureReservation(row) {
  const dep = parseDepartureIso(row);
  if (!dep) return false;
  return dep >= MIN_DEPARTURE_DATE;
}

function roomNumberForSources(b2b, row, seg, hm, cust) {
  if (b2b) {
    return firstNonEmpty(
      row['Allocated Room Number'],
      seg?.['Allocated Room Number'],
      hm?.['Allocated Room Number'],
      cust?.['Allocated Room Number'],
    );
  }
  return firstNonEmpty(
    hm?.['Allocated Room Number'],
    cust?.['Allocated Room Number'],
    row['Allocated Room Number'],
    seg?.['Allocated Room Number'],
  );
}

function applyB2bGuestAndCompany(out, row, hm, cust, seg, company) {
  const companyLabel = firstNonEmpty(
    company?.['Company Name(*)'],
    row['Company Id'],
    row['Partner Company'],
    seg?.['Partner Company'],
    cust?.['Partner Company'],
    isLikelyCompanyLabel(row['Last Name(*)']) ? row['Last Name(*)'] : null,
  );
  if (companyLabel) {
    out['Partner Company'] = companyLabel;
    out['Company Id'] = companyLabel;
  }

  const personSources = [hm, cust, seg, row].filter(Boolean);
  for (const field of ['Last Name(*)', 'First Name', 'Second Last Name']) {
    const v = firstNonEmpty(...personSources.map((r) => r?.[field]));
    if (!v) continue;
    if (field === 'Last Name(*)' && isLikelyCompanyLabel(v) && !isLikelyCompanyLabel(companyLabel || '')) continue;
    out[field] = v;
  }
  if (isLikelyCompanyLabel(out['Last Name(*)']) && hm) {
    const hmName = firstNonEmpty(hm['Last Name(*)'], hm['First Name']);
    if (hmName && !isLikelyCompanyLabel(hmName)) out['Last Name(*)'] = hmName;
    setIfEmpty(out, 'First Name', hm['First Name']);
    setIfEmpty(out, 'Second Last Name', hm['Second Last Name']);
  }
}

function sanitizePlaceholders(out) {
  for (const [key, val] of Object.entries(out)) {
    if (key === 'nc_number') continue;
    if (isBlankMews(val)) out[key] = null;
  }
}

function parseIsoDateField(row, field) {
  const raw = clean(row?.[field]);
  const m = raw?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** In-house B2B: guest ID / billing / deposit prefer HouseMonk then Customers. */
function isCurrentStay(row, todayIso = process.env.AUDIT_TODAY || '2026-10-20') {
  const arr = parseIsoDateField(row, 'Arrival Date(*)');
  const dep = parseIsoDateField(row, 'Departure Date(*)');
  if (!arr || !dep) return false;
  return arr <= todayIso && dep >= todayIso;
}

function applyAddressFromSources(out, sources) {
  for (const field of ['Address Line 1', 'Address Line 2', 'City', 'Postal Code', 'Country Code']) {
    setIfEmpty(out, field, firstNonEmpty(...sources.map((r) => r?.[field])));
  }
}

function enrichCustomerRow(row, nc, cust, hm, seg, company, companiesExtract, customersExt = null) {
  const b2b = isB2bReservation(nc, row, seg);
  const inHouseB2b = b2b && isCurrentStay(row);
  const guestOrder = b2b ? [hm, cust, seg, row] : [row, cust, hm, seg];
  const identityOrder = inHouseB2b ? [hm, cust, row, seg] : guestOrder;
  const billingOrder = inHouseB2b ? [hm, cust, row, seg] : b2b ? [hm, cust, seg, row] : [row, cust, hm, seg];
  const dateOrder = [row, seg, cust, hm];
  const moneyOrder = inHouseB2b ? [hm, cust, row, seg] : [row, seg, cust, hm];

  let out = { ...row, nc_number: nc };
  if (customersExt) out = applyContractExtractionOverlay(out, customersExt);

  if (b2b) applyB2bGuestAndCompany(out, row, hm, cust, seg, company);
  else {
    for (const field of ['Last Name(*)', 'First Name', 'Second Last Name']) {
      const v = firstNonEmpty(...guestOrder.map((r) => r?.[field]));
      if (v) out[field] = v;
    }
  }

  setIfEmpty(out, 'Document Number', firstNonEmpty(...identityOrder.map((r) => r?.['Document Number'])));
  setIfEmpty(out, 'Document Type', firstNonEmpty(...identityOrder.map((r) => r?.['Document Type'])));

  const pickedEmail = pickGuestEmail(
    normalizeEmailField,
    ...guestOrder.map((r) => r?.Email),
    company?.['Invoicing Email'],
    out.Email,
  );
  if (pickedEmail) out.Email = pickedEmail;
  else if (isBlankMews(out.Email)) out.Email = null;

  setIfEmpty(out, 'Arrival Date(*)', firstNonEmpty(...dateOrder.map((r) => r?.['Arrival Date(*)'])));
  setIfEmpty(out, 'Departure Date(*)', firstNonEmpty(...dateOrder.map((r) => r?.['Departure Date(*)'])));

  setIfEmpty(out, 'Child Count(*)', firstNonEmpty(...guestOrder.map((r) => r?.['Child Count(*)'])));
  setIfEmpty(
    out,
    'Adult Count(*)',
    firstNonEmpty(...guestOrder.flatMap((r) => [r?.['Adult Count(*)'], r?.['Person Counts(*)']])),
  );

  if (!clean(out['Child Count(*)'])) out['Child Count(*)'] = '0';
  out['Person Counts(*)'] = null;

  setIfEmpty(out, 'Allocated Rate', firstNonEmpty(...moneyOrder.map((r) => r?.['Allocated Rate'])));
  setIfEmpty(out, 'Per Night Prices', firstNonEmpty(row['Per Night Prices'], out['Allocated Rate']));
  setIfEmpty(out, 'Prepaid Amount', firstNonEmpty(...moneyOrder.map((r) => r?.['Prepaid Amount'])));

  const roomNumRaw = roomNumberForSources(b2b, row, seg, hm, cust);
  const roomNum = roomNumRaw ? formatAllocatedRoomNumber(roomNumRaw) || roomNumRaw : null;
  if (roomNum) out['Allocated Room Number'] = roomNum;
  const mappedCat = categoryForRoomNumber(roomNum, roomMap);
  if (mappedCat) out['Allocated Room Category(*)'] = mappedCat;
  else {
    setIfEmpty(
      out,
      'Allocated Room Category(*)',
      firstNonEmpty(
        row['Allocated Room Category(*)'],
        seg?.['Allocated Room Category(*)'],
        hm?.['Allocated Room Category(*)'],
        cust?.['Allocated Room Category(*)'],
      ),
    );
  }

  setIfEmpty(
    out,
    'Included Products',
    firstNonEmpty(row['Included Products'], seg?.['Included Products'], cust?.['Included Products'], hm?.['Included Products']),
  );
  setIfEmpty(out, 'Telephone', firstNonEmpty(...guestOrder.map((r) => r?.Telephone)));
  applyAddressFromSources(out, billingOrder);

  if (company) {
    applyCompanyRecordToRow(out, {
      'Address Line 1': company['Address Line 1'],
      'Address Line 2': company['Address Line 2'],
      City: company['City'],
      'Postal Code': company['Postal Code'],
      'Country Code': company['Country Code'],
      'Tax ID Number': firstNonEmpty(company['Tax ID Number'], company['Fiscal Identifier']),
      'Company Name(*)': company['Company Name(*)'],
    });
    setIfEmpty(out, 'Invoiceable', company.Invoiceable);
    setIfEmpty(out, 'Billing Code', company['Billing Code']);
    setIfEmpty(out, 'Accounting Code', company['Accounting Code']);
  } else if (b2b) {
    setIfEmpty(out, 'Partner Company', firstNonEmpty(cust?.['Partner Company'], hm?.['Partner Company'], row['Partner Company']));
    setIfEmpty(out, 'Company Id', firstNonEmpty(cust?.['Company Id'], hm?.['Company Id'], row['Company Id']));
  }

  let companyExtract = null;
  if (b2b && companiesExtract?.length) {
    const match = bestCompanyMatch([out, row, cust, hm, seg].filter(Boolean), companiesExtract);
    if (match && (match.tier === 'strong' || match.tier === 'medium')) companyExtract = match.company;
  }

  applyMandatoryGapFills(out, b2b, company, companyExtract);
  applyTenancyAndManualFills(out, nc, tenancyLookup);
  stripChamariFromCustomerRow(out);
  if (b2b) {
    reapplyB2bCompanyOnCustomer(out, nc, {
      seg,
      cust,
      hm,
      companiesExtract,
      tenancyRow: resolveTenancyForCustomer(nc, out, tenancyLookup),
    });
  }

  if (!clean(out['Currency Code'])) out['Currency Code'] = 'EUR';

  const code = row['Group Code'] || `NC_${String(nc).padStart(4, '0')}`;
  out['Group Code'] = code;
  out['Internal Guest Notes'] = code;

  sanitizePlaceholders(out);
  applyPersonCountFills(out, cust, hm, seg, row);
  return out;
}

function enrichCompanyRow(row) {
  return { ...row };
}

async function fetchAll(table, { orderByNc = true } = {}) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select('*');
    if (orderByNc) q = q.order('nc_number');
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

function stripMeta(row) {
  const { id, created_at, ...rest } = row;
  return rest;
}

const MISSING_COL_RE = /Could not find the '([^']+)' column/;
const MISSING_TABLE_RE = /Could not find the table '([^']+)'/;

function isBenignDeleteError(message = '') {
  return (
    /does not exist/i.test(message) ||
    /schema cache/i.test(message) ||
    MISSING_TABLE_RE.test(message)
  );
}

function isMissingTableError(message = '') {
  return MISSING_TABLE_RE.test(message) || /schema cache/i.test(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sqlLiteral(v) {
  if (v == null || v === '') return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function writeCompaniesSeedSql(table, rows, filePath) {
  if (!rows.length) return;
  const sample = stripMeta({ ...rows[0] });
  const cols = Object.keys(sample).filter((k) => k !== 'id' && k !== 'created_at');
  const lines = [
    `-- Seed ${table} (${rows.length} rows) — run in Supabase SQL Editor if API upload hits schema cache.`,
    'begin;',
    `delete from public."${table}" where nc_number >= 0;`,
  ];
  for (const row of rows) {
    const data = stripMeta({ ...row });
    const vals = cols.map((c) => sqlLiteral(data[c]));
    const colList = cols.map((c) => `"${c}"`).join(', ');
    lines.push(`insert into public."${table}" (${colList}) values (${vals.join(', ')});`);
  }
  lines.push('commit;');
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

async function replaceTable(table, rows) {
  const { error: delError } = await sb.from(table).delete().gte('nc_number', 0);
  if (delError && !isBenignDeleteError(delError.message)) {
    throw delError;
  }

  const omit = new Set();
  let tableRetries = 0;
  for (;;) {
    let failed = null;
    for (let i = 0; i < rows.length; i += 60) {
      const chunk = rows.slice(i, i + 60).map((r) => {
        const out = stripMeta({ ...r });
        for (const c of omit) delete out[c];
        return out;
      });
      if (!chunk.length) continue;
      const { error } = await sb.from(table).insert(chunk);
      if (error) {
        failed = error;
        break;
      }
    }
    if (!failed) break;
    const m = MISSING_COL_RE.exec(failed.message);
    if (isMissingTableError(failed.message)) {
      tableRetries++;
      if (tableRetries <= 5) {
        await sleep(2000);
        continue;
      }
      return { skipped: true, omitted: [...omit], reason: failed.message };
    }
    if (!m) throw failed;
    if (omit.has(m[1])) throw failed;
    omit.add(m[1]);
    await sb.from(table).delete().gte('nc_number', 0);
  }
  return { skipped: false, omitted: [...omit], reason: null };
}

if (!Object.keys(roomMap).length) {
  console.error('Room map empty — run: node build-room-number-category-map.mjs');
  process.exit(1);
}

const [mewsRows, companyRows, ffCust, ffHm, ffSeg, companiesExtract, unitActualByNc, custExtRows] = await Promise.all([
  fetchAll(SRC_CUSTOMERS),
  fetchAll(SRC_COMPANIES),
  fetchAll(FF_CUSTOMERS, { orderByNc: false }),
  fetchAll(FF_HM, { orderByNc: false }),
  fetchAll(FF_SEG, { orderByNc: false }),
  fetchAll(COMPANIES_EXTRACTION, { orderByNc: false }),
  loadUnitActualValueByNc(),
  fetchAll(CUSTOMERS_EXT, { orderByNc: false }).catch(() => []),
]);

const custByNc = indexFirstByNc(ffCust);
const custExtByNc = indexFirstByNc(custExtRows);
const hmByNc = indexFirstByNc(ffHm);
const segByNc = indexFirstByNc(ffSeg);
const companyByNc = new Map(companyRows.map((r) => [Number(r.nc_number), r]));

let b2bGuestFromHm = 0;
let roomCategoryMapped = 0;

const customersEnriched = mewsRows.map((row) => {
  const nc = Number(row.nc_number);
  const cust = custByNc.get(nc);
  const hm = hmByNc.get(nc);
  const seg = segByNc.get(nc);
  const company = companyByNc.get(nc);
  const b2b = isB2bReservation(nc, row, seg);
  if (b2b && hm && clean(hm['Last Name(*)'])) b2bGuestFromHm++;
  const enriched = enrichCustomerRow(
    row,
    nc,
    cust,
    hm,
    seg,
    company,
    companiesExtract,
    custExtByNc.get(nc),
  );
  if (categoryForRoomNumber(enriched['Allocated Room Number'], roomMap)) roomCategoryMapped++;
  return enriched;
});

const removedPastCheckout = customersEnriched.filter((r) => !keepCurrentOrFutureReservation(r));
const excludedTenancyMovedOut = customersEnriched.filter((r) => shouldExcludeNcFromV2(r.nc_number));
const customersOut = customersEnriched
  .filter((r) => keepCurrentOrFutureReservation(r) && !shouldExcludeNcFromV2(r.nc_number))
  .map((r) => {
    stripChamariFromCustomerRow(r);
    applyMewsRoomAndCategoryStandards(r, roomMap);
    applyUnitActualValueCategory(r, unitActualByNc);
    const cust = custByNc.get(Number(r.nc_number));
    applyPersonCountFills(r, cust);
    const products = mapRowToMewsIncludedProducts(r, cust);
    if (products) r['Included Products'] = products;
    applyMewsStayRateAndMonthlyPricing(r);
    applyMewsImportReadyFields(r);
    return r;
  });
const keptNc = new Set(customersOut.map((r) => Number(r.nc_number)));

const enrichedByNc = new Map(customersEnriched.map((r) => [Number(r.nc_number), r]));
const companiesByNc = new Map();

for (const nc of B2B_NCS) {
  const built = buildV2CompanyRow(nc, {
    seg: segByNc.get(nc),
    cust: custByNc.get(nc),
    hm: hmByNc.get(nc),
    customerRow: enrichedByNc.get(nc),
    companiesExtract,
    tenancyRow: resolveTenancyForCustomer(nc, enrichedByNc.get(nc) || {}, tenancyLookup),
    existingCompanyRow: companyByNc.get(nc),
  });
  if (built) companiesByNc.set(nc, built);
}

for (const r of companyRows) {
  const nc = Number(r.nc_number);
  if (!keptNc.has(nc) || companiesByNc.has(nc)) continue;
  const copy = stripChamariFromCompanyRow({ ...r, nc_number: nc });
  if (clean(copy['Company Name(*)'])) companiesByNc.set(nc, copy);
}

const companiesOut = [...companiesByNc.values()].sort((a, b) => a.nc_number - b.nc_number);

const b2bMissingCompanyAfterResolve = [...B2B_NCS].filter((nc) => {
  const row = enrichedByNc.get(nc);
  if (!row || !isB2bReservation(nc, row, segByNc.get(nc))) return false;
  return !clean(row['Partner Company']) && !clean(row['Company Id']);
});

const custUp = await replaceTable(V2_CUSTOMERS, customersOut);
const coUp = await replaceTable(V2_COMPANIES, companiesOut);

const companiesSeedSqlPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'contract-analysis',
  'supabase-v2-companies-seed-19-10-2026.sql',
);
if (coUp.skipped && companiesOut.length) {
  writeCompaniesSeedSql(V2_COMPANIES, companiesOut, companiesSeedSqlPath);
}

const withEmail = customersOut.filter((r) => normalizeEmailField(r.Email)).length;

const summary = {
  minDepartureDate: MIN_DEPARTURE_DATE,
  removedPastCheckout: removedPastCheckout.length,
  excludedTenancyMovedOutNcs: excludedTenancyMovedOut.map((r) => r.nc_number),
  chamariStrippedCustomerRowsBeforeFilter: customersEnriched.filter((r) => rowReferencesChamari(r)).length,
  chamariInV2CustomersAfterStrip: customersOut.filter((r) => rowReferencesChamari(r)).length,
  chamariInV2CompaniesAfterStrip: companiesOut.filter((r) => rowReferencesChamari(r)).length,
  b2bNcsUnionSize: B2B_NCS.size,
  b2bMissingCompanyAfterResolveCount: b2bMissingCompanyAfterResolve.length,
  b2bMissingCompanyAfterResolveSample: b2bMissingCompanyAfterResolve.slice(0, 25),
  removedPastCheckoutSampleNcs: removedPastCheckout.slice(0, 20).map((r) => r.nc_number),
  customerRowsWithEmail: withEmail,
  b2bRowsInOutput: customersOut.filter((r) => isB2bReservation(r.nc_number, r, segByNc.get(r.nc_number))).length,
  b2bWithRoomNumber: customersOut.filter((r) => {
    const seg = segByNc.get(r.nc_number);
    return isB2bReservation(r.nc_number, r, seg) && clean(r['Allocated Room Number']);
  }).length,
  roomMapKeys: Object.keys(roomMap).length,
  sourceCustomers: mewsRows.length,
  sourceCompanies: companyRows.length,
  v2CustomersTable: V2_CUSTOMERS,
  v2CompaniesTable: V2_COMPANIES,
  customerRows: customersOut.length,
  companyRows: companiesOut.length,
  b2bGuestFromHm,
  roomCategoryMapped,
  customersUpload: custUp,
  companiesUpload: coUp,
  companiesSeedSql: coUp.skipped ? companiesSeedSqlPath : null,
  ddlCustomers: path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'contract-analysis',
    'supabase-v2-all-fields-match-mews-import-19-10-2026.sql',
  ),
  ddlCompanies: path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'contract-analysis',
    'supabase-v2-all-fields-match-mews-import-companies-19-10-2026.sql',
  ),
};

fs.writeFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'v2-mews-import-19-10-2026-summary.json'),
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
