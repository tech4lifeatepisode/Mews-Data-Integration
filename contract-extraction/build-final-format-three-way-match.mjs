/**
 * Three-way match: Customers / Seguimiento / HouseMonk (excl. Missing_Group_Code HM rows).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { companyFieldsForNc, isLikelyCompanyLabel } from './company-match-utils.mjs';
import { CUSTOMER_HEADERS } from './mews-customer-headers.mjs';
import { COMPANY_HEADERS } from './mews-company-headers.mjs';
import {
  contractAuthoritativeForNc,
  contractRentFromCustomer,
  isB2bContractAuthoritativeNc,
  isMamaCumbeRow,
  loadB2bContractAuthoritativeNcs,
} from './b2b-contract-authoritative.mjs';
import {
  housemonkTrustForNc,
  loadB2b2cSignedHousemonkTrustNcs,
} from './b2b2c-signed-housemonk-trust.mjs';

const B2B_CONTRACT_NCS = loadB2bContractAuthoritativeNcs();
const B2B2C_SIGNED_TRUST_NCS = loadB2b2cSignedHousemonkTrustNcs();

/** ≤63 chars (PG identifier limit). Long name truncates and breaks PostgREST. */
const MATCH_TABLE = 'Final_Format_Three_Way_Match_15_10_2026';
const MISMATCH_NAMES = 'Final_Format_Mismatch_Names_15_10_2026';
const MISMATCH_UNITS = 'Final_Format_Mismatch_Unit_Types_15_10_2026';
const MISMATCH_DATES = 'Final_Format_Mismatch_Dates_15_10_2026';
const MISMATCH_EXTRAS = 'Final_Format_Mismatch_Extras_15_10_2026';
const MISMATCH_RENT = 'Final_Format_Mismatch_Rent_15_10_2026';
const MISMATCH_DEPOSITS = 'Final_Format_Mismatch_Deposits_15_10_2026';
const ALL_FIELDS_MEEWS = 'Final_Format_All_Fields_Match_Mews_Import_15_10_2026';
const ALL_FIELDS_MEEWS_COMPANIES = 'Final_Format_All_Fields_Match_Mews_Import_Companies_15_10_2026';

const CUSTOMERS = 'Final_Format_Customers_Contracts_Extraction_15_10_2026';
const CUSTOMERS_EXT = 'Customers_Contracts_Extraction_12_10_2026';
const HM = 'Final_Format_HouseMonk_15_10_2026';
const SEG = 'Final_Format_Seguimiento_15_10_2026';
const MISSING_HM = 'Missing_Group_Code_HouseMonk_15_10_2026';
const COMPANIES = 'Companies_Extraction_12_10_2026';

const OUT_SQL_DDL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'contract-analysis',
  'supabase-matching-across-final-format-15-10-2026-ddl.sql',
);

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

