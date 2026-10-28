import { clean } from './room-number-to-category.mjs';
import { MEWS_PREPAYMENT_TYPE_DEPOSIT } from './mews-import-ready.mjs';

/** Per-unit deposit for Viajes Puerta de Sevilla SL block (29 units). */
export const PUERTA_DE_SEVILLA_PREPAID_AMOUNT = '655';
export const PUERTA_DE_SEVILLA_PREPAYMENT_TYPE = MEWS_PREPAYMENT_TYPE_DEPOSIT;

export function isPuertaDeSevillaRow(row) {
  const parts = [
    row?.['Partner Company'],
    row?.['Company Id'],
    row?.['Last Name(*)'],
    row?.['First Name'],
    row?.Email,
    row?.['Tax Identification Number'],
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return parts.includes('puerta de sevilla') || clean(row?.['Tax Identification Number']) === 'B91555417';
}

/** Keep 655; Mews import type = Deposit (not External payment). */
export function applyPuertaDeSevillaPrepayment(row) {
  if (!isPuertaDeSevillaRow(row)) return row;
  const out = { ...row };
  out['Prepaid Amount'] = PUERTA_DE_SEVILLA_PREPAID_AMOUNT;
  out['Prepayment Type'] = PUERTA_DE_SEVILLA_PREPAYMENT_TYPE;
  return out;
}
