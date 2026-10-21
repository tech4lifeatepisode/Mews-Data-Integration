import { categoryForRoomNumber, clean } from './room-number-to-category.mjs';

/** Mews / Episode canonical room product names (Carabanchel). */
export const CANONICAL_ROOM_CATEGORIES = [
  'The Comfort',
  'The Rooftop',
  'The Standard',
  'The Standard PMR',
  'The Standard with Terrace',
  'The Standard with Terrace PMR',
  'The Two Bedroom (Double Single)',
  'The Two Bedroom Rooftop',
  'The Two Bedroom with Terrace',
  'The Two Bedrooms (Double Double)',
];

const ALIAS_TO_CANONICAL = new Map(
  [
    ['comf', 'The Comfort'],
    ['the comfort', 'The Comfort'],
    ['studio comfort', 'The Comfort'],
    ['roof', 'The Rooftop'],
    ['the rooftop', 'The Rooftop'],
    ['studio rooftop', 'The Rooftop'],
    ['stan pmr', 'The Standard PMR'],
    ['the standard pmr', 'The Standard PMR'],
    ['stan ter pmr', 'The Standard with Terrace PMR'],
    ['the standard with terrace pmr', 'The Standard with Terrace PMR'],
    ['stan ter', 'The Standard with Terrace'],
    ['the standard with terrace', 'The Standard with Terrace'],
    ['studio standard with terrace', 'The Standard with Terrace'],
    ['studio standard + terrace', 'The Standard with Terrace'],
    ['studio standard+terrace', 'The Standard with Terrace'],
    ['stan', 'The Standard'],
    ['the standard', 'The Standard'],
    ['studio standard', 'The Standard'],
    ['2bed 2+1', 'The Two Bedroom (Double Single)'],
    ['the two bedroom (double single)', 'The Two Bedroom (Double Single)'],
    ['the two bedroom (2+1)', 'The Two Bedroom (Double Single)'],
    ['2 bed (1/2)', 'The Two Bedroom (Double Single)'],
    ['2 bedroom (2+1)', 'The Two Bedroom (Double Single)'],
    ['2-bedroom 2-bathroom apartment', 'The Two Bedroom (Double Single)'],
    ['2bed roof', 'The Two Bedroom Rooftop'],
    ['the two bedroom rooftop', 'The Two Bedroom Rooftop'],
    ['2bed terr', 'The Two Bedroom with Terrace'],
    ['the two bedroom with terrace', 'The Two Bedroom with Terrace'],
    ['2 bedroom with terrace', 'The Two Bedroom with Terrace'],
    ['2bed 2+2', 'The Two Bedrooms (Double Double)'],
    ['the two bedrooms (2+2)', 'The Two Bedrooms (Double Double)'],
    ['the two bedrooms (double double)', 'The Two Bedrooms (Double Double)'],
  ].map(([k, v]) => [k.toLowerCase(), v]),
);

/** Pad numeric doors to 4 digits (777 → 0777). Keeps negatives, alphanumerics (e.g. 1-6) as-is. */
export function formatAllocatedRoomNumber(raw) {
  const c = clean(raw);
  if (!c || c === '/' || c === '-') return null;
  if (/^b2b$/i.test(c)) return null;
  if (/^[+-]?\d+$/.test(c)) {
    const negative = c.startsWith('-');
    const digits = c.replace(/^[-+]/, '');
    const padded = digits.padStart(4, '0');
    return negative ? `-${padded}` : padded;
  }
  return c;
}

function canonicalizeFragment(fragment) {
  let s = clean(fragment);
  if (!s) return s;
  const lower = s.toLowerCase();
  if (ALIAS_TO_CANONICAL.has(lower)) return ALIAS_TO_CANONICAL.get(lower);
  for (const canon of CANONICAL_ROOM_CATEGORIES) {
    if (lower === canon.toLowerCase()) return canon;
  }
  for (const [alias, canon] of ALIAS_TO_CANONICAL) {
    if (lower.includes(alias)) {
      s = s.replace(new RegExp(alias.replace(/[.+?^${}()|[\]\\]/g, '\\$&'), 'gi'), canon);
    }
  }
  for (const canon of CANONICAL_ROOM_CATEGORIES) {
    const re = new RegExp(canon.replace(/[()]/g, '\\$&'), 'gi');
    if (re.test(s)) s = s.replace(re, canon);
  }
  return s;
}

/** Normalize free-text / Seguimiento / extraction unit labels to canonical Mews category names. */
export function canonicalizeRoomCategory(raw) {
  const c = clean(raw);
  if (!c || c === '/') return null;
  if (/^b2b$/i.test(c)) return null;
  const parts = c.split(/[;|]/).map((p) => canonicalizeFragment(p.trim()));
  const joined = parts.filter(Boolean).join('; ');
  return joined || canonicalizeFragment(c);
}

/** Pad HM/Mews room numbers; set category from authoritative room→category map (never rewrite door). */
export function applyMewsRoomAndCategoryStandards(row, roomMap) {
  const formatted = formatAllocatedRoomNumber(row['Allocated Room Number']);
  if (formatted) row['Allocated Room Number'] = formatted;
  else if (/^b2b$/i.test(clean(row['Allocated Room Number']))) row['Allocated Room Number'] = null;

  const mapped = categoryForRoomNumber(row['Allocated Room Number'], roomMap);
  if (mapped) row['Allocated Room Category(*)'] = canonicalizeRoomCategory(mapped) || mapped;
  else {
    const canonCat = canonicalizeRoomCategory(row['Allocated Room Category(*)']);
    if (canonCat) row['Allocated Room Category(*)'] = canonCat;
  }
}
