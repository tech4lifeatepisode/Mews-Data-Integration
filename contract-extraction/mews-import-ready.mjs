import { clean } from './room-number-to-category.mjs';
import { monthlyRentFromRow } from './mews-stay-rate-and-products-format.mjs';

const RATE_NAME_RE = /(?:Short|Mid|Long)-Term Stays/i;
const MONTHLY_AUDIT_RE = /Mews import audit — Monthly rent EUR:/i;

/** Mews prepayment type label (import). */
export const MEWS_PREPAYMENT_TYPE_DEPOSIT = 'Deposit';

/** Mews import: Person Counts(*) = age category names, not headcount — use Adult/Child Count only. */
export function appendMewsImportAuditReservationNotes(row) {
  const monthly = row.__mewsMonthlyEur ?? monthlyRentFromRow(row);
  delete row.__mewsMonthlyEur;
  const rate = clean(row['Allocated Rate']);
  const notes = clean(row['Reservation Notes']);
  if (!monthly || MONTHLY_AUDIT_RE.test(notes)) return row;

  const audit = `Mews import audit — Monthly rent EUR: ${monthly}; Per Night Prices left empty; Exact rate: ${rate || 'n/a'}`;
  row['Reservation Notes'] = notes ? `${notes} | ${audit}` : audit;
  return row;
}

/** Mews maps Companions → AdditionalCustomerIds; values must be existing Mews customer IDs, not names. */
export function stashCompanionsInReservationNotes(row) {
  const companions = clean(row.Companions);
  if (!companions) return row;
  const notes = clean(row['Reservation Notes']);
  const tag = `Companion(s) (not imported - add in Mews or re-import with customer ID): ${companions}`;
  if (!notes.includes(companions)) {
    row['Reservation Notes'] = notes ? `${notes} | ${tag}` : tag;
  }
  row.Companions = null;
  return row;
}

export function applyMewsImportReadyFields(row) {
  stashCompanionsInReservationNotes(row);
  appendMewsImportAuditReservationNotes(row);

  row['Person Counts(*)'] = null;

  if (RATE_NAME_RE.test(clean(row['Allocated Rate']))) {
    row['Per Night Prices'] = null;
  }

  const prepaid = clean(row['Prepaid Amount']);
  if (prepaid && /\d/.test(prepaid)) {
    if (!clean(row['Prepayment Type'])) {
      row['Prepayment Type'] = MEWS_PREPAYMENT_TYPE_DEPOSIT;
    }
  } else {
    row['Prepaid Amount'] = null;
    row['Prepayment Type'] = null;
  }

  row['Arrival Time'] = null;
  row['Departure Time'] = null;

  row.Source = null;
  row['Business Segment'] = null;

  return row;
}
