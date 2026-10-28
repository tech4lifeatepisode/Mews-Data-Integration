/**
 * Fields that break bulk Mews xlsx import (non–channel-manager Source, custom segments, etc.).
 */
import { clean } from './room-number-to-category.mjs';
import { canonicalizeRoomCategory, formatAllocatedRoomNumber } from './mews-room-format.mjs';
import { MEWS_PRODUCT_NAMES } from './mews-product-map.mjs';
import { applyMewsImportReadyFields } from './mews-import-ready.mjs';

const INVALID_DOCUMENT_TYPES = new Set([
  'taxidentificationnumber',
  'tax identification number',
  'taxid',
]);

/** Mews import accepts Passport | IdentityCard | … — not TaxIdentificationNumber. */
export function fixMewsDocumentType(row) {
  const raw = clean(row['Document Type']);
  if (!raw) return row;
  if (!INVALID_DOCUMENT_TYPES.has(raw.toLowerCase().replace(/\s+/g, ''))) return row;
  const doc = clean(row['Document Number']);
  if (/^[A-Z]{3}\d/i.test(doc) || /^[A-Z0-9]{6,9}$/i.test(doc)) {
    row['Document Type'] = 'Passport';
  } else {
    row['Document Type'] = 'IdentityCard';
  }
  return row;
}

export function clearMewsChannelOnlyFields(row) {
  row.Source = null;
  row['Channel manager integration ID'] = null;
  row['Channel manager number'] = null;
  row['Channel number'] = null;
  return row;
}

/** Property-specific segments; leave empty unless configured in Mews. */
export function clearMewsBusinessSegment(row) {
  row['Business Segment'] = null;
  return row;
}

/** Keep only catalog names; default strip all if none match (avoid import hard-fail). */
export function sanitizeMewsIncludedProducts(value, { stripAllIfAnyUnknown = true } = {}) {
  const raw = clean(value);
  if (!raw) return null;
  const parts = raw
    .split(/[,;|]/)
    .map((p) => clean(p))
    .filter(Boolean);
  const kept = parts.filter((p) => MEWS_PRODUCT_NAMES.includes(p));
  if (stripAllIfAnyUnknown && kept.length !== parts.length) {
    return kept.length ? kept.join('; ') : null;
  }
  return kept.length ? kept.join('; ') : null;
}

export function applyMewsXlsxExportSanitize(row, options = {}) {
  const out = { ...row };
  applyMewsImportReadyFields(out);
  fixMewsDocumentType(out);
  clearMewsChannelOnlyFields(out);
  clearMewsBusinessSegment(out);
  out['Included Products'] = sanitizeMewsIncludedProducts(out['Included Products'], options);

  const room = formatAllocatedRoomNumber(out['Allocated Room Number']);
  if (room) out['Allocated Room Number'] = room;
  const cat = canonicalizeRoomCategory(out['Allocated Room Category(*)']);
  if (cat) out['Allocated Room Category(*)'] = cat;

  return out;
}

export function parseIsoDateField(val) {
  const raw = clean(val);
  const m = raw?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Rows with arrival before this date often fail Mews “historical edit” unless property window is wide. */
export const DEFAULT_MEWS_XLSX_MIN_ARRIVAL = process.env.MEWS_XLSX_MIN_ARRIVAL || '2026-10-21';

export function isMewsXlsxImportableByArrival(row, minArrival = DEFAULT_MEWS_XLSX_MIN_ARRIVAL) {
  const arr = parseIsoDateField(row['Arrival Date(*)']);
  if (!arr) return false;
  return arr >= minArrival;
}
