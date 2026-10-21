import { clean } from './room-number-to-category.mjs';
import { isSecondPersonFreePromo } from './mews-product-map.mjs';

/** V3 Included Products labels (Mews catalog group names). Import Name remains Persona extra. */
export const SUPLEMENTO_PERSONA_EXTRA = 'Suplemento Persona Extra';
export const SUPLEMENTO_PERSONA_EXTRA_GRATUIDAD = 'Suplemento Persona Extra (gratuidad)';

const PERSONA_EXTRA_MEWS = 'Persona extra';

function normBlob(s) {
  return clean(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ');
}

function parseEuroAmount(raw) {
  const c = clean(raw);
  if (!c) return null;
  const m = c.replace(/\s/g, '').match(/(\d{1,5}(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function monthlyHeadlineEur(...blobs) {
  const text = blobs.map(clean).filter(Boolean).join(' ');
  const m = text.match(/Monthly price:\s*([\d.,]+)/i);
  return m ? parseEuroAmount(m[1]) : null;
}

function monthlyPayableEur(...blobs) {
  const text = blobs.map(clean).filter(Boolean).join(' ');
  const m = text.match(/importe a abonar mensualmente ser[aá] de\s*([\d.,]+)/i);
  if (m) return parseEuroAmount(m[1]);
  return null;
}

function allocatedRateEur(row) {
  return parseEuroAmount(row?.['Allocated Rate']);
}

function adultCount(row) {
  for (const field of ['Adult Count(*)', 'Person Counts(*)']) {
    const n = parseInt(clean(row?.[field]), 10);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function explicitPaidSuplemento(...blobs) {
  const text = normBlob(blobs.join(' '));
  if (!/suplemento persona extra|suplemento persona|persona extra/.test(text)) return false;
  if (/gratuidad|gratis|\(0\)|€0|eur 0|2[aª]\s*persona\s*gratis|segunda persona gratis/.test(text)) return false;
  if (/100\s*€|€\s*100|\(\s*100\s*\)/.test(text)) return true;
  return /suplemento persona extra(?!.*gratuidad)/.test(text);
}

function explicitGratuidadSuplemento(...blobs) {
  const text = normBlob(blobs.join(' '));
  return (
    /suplemento persona extra.*gratuidad|gratuidad.*suplemento persona|persona extra.*gratuidad/.test(text) ||
    /100\s*€\s*por\s+2[aª]\s*persona|de\s+100\s*€\s*por\s+2[aª]/.test(text)
  );
}

function contractBlobs(row, customersFinal) {
  return [
    row?.['Reservation Notes'],
    customersFinal?.['Reservation Notes'],
    customersFinal?.['Included Products'],
    row?.['Included Products'],
  ];
}

/**
 * @returns {'gratuidad'|'paid'|'unclear'}
 */
export function classifyPersonaExtraKind(row, customersFinal = null) {
  const blobs = contractBlobs(row, customersFinal);

  if (isSecondPersonFreePromo(...blobs) || explicitGratuidadSuplemento(...blobs)) {
    return 'gratuidad';
  }

  if (explicitPaidSuplemento(...blobs)) return 'paid';

  const headline = monthlyHeadlineEur(...blobs);
  const payable = monthlyPayableEur(...blobs) ?? allocatedRateEur(row);
  const allocated = allocatedRateEur(row);

  if (headline != null && payable != null) {
    const diff = headline - payable;
    if (Math.abs(diff - 100) <= 15 && (isSecondPersonFreePromo(...blobs) || explicitGratuidadSuplemento(...blobs))) {
      return 'gratuidad';
    }
  }

  if (headline != null && allocated != null && adultCount(row) >= 2) {
    if (Math.abs(headline - allocated) <= 15 && !isSecondPersonFreePromo(...blobs)) return 'paid';
    if (Math.abs(headline - allocated - 100) <= 15) return 'paid';
  }

  return 'unclear';
}

export function personaExtraV3Label(row, customersFinal = null) {
  const kind = classifyPersonaExtraKind(row, customersFinal);
  if (kind === 'gratuidad') return SUPLEMENTO_PERSONA_EXTRA_GRATUIDAD;
  return SUPLEMENTO_PERSONA_EXTRA;
}

/** Replace Mews import name with V3 Suplemento labels in Included Products. */
export function applyV3PersonaExtraProductLabels(includedProducts, row, customersFinal = null) {
  const c = clean(includedProducts);
  if (!c || !c.includes(PERSONA_EXTRA_MEWS)) return includedProducts;
  const label = personaExtraV3Label(row, customersFinal) ?? SUPLEMENTO_PERSONA_EXTRA;
  return c
    .split(';')
    .map((p) => p.trim())
    .map((p) => (p === PERSONA_EXTRA_MEWS ? label : p))
    .join('; ');
}