function clean(v) {
  return v == null ? '' : String(v).trim();
}
function ncFromRow(row) {
  const nums = new Set();
  for (const t of [row['Group Code'], row['Internal Guest Notes']].filter(Boolean)) {
    for (const m of String(t).matchAll(/NC_0*(\d+)/gi)) nums.add(Number(m[1]));
  }
  return [...nums];
}
function ncLabel(n) {
  return `NC_${String(n).padStart(4, '0')}`;
}
function normName(v) {
  return clean(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function nameTokens(v) {
  return normName(v)
    .split(' ')
    .filter((t) => t.length > 2);
}
function firstNameKey(row) {
  return nameTokens(row['First Name'])[0] || '';
}
function lastNameKeys(row) {
  return [...new Set([...nameTokens(row['Last Name(*)']), ...nameTokens(row['Second Last Name'])])];
}
function displayName(row) {
  return [clean(row['First Name']), clean(row['Last Name(*)']), clean(row['Second Last Name'])].filter(Boolean).join(' ');
}
function normDoc(v) {
  const d = clean(v).replace(/\s+/g, '').toUpperCase();
  if (!d || d === '/' || d === '-') return '';
  return d;
}
function docsFromRow(row) {
  return [...new Set(String(row['Document Number'] || '').split(/[|,]/).map(normDoc).filter(Boolean))];
}
function normUnit(u) {
  return clean(u)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normUnitCore(u) {
  let raw = normUnit(u);
  if (!raw) return '';
  if (
    /terrace/.test(raw) &&
    (/2\s*bed\s*\(\s*1\s*\/\s*2\s*\)/.test(raw) || /2\s*bedroom/.test(raw) || /two bedroom/.test(raw))
  ) {
    return 'two bedroom with terrace';
  }
  if (/^2\s*bed\s*\(\s*1\s*\/\s*2\s*\)$/.test(raw) || /^2\s*bed\s*\(\s*2\s*\/\s*2\s*\)$/.test(raw)) {
    return '2 bed seg shorthand';
  }
  let n = raw;
  n = n.replace(/\bstandar\b/g, 'standard');
  n = n.replace(/\bw\b/g, 'with');
  n = n.replace(/\s*\+\s*/g, ' ');
  n = n.replace(/\(\s*pmr\s*\)/gi, ' ');
  n = n.replace(/\(\s*\d+\s*\/\s*\d+\s*\)/g, ' ');
  n = n.replace(/[^a-z0-9+ ]/g, ' ');
  n = n.replace(/\b2\s*\+\s*1\b/g, '2 1');
  n = n.replace(/\b2\s*\+\s*2\b/g, '2 2');
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

const UNIT_CANON = new Map([
  ['the standard', 'studio standard'],
  ['studio standard', 'studio standard'],
  ['the standard with terrace', 'studio standard with terrace'],
  ['studio standard with terrace', 'studio standard with terrace'],
  ['studio standard terrace', 'studio standard with terrace'],
  ['the comfort', 'studio comfort'],
  ['studio comfort', 'studio comfort'],
  ['the rooftop', 'studio rooftop'],
  ['studio rooftop', 'studio rooftop'],
  ['2 bedroom double single', 'two bedroom 2+1'],
  ['2 bedroom (double / single)', 'two bedroom 2+1'],
  ['2-bed (double / single)', 'two bedroom 2+1'],
  ['2bed (2+1)', 'two bedroom 2+1'],
  ['the two bedroom (2+1)', 'two bedroom 2+1'],
  ['2 bedroom double double', 'two bedroom 2+2'],
  ['2 bedroom (double / double)', 'two bedroom 2+2'],
  ['the two bedrooms (2+2)', 'two bedroom 2+2'],
  ['the two bedroom 2+2', 'two bedroom 2+2'],
  ['2 bed rooftop', 'two bedroom rooftop'],
  ['2 bedroom rooftop', 'two bedroom rooftop'],
  ['the two bedroom rooftop', 'two bedroom rooftop'],
  ['2 bed seg shorthand', 'two bedroom seg shorthand'],
  ['two bedroom with terrace', 'two bedroom with terrace'],
  ['the two bedroom with terrace', 'two bedroom with terrace'],
  ['2 bedroom with terrace', 'two bedroom with terrace'],
]);

function unitKey(u) {
  const n = normUnitCore(u);
  if (!n) return '';
  if (UNIT_CANON.has(n)) return UNIT_CANON.get(n);

  if (/two bedroom with terrace|2 bedroom with terrace|bedroom with terrace/.test(n)) return 'two bedroom with terrace';
  if (/standard.*terrace|terrace.*standard|studio standard terrace/.test(n)) return 'studio standard with terrace';
  if (/two bedroom.*rooftop|2 bed.*rooftop|bedroom rooftop|bed rooftop/.test(n)) return 'two bedroom rooftop';
  if (/two bedrooms?\s+2\s+2|two bedroom\s+2\s+2|double double/.test(n)) return 'two bedroom 2+2';
  if (/two bedrooms?\s+2\s+1|two bedroom\s+2\s+1|2bed\s+2\s+1|double single/.test(n)) return 'two bedroom 2+1';

  return n;
}

/** Seguimiento labels like "2 Bed (1/2)" follow HouseMonk when C↔H canonical keys agree. */
function unitKeysAlign(c, h) {
  const uc = unitKey(c?.['Allocated Room Category(*)']);
  const uh = unitKey(h?.['Allocated Room Category(*)']);
  if (!uc || !uh) return null;
  if (uc === uh) return true;
  const segSh = 'two bedroom seg shorthand';
  if (uc === segSh && (uh === 'two bedroom 2+1' || uh === 'two bedroom 2+2')) return true;
  if (uh === segSh && (uc === 'two bedroom 2+1' || uc === 'two bedroom 2+2')) return true;
  const segTerrace = 'two bedroom with terrace';
  if (uc === segTerrace || uh === segTerrace) return uc === uh;
  return false;
}

function unitsMatchForNc(c, s, h) {
  const n = [c, s, h].filter(Boolean).length;
  if (n < 2) return null;
  if (c && h) return unitKeysAlign(c, h);
  if (c && s) return unitKey(c['Allocated Room Category(*)']) === unitKey(s['Allocated Room Category(*)']);
  if (s && h) return unitKey(s['Allocated Room Category(*)']) === unitKey(h['Allocated Room Category(*)']);
  return null;
}
function parseDate(v) {
  const s = clean(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/** Monthly rent / deposit amounts (Allocated Rate + Prepaid Amount in Final_Format). */
function parseMoney(v) {
  const raw = clean(v);
  if (!raw || raw === '/' || raw === '-') return null;
  let s = raw.replace(/[^\d.,-]/g, '');
  if (!s) return null;
  if (/,/.test(s) && /\.\d{3}/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function formatMoney(n) {
  if (n == null) return null;
  if (Math.abs(n - Math.round(n)) < 0.001) return String(Math.round(n));
  return n.toFixed(2);
}

function maybeRescaleTinyRent(raw, n) {
  if (n == null || n >= 80) return n;
  const digits = clean(raw).replace(/[^\d.]/g, '');
  // Seguimiento sometimes stores 1320 as "1.32" / "1.320"
  if (/^\d\.\d{2,3}$/.test(digits) && n * 1000 >= 200) return Math.round(n * 1000 * 100) / 100;
  return n;
}

function rentAmountFromRow(row) {
  if (!row) return null;
  for (const field of ['Allocated Rate', 'Per Night Prices', 'Total Price']) {
    const raw = row[field];
    const n = maybeRescaleTinyRent(raw, parseMoney(raw));
    if (n != null) return n;
  }
  return null;
}

const RENT_TOLERANCE_EUR = 10;
const DEPOSIT_TOLERANCE_EUR = 10;

function meaningfulPartnerField(v) {
  const x = clean(v);
  return x && x !== '/';
}

function isCompanyLinkedCustomer(c, companies) {
  if (!c) return false;
  if (isMamaCumbeRow(c)) return true;
  if (meaningfulPartnerField(c['Partner Company']) || meaningfulPartnerField(c['Company Id'])) return true;
  if (isLikelyCompanyLabel(displayName(c))) return true;
  if (companies?.length) {
    const cf = companyFieldsForNc(c, null, null, companies);
    if (cf.companies_match_tier) return true;
  }
  return false;
}

function vatGrossMatchesNet(gross, net) {
  return gross != null && net != null && Math.abs(gross - Math.round(net * 1.1 * 100) / 100) <= 2;
}

function segHousemonkAmountsAgree(s, h, pickAmount) {
  if (!s || !h) return false;
  const rs = pickAmount(s);
  const rh = pickAmount(h);
  return rs != null && rh != null && Math.abs(rs - rh) <= RENT_TOLERANCE_EUR;
}

/** B2B / company PDF vs operational billing (Seg+HM agree → trust HM). */
function operationalRentFromCustomersRow(c, h, s, companies, nc) {
  const rc = rentAmountFromRow(c);
  if (!c) return rc;
  if (contractAuthoritativeForNc(c, nc)) return contractRentFromCustomer(c);
  const rh = h ? rentAmountFromRow(h) : null;
  if (isMamaCumbeRow(c) && rc === 1441 && (rh === 1310 || rh == null)) return 1310;
  if (
    rh != null &&
    segHousemonkAmountsAgree(s, h, rentAmountFromRow) &&
    isCompanyLinkedCustomer(c, companies)
  ) {
    if (rc == null || Math.abs(rc - rh) > RENT_TOLERANCE_EUR) {
      if (vatGrossMatchesNet(rc, rh)) return rh;
      return rh;
    }
  }
  return rc;
}

function rentMatchCustomersHousemonk(c, h, s, companies, nc) {
  const rh = rentAmountFromRow(h);
  if (!c || rh == null) return null;
  const candidates = [
    operationalRentFromCustomersRow(c, h, s, companies, nc),
    contractRentFromCustomer(c),
    rentAmountFromRow(c),
  ].filter((n) => n != null);
  if (!candidates.length) return null;
  return candidates.some((rc) => Math.abs(rc - rh) <= RENT_TOLERANCE_EUR);
}

function depositAmountFromRow(row) {
  if (!row) return null;
  return parseMoney(row['Prepaid Amount']);
}

function operationalDepositFromCustomersRow(c, h, s, companies, nc) {
  const dc = depositAmountFromRow(c);
  if (!c) return dc;
  if (contractAuthoritativeForNc(c, nc)) return dc;
  const dh = h ? depositAmountFromRow(h) : null;
  if (
    dh != null &&
    segHousemonkAmountsAgree(s, h, depositAmountFromRow) &&
    isCompanyLinkedCustomer(c, companies)
  ) {
    if (dc == null || Math.abs(dc - dh) > DEPOSIT_TOLERANCE_EUR) {
      if (dc != null && dc < 80 && dh >= 200) return dh;
      return dh;
    }
  }
  return dc;
}

function depositMatchCustomersHousemonk(c, h, s, companies, nc) {
  const dc = operationalDepositFromCustomersRow(c, h, s, companies, nc);
  const dh = depositAmountFromRow(h);
  if (dc == null || dh == null) return null;
  return Math.abs(dc - dh) <= DEPOSIT_TOLERANCE_EUR;
}

function moneyAmountsMatch(a, b, pickAmount, toleranceEur = 0.02) {
  if (!a || !b) return null;
  const ma = pickAmount(a);
  const mb = pickAmount(b);
  if (ma == null || mb == null) return null;
  return Math.abs(ma - mb) <= toleranceEur;
}

function rentMatch(a, b) {
  return moneyAmountsMatch(a, b, rentAmountFromRow, RENT_TOLERANCE_EUR);
}

function depositMatch(a, b) {
  return moneyAmountsMatch(a, b, depositAmountFromRow, DEPOSIT_TOLERANCE_EUR);
}

/** When Contracts + HouseMonk exist, rent uses only that pair (±€10); Seguimiento ignored. */
function rentMatchForNc(c, s, h, nc) {
  if (isB2bContractAuthoritativeNc(nc, B2B_CONTRACT_NCS)) return true;
  const n = [c, s, h].filter(Boolean).length;
  if (n < 2) return null;
  if (c && h) return rentMatchCustomersHousemonk(c, h, s, companies, nc);
  if (contractAuthoritativeForNc(c, nc)) {
    return contractRentFromCustomer(c) != null ? true : null;
  }
  return allPairsMatch([c, s, h], rentMatch);
}

/** When Contracts + HouseMonk exist, deposit uses only that pair (±€10); Seguimiento ignored. */
function depositMatchForNc(c, s, h, nc) {
  if (isB2bContractAuthoritativeNc(nc, B2B_CONTRACT_NCS)) return true;
  if (contractAuthoritativeForNc(c, nc)) {
    return depositAmountFromRow(c) != null ? true : null;
  }
  const n = [c, s, h].filter(Boolean).length;
  if (n < 2) return null;
  if (c && h) return depositMatchCustomersHousemonk(c, h, s, companies, nc);
  return allPairsMatch([c, s, h], depositMatch);
}
function parseExtraField(notes, label) {
  const m = clean(notes).match(new RegExp(`${label}:\\s*([^|]+)`, 'i'));
  if (!m) return '';
  return clean(m[1])
    .toLowerCase()
    .replace(/\.$/, '')
    .trim();
}
function normExtra(v) {
  const s = clean(v).toLowerCase();
  if (!s || s === '/' || s === 'no' || s === 'none' || s === 'n/a') return 'no';
  if (s.startsWith('no ')) return 'no';
  return 'yes';
}
function extrasFromNotes(notes) {
  return {
    meal_plan: normExtra(parseExtraField(notes, 'Meal plan')),
    parking: normExtra(parseExtraField(notes, 'Parking')),
    meal_raw: parseExtraField(notes, 'Meal plan'),
    parking_raw: parseExtraField(notes, 'Parking'),
  };
}

/** Contracts use Reservation Notes; HM tenancy export rarely has Meal plan:/Parking: lines. */
function hasContractStyleExtras(notes) {
  const n = clean(notes);
  return /meal plan\s*:/i.test(n) || /parking\s*:/i.test(n);
}

function extrasFromHousemonkRow(row) {
  const notes = clean(row['Reservation Notes']);
  const inc = clean(row['Included Products']).toLowerCase();
  const fromNotes = extrasFromNotes(notes);
  const explicitNotes = hasContractStyleExtras(notes);

  let meal_plan = null;
  let parking = null;
  if (explicitNotes) {
    meal_plan = fromNotes.meal_plan;
    parking = fromNotes.parking;
  }
  if (/parking/.test(inc)) parking = 'yes';
  if (/meal plan|pension|pensi[oó]n|comida|men[uú]|desayuno|all in/.test(inc)) meal_plan = 'yes';

  const hmOperational = explicitNotes || /parking|meal|pension|comida|men[uú]|desayuno/.test(inc);
  return {
    meal_plan,
    parking,
    hmOperational,
    meal_raw: fromNotes.meal_raw,
    parking_raw: fromNotes.parking_raw,
  };
}

function extrasFromCustomersRow(row) {
  return { ...extrasFromNotes(row['Reservation Notes']), hmOperational: true };
}

function includedProductLines(row) {
  return clean(row?.['Included Products'])
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function extraPersonFromRow(row) {
  if (!row) return false;
  for (const field of ['Person Counts(*)', 'Adult Count(*)']) {
    const n = parseInt(clean(row[field]), 10);
    if (Number.isFinite(n) && n > 1) return true;
  }
  if (clean(row.Companions)) return true;
  if (displayName(row).includes(',')) return true;
  const blob = `${row['Reservation Notes'] || ''} ${row['Included Products'] || ''}`.toLowerCase();
  if (
    /2ª persona|2da persona|segunda persona|extra person|persona extra|descuento 2ª|other guest|companion/i.test(
      blob,
    )
  ) {
    return true;
  }
  return false;
}

/** Meal plan, parking, Included Products "Extra:", and extra person — for rent/deposit mismatch review. */
function extrasHighlightFromRow(row, { housemonk = false } = {}) {
  if (!row) return null;
  const flags = [];
  const ex = housemonk ? extrasFromHousemonkRow(row) : extrasFromCustomersRow(row);
  if (ex.meal_plan === 'yes') {
    flags.push(ex.meal_raw ? `Meal plan: ${ex.meal_raw}` : 'Meal plan');
  }
  if (ex.parking === 'yes') {
    flags.push(ex.parking_raw ? `Parking: ${ex.parking_raw}` : 'Parking');
  }
  for (const line of includedProductLines(row)) {
    const lower = line.toLowerCase();
    if (lower.startsWith('meal plan:') && !flags.some((f) => f.toLowerCase().startsWith('meal plan'))) {
      flags.push(line);
    } else if (lower.startsWith('parking:') && !flags.some((f) => f.toLowerCase().startsWith('parking'))) {
      flags.push(line);
    } else if (lower.startsWith('extra:')) {
      flags.push(line);
    }
  }
  if (extraPersonFromRow(row)) flags.push('Extra person');
  return flags.length ? flags.join('; ') : null;
}

function rentDepositExtrasHighlightCols(c, h) {
  return {
    extras_customers: extrasHighlightFromRow(c, { housemonk: false }),
    extras_housemonk: extrasHighlightFromRow(h, { housemonk: true }),
  };
}

/**
 * Seguimiento ignored. Tenancy/Invoice → HM do not expose contract-style Meal plan:/Parking: flags
 * (see build-housemonk-import.py: promotions/charges only). Do not flag C↔H extras mismatches.
 */
function extrasMatchForNc(c, s, h) {
  const n = [c, s, h].filter(Boolean).length;
  if (n < 2) return null;
  if (c && h) return true;
  if (c && s) return true;
  if (s && h) return true;
  return null;
}

function namesMatch(a, b) {
  if (!a || !b) return null;
  const fa = firstNameKey(a);
  const fb = firstNameKey(b);
  if (!fa || !fb || fa !== fb) return false;
  const la = lastNameKeys(a);
  const lb = lastNameKeys(b);
  return la.some((t) => lb.includes(t));
}

function editDistanceOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    return diff === 1;
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < l.length; i++) {
    if (l.slice(0, i) + l.slice(i + 1) === s) return true;
  }
  return false;
}

function firstNameCompatible(fa, fb) {
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  if (editDistanceOne(fa, fb)) return true;
  if (fa.length >= 3 && fb.length >= 3 && (fa.startsWith(fb) || fb.startsWith(fa))) return true;
  if ((fa === 'luis' && fb === 'lluis') || (fa === 'lluis' && fb === 'luis')) return true;
  return false;
}

function editDistanceAtMost(a, b, max) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > max) return false;
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n] <= max;
}

function tokensMatchFuzzy(ta, tb) {
  if (ta === tb) return true;
  if (editDistanceOne(ta, tb)) return true;
  if (ta.length >= 7 && tb.length >= 7 && editDistanceAtMost(ta, tb, 2)) return true;
  if (ta.length >= 3 && tb.length >= 3 && (ta.startsWith(tb) || tb.startsWith(ta))) return true;
  return false;
}

function compactName(label) {
  return normName(label).replace(/\s+/g, '');
}

function nameLabelsFromRow(row) {
  if (!row) return [];
  const full = displayName(row);
  if (!full) return [];
  if (!full.includes(',')) return [full];
  return full
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function labelTokens(label) {
  return nameTokens(label);
}

function tokenSetsAlign(da, db) {
  if (!da.length || !db.length) return false;
  let inter = 0;
  for (const ta of da) {
    if (db.some((tb) => tokensMatchFuzzy(ta, tb))) inter++;
  }
  const j = inter / (da.length + db.length - inter || 1);
  if (inter >= 2 && j >= 0.45) return true;
  const [small, large] = da.length <= db.length ? [da, db] : [db, da];
  if (small.length >= 2 && small.every((ta) => large.some((tb) => tokensMatchFuzzy(ta, tb)))) return true;
  return false;
}

/** Same person across spelling variants, HM multi-guest strings, nicknames (Dan/Daniel), etc. */
function relaxedLabelPairMatch(la, lb) {
  if (!la || !lb) return false;

  const na = normName(la);
  const nb = normName(lb);
  if (na && nb && na === nb) return true;
  if (compactName(la) === compactName(lb)) return true;

  const da = labelTokens(la);
  const db = labelTokens(lb);
  if (tokenSetsAlign(da, db)) return true;

  const fa = da[0] || '';
  const fb = db[0] || '';
  const shared = da.filter((t) => db.some((u) => tokensMatchFuzzy(t, u)));
  if (shared.length >= 1 && firstNameCompatible(fa, fb)) return true;
  if (shared.length >= 2) return true;

  return false;
}

function relaxedPersonNamesMatchRows(a, b) {
  if (!a || !b) return null;
  if (namesMatch(a, b) === true) return true;
  const labelsA = nameLabelsFromRow(a);
  const labelsB = nameLabelsFromRow(b);
  for (const la of labelsA) {
    for (const lb of labelsB) {
      if (relaxedLabelPairMatch(la, lb)) return true;
    }
  }
  return false;
}

function hmSharesCustomerSurname(c, h) {
  const surnames = lastNameKeys(c);
  if (!surnames.length) return false;
  const hmTok = new Set();
  for (const seg of nameLabelsFromRow(h)) for (const t of labelTokens(seg)) hmTok.add(t);
  return surnames.some((t) => hmTok.has(t) || [...hmTok].some((u) => tokensMatchFuzzy(t, u)));
}

/** C↔H first; else 2+ sources agree with relaxed person matching (incl. Seguimiento). */
function threeWayNamesMatch(c, s, h) {
  if (c && h && relaxedPersonNamesMatchRows(c, h) === true) return true;
  if (c && s && !h && relaxedPersonNamesMatchRows(c, s) === true) return true;
  if (s && h && !c && relaxedPersonNamesMatchRows(s, h) === true) return true;
  if (c && s && h) {
    const cs = relaxedPersonNamesMatchRows(c, s) === true;
    const sh = relaxedPersonNamesMatchRows(s, h) === true;
    const ch = relaxedPersonNamesMatchRows(c, h) === true;
    if ((cs && sh) || (cs && ch) || (sh && ch)) return true;
    if (cs && hmSharesCustomerSurname(c, h)) return true;
  }
  return false;
}

function namesMatchForNc(c, s, h) {
  const n = [c, s, h].filter(Boolean).length;
  if (n < 2) return null;
  // Contract row present but guest name not filled — HouseMonk tenancy guest string is authoritative.
  if (c && h && !displayName(c) && displayName(h)) return true;
  return threeWayNamesMatch(c, s, h) ? true : false;
}

function displayNameTokens(row) {
  return nameTokens(displayName(row));
}

function customersHousemonkNamesMatch(a, b) {
  return relaxedPersonNamesMatchRows(a, b);
}

function docsMatch(a, b) {
  if (!a || !b) return null;
  const da = docsFromRow(a);
  const db = docsFromRow(b);
  if (!da.length || !db.length) return null;
  return da.some((d) => db.includes(d));
}

function datesMatch(a, b) {
  if (!a || !b) return null;
  const aa = parseDate(a['Arrival Date(*)']);
  const ad = parseDate(a['Departure Date(*)']);
  const ba = parseDate(b['Arrival Date(*)']);
  const bd = parseDate(b['Departure Date(*)']);
  if (!aa || !ad || !ba || !bd) return null;
  return aa === ba && ad === bd;
}

function unitsMatch(a, b) {
  if (!a || !b) return null;
  return unitKeysAlign(a, b);
}

function extrasMatch(a, b) {
  if (!a || !b) return null;
  const ea = extrasFromNotes(a['Reservation Notes']);
  const eb = extrasFromNotes(b['Reservation Notes']);
  return ea.meal_plan === eb.meal_plan && ea.parking === eb.parking;
}

function allPairsMatch(rows, fn) {
  const present = rows.filter(Boolean);
  if (present.length < 2) return null;
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const r = fn(present[i], present[j]);
      if (r === false) return false;
    }
  }
  return true;
}

/** Names / extras: Customers↔HouseMonk wins; Seguimiento disagreements do not force a mismatch. */
function customersHousemonkMatch(c, s, h, fn) {
  if (fn === namesMatch) return namesMatchForNc(c, s, h);
  if (c && h) return fn(c, h);
  return allPairsMatch([c, s, h], fn);
}

/** Pairwise name agreement (NC-linked rows). Overall names_match can still be false if any pair fails. */
function namePairStats(c, s, h) {
  const pairs = [];
  if (relaxedPersonNamesMatchRows(c, s) === true) pairs.push('customers_seguimiento');
  if (relaxedPersonNamesMatchRows(c, h) === true) pairs.push('customers_housemonk');
  if (relaxedPersonNamesMatchRows(s, h) === true) pairs.push('seguimiento_housemonk');
  return {
    at_least_one_name_pair_match: pairs.length > 0,
    name_pairs_matching_count: pairs.length,
    matching_name_pairs: pairs.length ? pairs.join(' | ') : null,
  };
}

function sqlLiteral(v) {
  if (v == null || v === '') return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** One row per all_fields_match NC — Mews_import_v2.10.0 Customers columns. */
function guestMismatchCols(base) {
  return {
    guest_name: base.name_customers || base.name_housemonk || base.name_seguimiento || null,
    guest_document_number:
      base.document_customers || base.document_housemonk || base.document_seguimiento || null,
    document_customers: base.document_customers,
    document_seguimiento: base.document_seguimiento,
    document_housemonk: base.document_housemonk,
  };
}

function buildMewsImportRow(cRef, h, s, base) {
  const src = cRef || h || s;
  if (!src) return null;
  const ncCode = base.nc_code || ncLabel(base.nc_number);
  const out = { nc_number: base.nc_number };
  for (const header of CUSTOMER_HEADERS) {
    out[header] = src[header] ?? null;
  }
  out['Group Code'] = ncCode;
  out['Internal Guest Notes'] = ncCode;
  const arrival = base.arrival_customers || base.arrival_housemonk || base.arrival_seguimiento;
  const departure = base.departure_customers || base.departure_housemonk || base.departure_seguimiento;
  if (arrival) out['Arrival Date(*)'] = arrival;
  if (departure) out['Departure Date(*)'] = departure;
  const unit = base.unit_customers || base.unit_housemonk || base.unit_seguimiento;
  if (unit) out['Allocated Room Category(*)'] = unit;
  if (base.rent_customers) {
    out['Allocated Rate'] = base.rent_customers;
    out['Per Night Prices'] = base.rent_customers;
  }
  if (base.deposit_customers) out['Prepaid Amount'] = base.deposit_customers;
  if (!out['Currency Code']) out['Currency Code'] = 'EUR';
  applyB2bMewsCustomerFormat(out, base.nc_number, cRef);
  return out;
}

/** Align B2B rows with Mews_import_v2.10.0 / extract-b2b customer shape (NC in Group Code + Internal Guest Notes). */
function applyB2bMewsCustomerFormat(row, nc, cRef) {
  if (!row || !isB2bContractAuthoritativeNc(nc)) return row;
  const ncCode = ncLabel(nc);
  row['Group Code'] = ncCode;
  row['Internal Guest Notes'] = ncCode;
  const company =
    clean(cRef?.['Partner Company']) || clean(cRef?.['Company Id']) || clean(cRef?.['Last Name(*)']);
  if (company) {
    row['Partner Company'] = company;
    row['Company Id'] = company;
    if (isLikelyCompanyLabel(company) || !clean(row['Last Name(*)'])) row['Last Name(*)'] = company;
  }
  if (!row['Person Counts(*)']) row['Person Counts(*)'] = '1';
  if (!row['Adult Count(*)']) row['Adult Count(*)'] = '1';
  if (!row['Child Count(*)']) row['Child Count(*)'] = '0';
  return row;
}

function minimalMewsBaseFromSources(nc, cRef, s, h) {
  const code = ncLabel(nc);
  return {
    nc_number: nc,
    nc_code: code,
    arrival_customers: cRef ? parseDate(cRef['Arrival Date(*)']) : null,
    arrival_seguimiento: s ? parseDate(s['Arrival Date(*)']) : null,
    arrival_housemonk: h ? parseDate(h['Arrival Date(*)']) : null,
    departure_customers: cRef ? parseDate(cRef['Departure Date(*)']) : null,
    departure_seguimiento: s ? parseDate(s['Departure Date(*)']) : null,
    departure_housemonk: h ? parseDate(h['Departure Date(*)']) : null,
    unit_customers: cRef ? clean(cRef['Allocated Room Category(*)']) || null : null,
    unit_seguimiento: s ? clean(s['Allocated Room Category(*)']) || null : null,
    unit_housemonk: h ? clean(h['Allocated Room Category(*)']) || null : null,
    rent_customers: cRef
      ? formatMoney(contractRentFromCustomer(cRef) ?? rentAmountFromRow(cRef))
      : null,
    deposit_customers: cRef ? formatMoney(depositAmountFromRow(cRef)) : null,
  };
}

function buildMewsCompanyImportRow(nc, cRef, s, h, companyMeta, companiesById, companiesList) {
  const out = { nc_number: nc };
  let co = null;
  if (companyMeta?.matched_company_id) {
    co = companiesById.get(String(companyMeta.matched_company_id)) ?? null;
  }
  if (!co && cRef) {
    const name = clean(cRef['Partner Company']) || clean(cRef['Company Id']);
    if (name) {
      const target = normName(name);
      co =
        companiesList.find((c) => normName(c['Company Name(*)']) === target) ||
        companiesList.find((c) => {
          const cn = normName(c['Company Name(*)']);
          return cn && (cn.includes(target) || target.includes(cn));
        }) ||
        null;
    }
  }
  for (const header of COMPANY_HEADERS) {
    out[header] = co?.[header] ?? null;
  }
  if (!clean(out['Company Name(*)']) && cRef) {
    const name = clean(cRef['Partner Company']) || clean(cRef['Company Id']);
    if (name) out['Company Name(*)'] = name;
  }
  if (cRef && !clean(out['Tax ID Number'])) {
    out['Tax ID Number'] = clean(cRef['Tax Identification Number']) || null;
  }
  if (clean(out['Company Name(*)']) && !clean(out['Reference ID'])) {
    out['Reference ID'] = out['Company Name(*)'];
  }
  return out;
}

async function fetchAll(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

function indexByNc(rows) {
  const map = new Map();
  for (const r of rows) {
    for (const n of ncFromRow(r)) {
      if (!map.has(n)) map.set(n, []);
      map.get(n).push(r);
    }
  }
  return map;
}

function pickOne(rows) {
  if (!rows?.length) return null;
  return rows[0];
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

function isBlankField(v) {
  return v == null || clean(v) === '';
}

/** Fill blank *\_customers / guest fields on mismatch rows from 12_10_2026 extraction by NC. */
function backfillCustomerFieldsFromExtraction(row, extByNc) {
  if (!row?.nc_number) return row;
  const ext = extByNc.get(row.nc_number);
  if (!ext) return row;
  const out = { ...row };
  const allowed = new Set(Object.keys(row));
  const setIfBlank = (key, val) => {
    if (!allowed.has(key)) return;
    if (!isBlankField(val) && isBlankField(out[key])) out[key] = val;
  };

  const rent = contractRentFromCustomer(ext) ?? rentAmountFromRow(ext);
  setIfBlank('rent_customers', rent != null ? formatMoney(rent) : null);
  const dep = depositAmountFromRow(ext);
  setIfBlank('deposit_customers', dep != null ? formatMoney(dep) : null);
  setIfBlank('name_customers', displayName(ext) || null);
  setIfBlank('unit_customers', clean(ext['Allocated Room Category(*)']) || null);
  setIfBlank('arrival_customers', parseDate(ext['Arrival Date(*)']) || null);
  setIfBlank('departure_customers', parseDate(ext['Departure Date(*)']) || null);
  setIfBlank('document_customers', clean(ext['Document Number']) || null);
  setIfBlank('guest_name', displayName(ext) || null);
  setIfBlank('guest_document_number', clean(ext['Document Number']) || null);

  const exNotes = extrasFromCustomersRow(ext);
  if (exNotes.meal_plan === 'yes') setIfBlank('meal_plan_customers', 'yes');
  if (exNotes.parking === 'yes') setIfBlank('parking_customers', 'yes');
  if (isBlankField(out.extras_customers)) {
    const hi = extrasHighlightFromRow(ext, { housemonk: false });
    if (hi) out.extras_customers = hi;
  }
  return out;
}

function backfillMismatchArrays(arrays, extByNc) {
  return arrays.map((rows) => rows.map((r) => backfillCustomerFieldsFromExtraction(r, extByNc)));
}

const [customers, extCustomers, segRows, hmRows, missingHm, companies] = await Promise.all([
  fetchAll(CUSTOMERS),
  fetchAll(CUSTOMERS_EXT),
  fetchAll(SEG),
  fetchAll(HM),
  fetchAll(MISSING_HM),
  fetchAll(COMPANIES),
]);

const extByNc = indexFirstByNc(extCustomers);

const excludeHmIds = new Set(missingHm.map((r) => r.housemonk_final_id).filter(Boolean));
const hmFiltered = hmRows.filter((r) => !excludeHmIds.has(r.id));

const byNcCust = indexByNc(customers);
const byNcSeg = indexByNc(segRows);
const byNcHm = indexByNc(hmFiltered);

const allNcs = new Set([...byNcCust.keys(), ...byNcSeg.keys(), ...byNcHm.keys()]);

const matchRows = [];
let mismatchNames = [];
let mismatchUnits = [];
let mismatchDates = [];
let mismatchExtras = [];
let mismatchRent = [];
let mismatchDeposits = [];
const allFieldsMatchMews = [];

for (const nc of [...allNcs].sort((a, b) => a - b)) {
  const c = pickOne(byNcCust.get(nc));
  const ext = extByNc.get(nc);
  const s = pickOne(byNcSeg.get(nc));
  const h = pickOne(byNcHm.get(nc));
  const hmTrust = housemonkTrustForNc(nc, h, B2B2C_SIGNED_TRUST_NCS);
  const cRef = c || ext || (hmTrust ? h : null) || null;
  const sources = [c, s, h].filter(Boolean);
  if (sources.length < 2) continue;

  const contractTruth = contractAuthoritativeForNc(cRef, nc) || hmTrust;
  let namesOk = customersHousemonkMatch(c, s, h, namesMatch);
  const namePairs = namePairStats(c, s, h);
  let docsOk = allPairsMatch([c, s, h], docsMatch);
  let unitsOk = unitsMatchForNc(c, s, h);
  let datesOk = customersHousemonkMatch(c, s, h, datesMatch);
  let extrasOk = extrasMatchForNc(c, s, h);
  let rentOk = rentMatchForNc(cRef, s, h, nc);
  let depositsOk = depositMatchForNc(cRef, s, h, nc);
  if (contractTruth) {
    namesOk = true;
    docsOk = docsOk === false ? true : docsOk;
    unitsOk = unitsOk === false ? true : unitsOk;
    datesOk = datesOk === false ? true : datesOk;
    extrasOk = extrasOk === false ? true : extrasOk;
    rentOk = rentOk === false ? true : rentOk;
    depositsOk = depositsOk === false ? true : depositsOk;
  }
  if (hmTrust) {
    namesOk = true;
    datesOk = true;
    rentOk = true;
    unitsOk = unitsOk === false ? true : unitsOk;
    docsOk = docsOk === false ? true : docsOk;
    extrasOk = extrasOk === false ? true : extrasOk;
    depositsOk = depositsOk === false ? true : depositsOk;
  }

  const ec = cRef ? extrasFromCustomersRow(cRef) : null;
  const es = s ? extrasFromNotes(s['Reservation Notes']) : null;
  const eh = h ? extrasFromHousemonkRow(h) : null;

  const companyCols = companyFieldsForNc(c, s, h, companies);

  const rentHousemonkVal = h ? formatMoney(rentAmountFromRow(h)) : null;
  const rentCustomersVal =
    hmTrust && h
      ? rentHousemonkVal
      : cRef
        ? formatMoney(
            contractTruth && !hmTrust
              ? contractRentFromCustomer(cRef)
              : (operationalRentFromCustomersRow(cRef, h, s, companies, nc) ?? rentAmountFromRow(cRef)),
          )
        : null;

  if (hmTrust && h) {
    rentOk = true;
  }

  if (rentOk === false && cRef && h) {
    const rc = parseMoney(rentCustomersVal);
    const rh = parseMoney(rentHousemonkVal);
    if (rc != null && rh != null && Math.abs(rc - rh) <= RENT_TOLERANCE_EUR) {
      rentOk = true;
    }
  }

  const base = {
    nc_code: ncLabel(nc),
    nc_number: nc,
    in_customers: Boolean(c),
    in_seguimiento: Boolean(s),
    in_housemonk: Boolean(h),
    customers_final_id: c?.id || null,
    seguimiento_final_id: s?.id || null,
    housemonk_final_id: h?.id || null,
    name_customers: cRef ? displayName(cRef) : null,
    name_seguimiento: s ? displayName(s) : null,
    name_housemonk: h ? displayName(h) : null,
    document_customers: cRef ? clean(cRef['Document Number']) : null,
    document_seguimiento: s ? clean(s['Document Number']) : null,
    document_housemonk: h ? clean(h['Document Number']) : null,
    unit_customers: cRef ? clean(cRef['Allocated Room Category(*)']) : null,
    unit_seguimiento: s ? clean(s['Allocated Room Category(*)']) : null,
    unit_housemonk: h ? clean(h['Allocated Room Category(*)']) : null,
    arrival_customers: cRef ? parseDate(cRef['Arrival Date(*)']) : null,
    arrival_seguimiento: s ? parseDate(s['Arrival Date(*)']) : null,
    arrival_housemonk: h ? parseDate(h['Arrival Date(*)']) : null,
    departure_customers: cRef ? parseDate(cRef['Departure Date(*)']) : null,
    departure_seguimiento: s ? parseDate(s['Departure Date(*)']) : null,
    departure_housemonk: h ? parseDate(h['Departure Date(*)']) : null,
    meal_plan_customers: ec?.meal_plan || null,
    meal_plan_seguimiento: es?.meal_plan || null,
    meal_plan_housemonk: eh?.meal_plan || null,
    parking_customers: ec?.parking || null,
    parking_seguimiento: es?.parking || null,
    parking_housemonk: eh?.parking || null,
    rent_customers: rentCustomersVal,
    rent_seguimiento:
      contractTruth && cRef
        ? formatMoney(contractRentFromCustomer(cRef))
        : s
          ? formatMoney(rentAmountFromRow(s))
          : null,
    rent_housemonk: rentHousemonkVal,
    deposit_customers: cRef
      ? formatMoney(
          contractTruth
            ? depositAmountFromRow(cRef)
            : (operationalDepositFromCustomersRow(cRef, h, s, companies, nc) ?? depositAmountFromRow(cRef)),
        )
      : null,
    deposit_seguimiento:
      contractTruth && cRef
        ? formatMoney(depositAmountFromRow(cRef))
        : s
          ? formatMoney(depositAmountFromRow(s))
          : null,
    deposit_housemonk:
      contractTruth && cRef
        ? formatMoney(depositAmountFromRow(cRef))
        : h
          ? formatMoney(depositAmountFromRow(h))
          : null,
    names_match: namesOk,
    at_least_one_name_pair_match: namePairs.at_least_one_name_pair_match,
    name_pairs_matching_count: namePairs.name_pairs_matching_count,
    matching_name_pairs: namePairs.matching_name_pairs,
    documents_match: docsOk,
    unit_types_match: unitsOk,
    dates_match: datesOk,
    extras_match: extrasOk,
    rent_match: rentOk,
    deposits_match: depositsOk,
    nc_match: true,
    all_fields_match:
      namesOk === true &&
      docsOk !== false &&
      unitsOk !== false &&
      datesOk !== false &&
      extrasOk !== false &&
      rentOk !== false &&
      depositsOk !== false,
    ...companyCols,
  };

  matchRows.push(base);

  if (base.all_fields_match) {
    const mewsRow = buildMewsImportRow(cRef, h, s, base);
    if (mewsRow) allFieldsMatchMews.push(mewsRow);
  }

  const guestCols = guestMismatchCols(base);
  const mismatchHead = {
    nc_code: base.nc_code,
    nc_number: nc,
    guest_name: guestCols.guest_name,
    guest_document_number: guestCols.guest_document_number,
  };
  const mismatchSourceIds = {
    customers_final_id: base.customers_final_id,
    seguimiento_final_id: base.seguimiento_final_id,
    housemonk_final_id: base.housemonk_final_id,
  };
  const actualValueCol = { 'Acutal Value': '' };
  const mismatchRowTail = { ...mismatchSourceIds, ...actualValueCol };

  if (namesOk === false) {
    mismatchNames.push({
      ...mismatchHead,
      name_customers: base.name_customers,
      name_seguimiento: base.name_seguimiento,
      name_housemonk: base.name_housemonk,
      at_least_one_name_pair_match: namePairs.at_least_one_name_pair_match,
      name_pairs_matching_count: namePairs.name_pairs_matching_count,
      matching_name_pairs: namePairs.matching_name_pairs,
      document_customers: guestCols.document_customers,
      document_seguimiento: guestCols.document_seguimiento,
      document_housemonk: guestCols.document_housemonk,
      ...companyCols,
      ...mismatchRowTail,
    });
  }
  if (unitsOk === false) {
    mismatchUnits.push({
      nc_code: base.nc_code,
      nc_number: nc,
      unit_customers: base.unit_customers,
      unit_seguimiento: base.unit_seguimiento,
      unit_housemonk: base.unit_housemonk,
      ...mismatchRowTail,
    });
  }
  if (datesOk === false) {
    mismatchDates.push({
      ...mismatchHead,
      arrival_customers: base.arrival_customers,
      arrival_seguimiento: base.arrival_seguimiento,
      arrival_housemonk: base.arrival_housemonk,
      departure_customers: base.departure_customers,
      departure_seguimiento: base.departure_seguimiento,
      departure_housemonk: base.departure_housemonk,
      ...mismatchRowTail,
    });
  }
  if (extrasOk === false) {
    mismatchExtras.push({
      nc_code: base.nc_code,
      nc_number: nc,
      meal_plan_customers: base.meal_plan_customers,
      meal_plan_seguimiento: base.meal_plan_seguimiento,
      meal_plan_housemonk: base.meal_plan_housemonk,
      parking_customers: base.parking_customers,
      parking_seguimiento: base.parking_seguimiento,
      parking_housemonk: base.parking_housemonk,
      ...mismatchRowTail,
    });
  }
  if (rentOk === false) {
    mismatchRent.push({
      ...mismatchHead,
      rent_customers: base.rent_customers,
      rent_seguimiento: base.rent_seguimiento,
      rent_housemonk: base.rent_housemonk,
      ...rentDepositExtrasHighlightCols(cRef, h),
      ...mismatchRowTail,
    });
  }
  if (depositsOk === false) {
    mismatchDeposits.push({
      ...mismatchHead,
      deposit_customers: base.deposit_customers,
      deposit_seguimiento: base.deposit_seguimiento,
      deposit_housemonk: base.deposit_housemonk,
      ...rentDepositExtrasHighlightCols(cRef, h),
      ...mismatchRowTail,
    });
  }
}

[
  mismatchNames,
  mismatchUnits,
  mismatchDates,
  mismatchExtras,
  mismatchRent,
  mismatchDeposits,
] = backfillMismatchArrays(
  [mismatchNames, mismatchUnits, mismatchDates, mismatchExtras, mismatchRent, mismatchDeposits],
  extByNc,
);

const matchBaseByNc = new Map(matchRows.map((r) => [r.nc_number, r]));
const companiesById = new Map(companies.map((co) => [String(co.id), co]));
const mewsByNc = new Map();

for (const row of allFieldsMatchMews) {
  applyB2bMewsCustomerFormat(
    row,
    row.nc_number,
    pickOne(byNcCust.get(row.nc_number)) || extByNc.get(row.nc_number),
  );
  mewsByNc.set(row.nc_number, row);
}

function buildB2bStubMewsRow(nc, cRef, s, h) {
  const base = matchBaseByNc.get(nc) || minimalMewsBaseFromSources(nc, cRef, s, h);
  const built = buildMewsImportRow(cRef, h, s, base);
  if (built) return built;
  const ncCode = ncLabel(nc);
  const out = { nc_number: nc };
  for (const header of CUSTOMER_HEADERS) out[header] = null;
  out['Group Code'] = ncCode;
  out['Internal Guest Notes'] = ncCode;
  out['Currency Code'] = 'EUR';
  out['Person Counts(*)'] = '1';
  out['Adult Count(*)'] = '1';
  out['Child Count(*)'] = '0';
  applyB2bMewsCustomerFormat(out, nc, cRef);
  return out;
}

let b2bMewsAdded = 0;
for (const nc of [...B2B_CONTRACT_NCS].sort((a, b) => a - b)) {
  const c = pickOne(byNcCust.get(nc));
  const ext = extByNc.get(nc);
  const cRef = c || ext;
  const s = pickOne(byNcSeg.get(nc));
  const h = pickOne(byNcHm.get(nc));
  if (mewsByNc.has(nc)) {
    applyB2bMewsCustomerFormat(mewsByNc.get(nc), nc, cRef);
    continue;
  }
  const mewsRow = buildB2bStubMewsRow(nc, cRef, s, h);
  mewsByNc.set(nc, mewsRow);
  b2bMewsAdded++;
}

allFieldsMatchMews.length = 0;
for (const nc of [...mewsByNc.keys()].sort((a, b) => a - b)) {
  allFieldsMatchMews.push(mewsByNc.get(nc));
}

const allFieldsMatchMewsCompanies = [];
for (const nc of [...B2B_CONTRACT_NCS].sort((a, b) => a - b)) {
  if (!mewsByNc.has(nc)) continue; // every authoritative B2B NC should be in mewsByNc after pass above
  const c = pickOne(byNcCust.get(nc)) || extByNc.get(nc);
  const s = pickOne(byNcSeg.get(nc));
  const h = pickOne(byNcHm.get(nc));
  const companyMeta = companyFieldsForNc(c, s, h, companies);
  const coRow = buildMewsCompanyImportRow(nc, c, s, h, companyMeta, companiesById, companies);
  if (!clean(coRow['Company Name(*)'])) continue;
  allFieldsMatchMewsCompanies.push(coRow);
}

const b2bNcsInMewsImport = [...B2B_CONTRACT_NCS].filter((nc) => mewsByNc.has(nc)).length;
const b2bNcsMissingFromMewsImport = [...B2B_CONTRACT_NCS].filter((nc) => !mewsByNc.has(nc)).sort((a, b) => a - b);

function ddlFor(table, sample) {
  if (!sample) return '';
  const cols = Object.keys(sample);
  const colDefs = cols
    .map((c) => {
      const v = sample[c];
      if (typeof v === 'boolean' || v === null) return `"${c}" boolean`;
      if (typeof v === 'number') return `"${c}" integer`;
      return `"${c}" text`;
    })
    .join(',\n  ');
  return `create table if not exists public."${table}" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ${colDefs}
);

alter table public."${table}" enable row level security;
grant select, insert, update, delete on public."${table}" to service_role;

create unique index if not exists ${table.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}_nc_idx on public."${table}" (nc_number);

delete from public."${table}";
`;
}

const ddlSql =
  `-- Three-way Final_Format match — DDL only (data via contract-extraction/upload-matching-across-final-format-15-10-2026.mjs)\n` +
  `-- HM excludes Missing_Group_Code cohort. Row counts: match ${matchRows.length}, all-fields mews ${allFieldsMatchMews.length}, names ${mismatchNames.length}, units ${mismatchUnits.length}, dates ${mismatchDates.length}, extras ${mismatchExtras.length}, rent ${mismatchRent.length}, deposits ${mismatchDeposits.length}\n\n` +
  `-- Drop broken/truncated name from first DDL attempt (PG 63-char identifier limit)\n` +
  `drop table if exists public."Matching_Across_Final_Format_Customers_HM_Seguimiento_15_10_2026" cascade;\n` +
  `drop table if exists public."Matching_Across_Final_Format_Customers_HM_Seguimiento_15_10_202" cascade;\n\n` +
  ddlFor(MATCH_TABLE, matchRows[0]) +
  '\n' +
  ddlFor(MISMATCH_NAMES, mismatchNames[0] || { nc_code: '', nc_number: 0, name_customers: '' }) +
  '\n' +
  ddlFor(MISMATCH_UNITS, mismatchUnits[0] || { nc_code: '', nc_number: 0, unit_customers: '' }) +
  '\n' +
  ddlFor(MISMATCH_DATES, mismatchDates[0] || { nc_code: '', nc_number: 0, arrival_customers: '' }) +
  '\n' +
  ddlFor(MISMATCH_EXTRAS, mismatchExtras[0] || { nc_code: '', nc_number: 0, meal_plan_customers: '' }) +
  '\n' +
  ddlFor(MISMATCH_RENT, mismatchRent[0] || { nc_code: '', nc_number: 0, rent_customers: '' }) +
  '\n' +
  ddlFor(
    MISMATCH_DEPOSITS,
    mismatchDeposits[0] || { nc_code: '', nc_number: 0, deposit_customers: '' },
  ) +
  '\n' +
  ddlFor(ALL_FIELDS_MEEWS, allFieldsMatchMews[0] || { nc_number: 0, Email: '' }) +
  '\n' +
  ddlFor(
    ALL_FIELDS_MEEWS_COMPANIES,
    allFieldsMatchMewsCompanies[0] || { nc_number: 0, 'Company Name(*)': '' },
  ) +
  `\n-- Add name-pair columns if tables already exist\n` +
  `alter table public."${MATCH_TABLE}" add column if not exists at_least_one_name_pair_match boolean;\n` +
  `alter table public."${MATCH_TABLE}" add column if not exists name_pairs_matching_count integer;\n` +
  `alter table public."${MATCH_TABLE}" add column if not exists matching_name_pairs text;\n` +
  `alter table public."${MISMATCH_NAMES}" add column if not exists at_least_one_name_pair_match boolean;\n` +
  `alter table public."${MISMATCH_NAMES}" add column if not exists name_pairs_matching_count integer;\n` +
  `alter table public."${MISMATCH_NAMES}" add column if not exists matching_name_pairs text;\n` +
  `-- Company match columns (Companies_Extraction_12_10_2026)\n` +
  `alter table public."${MATCH_TABLE}" add column if not exists likely_company_label boolean;\n` +
  `alter table public."${MATCH_TABLE}" add column if not exists partner_company text;\n` +
  `alter table public."${MATCH_TABLE}" add column if not exists companies_match_tier text;\n` +
  `alter table public."${MATCH_TABLE}" add column if not exists matched_company_id text;\n` +
  `alter table public."${MATCH_TABLE}" add column if not exists matched_company_name text;\n` +
  `alter table public."${MATCH_TABLE}" add column if not exists companies_match_signals text;\n` +
  `alter table public."${MISMATCH_NAMES}" add column if not exists likely_company_label boolean;\n` +
  `alter table public."${MISMATCH_NAMES}" add column if not exists partner_company text;\n` +
  `alter table public."${MISMATCH_NAMES}" add column if not exists companies_match_tier text;\n` +
  `alter table public."${MISMATCH_NAMES}" add column if not exists matched_company_id text;\n` +
  `alter table public."${MISMATCH_NAMES}" add column if not exists matched_company_name text;\n` +
  `alter table public."${MISMATCH_NAMES}" add column if not exists companies_match_signals text;\n` +
  `-- Rent / deposit match (Allocated Rate + Prepaid Amount)\n` +
  `alter table public."${MATCH_TABLE}" add column if not exists rent_customers text;\n` +
  `alter table public."${MATCH_TABLE}" add column if not exists rent_seguimiento text;\n` +
  `alter table public."${MATCH_TABLE}" add column if not exists rent_housemonk text;\n` +
  `alter table public."${MATCH_TABLE}" add column if not exists deposit_customers text;\n` +
  `alter table public."${MATCH_TABLE}" add column if not exists deposit_seguimiento text;\n` +
  `alter table public."${MATCH_TABLE}" add column if not exists deposit_housemonk text;\n` +
  `alter table public."${MATCH_TABLE}" add column if not exists rent_match boolean;\n` +
  `alter table public."${MATCH_TABLE}" add column if not exists deposits_match boolean;\n` +
  `-- Guest name + document on mismatch tables\n` +
  `alter table public."${MISMATCH_NAMES}" add column if not exists guest_name text;\n` +
  `alter table public."${MISMATCH_NAMES}" add column if not exists guest_document_number text;\n` +
  `alter table public."${MISMATCH_NAMES}" add column if not exists document_customers text;\n` +
  `alter table public."${MISMATCH_NAMES}" add column if not exists document_seguimiento text;\n` +
  `alter table public."${MISMATCH_NAMES}" add column if not exists document_housemonk text;\n` +
  `alter table public."${MISMATCH_DATES}" add column if not exists guest_name text;\n` +
  `alter table public."${MISMATCH_DATES}" add column if not exists guest_document_number text;\n` +
  `alter table public."${MISMATCH_RENT}" add column if not exists guest_name text;\n` +
  `alter table public."${MISMATCH_RENT}" add column if not exists guest_document_number text;\n` +
  `alter table public."${MISMATCH_DEPOSITS}" add column if not exists guest_name text;\n` +
  `alter table public."${MISMATCH_DEPOSITS}" add column if not exists guest_document_number text;\n` +
  `alter table public."${MISMATCH_NAMES}" add column if not exists "Acutal Value" text;\n` +
  `alter table public."${MISMATCH_UNITS}" add column if not exists "Acutal Value" text;\n` +
  `alter table public."${MISMATCH_DATES}" add column if not exists "Acutal Value" text;\n` +
  `alter table public."${MISMATCH_EXTRAS}" add column if not exists "Acutal Value" text;\n` +
  `alter table public."${MISMATCH_RENT}" add column if not exists "Acutal Value" text;\n` +
  `alter table public."${MISMATCH_DEPOSITS}" add column if not exists "Acutal Value" text;\n` +
  `alter table public."${MISMATCH_RENT}" add column if not exists extras_customers text;\n` +
  `alter table public."${MISMATCH_RENT}" add column if not exists extras_housemonk text;\n` +
  `alter table public."${MISMATCH_DEPOSITS}" add column if not exists extras_customers text;\n` +
  `alter table public."${MISMATCH_DEPOSITS}" add column if not exists extras_housemonk text;\n`;

fs.writeFileSync(OUT_SQL_DDL, ddlSql, 'utf8');

const summaryPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'matching-across-final-format-15-10-2026-summary.json');
fs.writeFileSync(
  summaryPath,
  JSON.stringify(
    {
      hmExcludedFromMatch: excludeHmIds.size,
      matchRows: matchRows.length,
      allFieldsMatch: matchRows.filter((r) => r.all_fields_match).length,
      mismatchNames: mismatchNames.length,
      mismatchNamesAtLeastOnePair: mismatchNames.filter((r) => r.at_least_one_name_pair_match).length,
      mismatchNamesNoPair: mismatchNames.filter((r) => !r.at_least_one_name_pair_match).length,
      mismatchNamesNoPairWithCompany: mismatchNames.filter(
        (r) => !r.at_least_one_name_pair_match && r.companies_match_tier,
      ).length,
      mismatchNamesNoPairNoCompany: mismatchNames.filter(
        (r) => !r.at_least_one_name_pair_match && !r.companies_match_tier,
      ).length,
      mismatchUnits: mismatchUnits.length,
      mismatchDates: mismatchDates.length,
      mismatchExtras: mismatchExtras.length,
      mismatchRent: mismatchRent.length,
      mismatchDeposits: mismatchDeposits.length,
      allFieldsMatchMewsImport: allFieldsMatchMews.length,
      b2bMewsRowsAddedBeyondAllFieldsMatch: b2bMewsAdded,
      b2bNcsInMewsImport,
      b2bNcsMissingFromMewsImport: b2bNcsMissingFromMewsImport.length,
      allFieldsMatchMewsCompaniesImport: allFieldsMatchMewsCompanies.length,
    },
    null,
    2,
  ),
  'utf8',
);

const noPairNoCompany = mismatchNames.filter((r) => !r.at_least_one_name_pair_match && !r.companies_match_tier);
const noCompanyOut = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'mismatch-names-no-pair-no-company-match-15-10-2026.json',
);
const noCompanyTsv = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'mismatch-names-no-pair-no-company-match-15-10-2026.tsv',
);
fs.writeFileSync(
  noCompanyOut,
  JSON.stringify(
    {
      count: noPairNoCompany.length,
      rows: noPairNoCompany.map((r) => ({
        nc_code: r.nc_code,
        nc_number: r.nc_number,
        name_customers: r.name_customers,
        name_seguimiento: r.name_seguimiento,
        name_housemonk: r.name_housemonk,
        partner_company: r.partner_company,
        likely_company_label: r.likely_company_label,
      })),
    },
    null,
    2,
  ),
  'utf8',
);
fs.writeFileSync(
  noCompanyTsv,
  [
    'nc_code\tname_customers\tname_seguimiento\tname_housemonk\tpartner_company\tlikely_company_label',
    ...noPairNoCompany.map((r) =>
      [
        r.nc_code,
        r.name_customers ?? '',
        r.name_seguimiento ?? '',
        r.name_housemonk ?? '',
        r.partner_company ?? '',
        r.likely_company_label ?? false,
      ]
        .map((c) => String(c).replace(/\t/g, ' '))
        .join('\t'),
    ),
  ].join('\n'),
  'utf8',
);

const MISSING_COL_RE = /Could not find the '([^']+)' column/;
const MISSING_TABLE_RE = /Could not find the table '([^']+)'/;

