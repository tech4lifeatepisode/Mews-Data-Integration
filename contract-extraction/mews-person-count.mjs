import { clean } from './room-number-to-category.mjs';

function isBlank(v) {
  const c = clean(v);
  return !c || c === '/' || c === '-';
}

function parseIntField(v) {
  const c = clean(v);
  if (!/^\d+$/.test(c)) return null;
  return c;
}

/** Infer guest count from reservation notes / tenancy text when counts missing. */
function personCountFromNotes(notes) {
  const c = clean(notes);
  if (!c) return null;
  const m =
    c.match(/(?:no\.?\s*of\s*tenants|n[uú]mero de personas|person counts?|personas)[:\s]*(\d+)/i) ||
    c.match(/(\d+)\s*(?:adultos?|personas?|tenants?)\b/i);
  return m ? m[1] : null;
}

/**
 * Fill Adult / Child counts (Mews import uses these; Person Counts(*) is age-category names only).
 */
export function applyPersonCountFills(out, ...sources) {
  const rows = [out, ...sources.filter(Boolean)];

  for (const field of ['Adult Count(*)', 'Child Count(*)']) {
    if (!isBlank(out[field])) continue;
    for (const r of rows) {
      const v = parseIntField(r[field]) ?? parseIntField(r['Person Counts(*)']);
      if (v != null) {
        out[field] = v;
        break;
      }
    }
  }

  if (isBlank(out['Adult Count(*)'])) {
    for (const r of rows) {
      const fromNotes = personCountFromNotes(r['Reservation Notes']);
      if (fromNotes) {
        out['Adult Count(*)'] = fromNotes;
        break;
      }
    }
  }

  if (isBlank(out['Child Count(*)'])) out['Child Count(*)'] = '0';

  if (isBlank(out['Adult Count(*)'])) out['Adult Count(*)'] = '1';

  out['Person Counts(*)'] = null;
}
