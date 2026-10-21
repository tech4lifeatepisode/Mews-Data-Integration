import { clean } from './room-number-to-category.mjs';

/** Mews closed rate group names (Exact rate). */
export const RATE_SHORT_TERM = 'Short-Term Stays';
export const RATE_MID_TERM = 'Mid-Term Stays';
export const RATE_LONG_TERM = 'Long-Term Stays';

const RATE_NAME_RE = /(?:Short|Mid|Long)-Term Stays/i;

function parseIsoDateField(val) {
  const c = clean(val);
  const m = c?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Whole-day stay length for Mews rate group selection. */
export function stayLengthDays(row) {
  const arr = parseIsoDateField(row?.['Arrival Date(*)']);
  const dep = parseIsoDateField(row?.['Departure Date(*)']);
  if (arr == null || dep == null || dep < arr) return null;
  return Math.round((dep - arr) / 86400000);
}

/**
 * Closed rate groups (Episode Carabanchel):
 * Short 1M–3M | Mid 3M1D–9M | Long 9M1D–11M28D (longer stays → Long).
 */
export function mewsExactRateNameForStayDays(days) {
  if (days == null) return RATE_LONG_TERM;
  const threeMonthsDays = 92;
  const threeMonthsOneDay = 93;
  const nineMonthsDays = 275;
  const nineMonthsOneDay = 276;
  if (days <= threeMonthsDays) return RATE_SHORT_TERM;
  if (days <= nineMonthsDays) return RATE_MID_TERM;
  return RATE_LONG_TERM;
}

function parseMoneyField(val) {
  const c = clean(val);
  if (!c || c === '/' || c === '-') return null;
  if (RATE_NAME_RE.test(c)) return null;
  const m = c.replace(/\s/g, '').replace(',', '.').match(/^(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return Number.isInteger(n) ? String(n) : String(n);
}

export function monthlyRentFromRow(row) {
  const fromFields = parseMoneyField(row?.['Allocated Rate']) ?? parseMoneyField(row?.['Per Night Prices']);
  if (fromFields) return fromFields;
  const notes = clean(row?.['Reservation Notes']);
  const m = notes.match(/Monthly price:\s*([\d.,]+)/i);
  if (m) return parseMoneyField(m[1]);
  return null;
}

/** ESSENTIAL 20+20 → ESSENTIAL 20 + 20 (and ALL IN / FLOW). */
export function formatIncludedProductsPlusSpacing(products) {
  const c = clean(products);
  if (!c) return products ?? null;
  return c
    .split(';')
    .map((part) =>
      part
        .trim()
        .replace(/(\d+)\+(\d+)(?:\+(\d+))?/g, (_, a, b, c2) => (c2 ? `${a} + ${b} + ${c2}` : `${a} + ${b}`)),
    )
    .join('; ');
}

/**
 * Allocated Rate ← exact stay rate group name. (Per Night Prices stays empty for Mews import with closed rates.)
 */
export function applyMewsStayRateAndMonthlyPricing(row) {
  const monthly = monthlyRentFromRow(row);
  if (monthly) row.__mewsMonthlyEur = monthly;
  const days = stayLengthDays(row);
  row['Per Night Prices'] = null;
  row['Allocated Rate'] = mewsExactRateNameForStayDays(days);
  if (clean(row['Included Products'])) {
    row['Included Products'] = formatIncludedProductsPlusSpacing(row['Included Products']);
  }
  return row;
}