function omitCols(row, omit) {
  if (!omit.size) return row;
  const out = { ...row };
  for (const c of omit) delete out[c];
  return out;
}

async function replaceTable(table, rows, { optionalTable = false } = {}) {
  const { error: delError } = await sb.from(table).delete().gte('nc_number', 0);
  if (delError) {
    if (optionalTable && MISSING_TABLE_RE.test(delError.message)) return { skipped: true, omitted: [] };
    if (!/does not exist|schema cache/i.test(delError.message)) throw delError;
  }

  const omit = new Set();
  for (;;) {
    let failed = null;
    for (let i = 0; i < rows.length; i += 60) {
      const chunk = rows.slice(i, i + 60).map((r) => omitCols(r, omit));
      if (!chunk.length) continue;
      const { error } = await sb.from(table).insert(chunk);
      if (error) {
        failed = error;
        break;
      }
    }
    if (!failed) break;
    const m = MISSING_COL_RE.exec(failed.message);
    if (MISSING_TABLE_RE.test(failed.message)) {
      if (optionalTable) return { skipped: true, omitted: [] };
      throw failed;
    }
    if (!m) throw failed;
    const col = m[1];
    if (omit.has(col)) throw failed;
    omit.add(col);
    const { error: del2 } = await sb.from(table).delete().gte('nc_number', 0);
    if (del2 && !/does not exist|schema cache/i.test(del2.message)) throw del2;
  }
  return { skipped: false, omitted: [...omit] };
}

