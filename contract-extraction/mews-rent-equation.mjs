/**
 * Build Allocated Rate cell: full monthly rent equation (discount + compulsory meal + 2nd person).
 * Example: 950_times_0.1_equals_855_plus_295_equals_1150
 */
import { discountPercentFromContractText } from './mews-product-map.mjs';

export function parseMoneyAmount(raw) {
  if (raw == null || raw === '' || raw === 'unknown') return null;
  const s = String(raw).replace(/\s/g, '').replace(',', '.');
  const m = s.match(/-?\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(n) {
  if (n == null || !Number.isFinite(n)) return '0';
  if (Math.abs(n - Math.round(n)) < 0.005) return String(Math.round(n));
  return String(Math.round(n * 100) / 100);
}

function discountFractionLabel(discountPct) {
  if (discountPct == null) return null;
  const frac = discountPct / 100;
  if (Math.abs(frac - Math.round(frac * 10) / 10) < 0.0001) {
    return frac.toFixed(1);
  }
  return String(frac);
}

/** Infer 100 € segunda persona from B2C optional / included text when present. */
export function secondPersonSupplementFromParsed(parsed) {
  const blobs = [
    parsed?.optional_services_summary,
    parsed?.included_services_summary,
    parsed?.discount_text,
  ].filter(Boolean);
  for (const blob of blobs) {
    const t = String(blob);
    if (/segunda\s+persona|2\s*ª\s*persona|second\s+person/i.test(t) && /\b100\b/.test(t)) {
      return 100;
    }
  }
  return 0;
}

/**
 * @param {Record<string, unknown>} parsed B2C extractContract result
 * @returns {string|null}
 */
export function buildAllocatedRateEquation(parsed) {
  const afterDisc = parseMoneyAmount(parsed?.monthly_price_euros);
  const meal =
    parsed?.meal_plan_present && parseMoneyAmount(parsed?.meal_plan_monthly_price) > 0
      ? parseMoneyAmount(parsed?.meal_plan_monthly_price)
      : 0;
  const secondPerson = secondPersonSupplementFromParsed(parsed) || 0;

  const discountPct = discountPercentFromContractText(
    parsed?.discount_text,
    parsed?.optional_services_summary,
    parsed?.included_services_summary,
  );

  let base = afterDisc;
  if (discountPct != null && afterDisc != null) {
    base = Math.round((afterDisc / (1 - discountPct / 100)) * 100) / 100;
  }

  const core = afterDisc ?? base;
  if (core == null && meal === 0 && secondPerson === 0) return null;

  const total = (core ?? 0) + meal + secondPerson;

  if (discountPct != null && base != null && afterDisc != null) {
    const frac = discountFractionLabel(discountPct);
    let eq = `${fmtMoney(base)}_times_${frac}_equals_${fmtMoney(afterDisc)}`;
    if (meal > 0) eq += `_plus_${fmtMoney(meal)}`;
    if (secondPerson > 0) eq += `_plus_${fmtMoney(secondPerson)}`;
    eq += `_equals_${fmtMoney(total)}`;
    return eq;
  }

  const start = fmtMoney(base ?? afterDisc ?? total);
  if (meal > 0 || secondPerson > 0) {
    let eq = start;
    if (meal > 0) eq += `_plus_${fmtMoney(meal)}`;
    if (secondPerson > 0) eq += `_plus_${fmtMoney(secondPerson)}`;
    eq += `_equals_${fmtMoney(total)}`;
    return eq;
  }

  return start;
}

/** Derive rent equation from existing Reservation Notes (no OpenAI). */
export function buildAllocatedRateFromCustomerRow(row) {
  const notes = String(row?.['Reservation Notes'] || '');
  if (!notes) return null;

  const monthly = parseMoneyAmount(notes.match(/Monthly price:\s*([\d.,]+)/i)?.[1]);
  const discountPct = discountPercentFromContractText(notes);
  let meal = 0;
  const mealPatterns = [
    /Pensión:\s*(\d+(?:[.,]\d+)?)\s*€/i,
    /(\d+(?:[.,]\d+)?)\s*€\/?\s*mes\s*media\s*pensi/i,
    /optional services:.*?Pensión:\s*(\d+(?:[.,]\d+)?)/i,
  ];
  for (const re of mealPatterns) {
    const m = notes.match(re);
    if (m) {
      meal = parseMoneyAmount(m[1]) || 0;
      if (meal > 0) break;
    }
  }

  const secondPerson = /segunda\s+persona|2\s*ª\s*persona/i.test(notes) && /\b100\b/.test(notes) ? 100 : 0;

  if (monthly == null && discountPct == null && meal === 0 && secondPerson === 0) return null;

  return buildAllocatedRateEquation({
    monthly_price_euros: monthly != null ? String(monthly) : null,
    discount_text: discountPct != null ? `Descuento del ${discountPct}%` : null,
    optional_services_summary: notes,
    meal_plan_present: meal > 0,
    meal_plan_monthly_price: meal > 0 ? String(meal) : null,
    second_person_supplement_euros: secondPerson ? '100' : null,
  });
}