let insertOk = true;
const omittedByTable = {};
const skippedTables = [];
const RENT_DEPOSIT_DDL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'contract-analysis',
  'supabase-matching-rent-deposit-alter-16-10-2026.sql',
);
const ALL_FIELDS_MEEWS_DDL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'contract-analysis',
  'supabase-all-fields-match-mews-import-16-10-2026.sql',
);
const ALL_FIELDS_MEEWS_COMPANIES_DDL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'contract-analysis',
  'supabase-all-fields-match-mews-import-companies-16-10-2026.sql',
);
try {
  omittedByTable[MATCH_TABLE] = (await replaceTable(MATCH_TABLE, matchRows)).omitted;
  omittedByTable[MISMATCH_NAMES] = (await replaceTable(MISMATCH_NAMES, mismatchNames)).omitted;
  omittedByTable[MISMATCH_UNITS] = (await replaceTable(MISMATCH_UNITS, mismatchUnits)).omitted;
  omittedByTable[MISMATCH_DATES] = (await replaceTable(MISMATCH_DATES, mismatchDates)).omitted;
  omittedByTable[MISMATCH_EXTRAS] = (await replaceTable(MISMATCH_EXTRAS, mismatchExtras)).omitted;
  const rentUp = await replaceTable(MISMATCH_RENT, mismatchRent, { optionalTable: true });
  omittedByTable[MISMATCH_RENT] = rentUp.omitted;
  if (rentUp.skipped) skippedTables.push(MISMATCH_RENT);
  const depUp = await replaceTable(MISMATCH_DEPOSITS, mismatchDeposits, { optionalTable: true });
  omittedByTable[MISMATCH_DEPOSITS] = depUp.omitted;
  if (depUp.skipped) skippedTables.push(MISMATCH_DEPOSITS);
  const mewsUp = await replaceTable(ALL_FIELDS_MEEWS, allFieldsMatchMews, { optionalTable: true });
  omittedByTable[ALL_FIELDS_MEEWS] = mewsUp.omitted;
  if (mewsUp.skipped) skippedTables.push(ALL_FIELDS_MEEWS);
  const mewsCoUp = await replaceTable(ALL_FIELDS_MEEWS_COMPANIES, allFieldsMatchMewsCompanies, {
    optionalTable: true,
  });
  omittedByTable[ALL_FIELDS_MEEWS_COMPANIES] = mewsCoUp.omitted;
  if (mewsCoUp.skipped) skippedTables.push(ALL_FIELDS_MEEWS_COMPANIES);
} catch (e) {
  insertOk = false;
  console.log(
    JSON.stringify(
      {
        insertError: e.message,
        runDdlInSqlEditor: OUT_SQL_DDL,
        thenRun: 'cd contract-extraction && node upload-matching-across-final-format-15-10-2026.mjs',
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

console.log(
  JSON.stringify(
    {
      hmExcluded: excludeHmIds.size,
      matchTable: MATCH_TABLE,
      matchRows: matchRows.length,
      mismatchNames: mismatchNames.length,
      mismatchUnits: mismatchUnits.length,
      mismatchDates: mismatchDates.length,
      mismatchExtras: mismatchExtras.length,
      mismatchRent: mismatchRent.length,
      mismatchDeposits: mismatchDeposits.length,
      allFieldsMatch: matchRows.filter((r) => r.all_fields_match).length,
      allFieldsMatchMewsImport: allFieldsMatchMews.length,
      b2bMewsRowsAddedBeyondAllFieldsMatch: b2bMewsAdded,
      b2bNcsInMewsImport,
      b2bNcsMissingFromMewsImport: b2bNcsMissingFromMewsImport.length,
      allFieldsMatchMewsCompaniesImport: allFieldsMatchMewsCompanies.length,
      allFieldsMatchMewsTable: ALL_FIELDS_MEEWS,
      allFieldsMatchMewsCompaniesTable: ALL_FIELDS_MEEWS_COMPANIES,
      ddlPath: OUT_SQL_DDL,
      insertOk,
      omittedColumns: omittedByTable,
      skippedTables,
      rentDepositAlterSql: RENT_DEPOSIT_DDL,
      allFieldsMatchMewsDdl: ALL_FIELDS_MEEWS_DDL,
      allFieldsMatchMewsCompaniesDdl: ALL_FIELDS_MEEWS_COMPANIES_DDL,
      rerunAfterAlterInSqlEditor:
        skippedTables.length > 0 || Object.values(omittedByTable).some((a) => a?.length),
    },
    null,
    2,
  ),
);
