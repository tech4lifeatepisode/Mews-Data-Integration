/**
 * Map contract / HM Included Products text to Mews product Names (service catalog).
 */
import { clean } from './room-number-to-category.mjs';

/** Exact strings accepted by Mews import for this property. */
export const MEWS_PRODUCT_NAMES = [
  'Descuento 5%',
  'Descuento 10%',
  'Descuento 15%',
  'Descuento tarifa',
  'Early Check in',
  'Late Check out',
  'Persona extra',
  'ALL IN 20+20+20',
  'ESSENTIAL 20+20',
  'FLEX 15',
  'FLOW 10+10',
  'Limpieza (ropa unidad)',
  'Limpieza cambio de unidad',
  'Limpieza Extra 2 Dormitorios',
  'Limpieza extra Private Unit',
  'Limpieza terraza habitación',
  'Parking mes - Cliente',
  'Parking día - Cliente',
  'Parking bonificación - Cliente',
  'Cargadores eléctricos',
  'Deposit',
];

export const DISCOUNT_PERCENT_TO_PRODUCT = {
  5: 'Descuento 5%',
  10: 'Descuento 10%',
  15: 'Descuento 15%',
};

const PRICE_TO_MEAL = [
  [420, 'ALL IN 20+20+20'],
  [295, 'ESSENTIAL 20+20'],
  [195, 'FLEX 15'],
  [155, 'FLOW 10+10'],
];

function normBlob(s) {
  return clean(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ');
}

function moneyInParens(blob) {
  const m = blob.match(/\(\s*([\d.,]+)\s*\)/);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function mealFromPrice(blob) {
  const amount = moneyInParens(blob);
  if (amount == null) return null;
  for (const [price, name] of PRICE_TO_MEAL) {
    if (Math.abs(amount - price) < 1.5) return name;
  }
  return null;
}

function matchSegment(segment) {
  const b = normBlob(segment);
  if (!b) return [];

  const found = [];

  const add = (name) => {
    if (MEWS_PRODUCT_NAMES.includes(name) && !found.includes(name)) found.push(name);
  };

  if (/meal plan|pension|pensi[oó]n|media pensi|comida|men[uú]|all in|essential|flex 15|flow 10/.test(b)) {
    add(mealFromPrice(b));
    if (/all in|pension completa|pensi[oó]n completa|full board/.test(b)) add('ALL IN 20+20+20');
    else if (/essential|media pensi|half board/.test(b)) add('ESSENTIAL 20+20');
    else if (/flex\s*15/.test(b)) add('FLEX 15');
    else if (/flow\s*10|flow 10\+10/.test(b)) add('FLOW 10+10');
  }

  if (/flow\s*10|flow 10\+10/.test(b)) add('FLOW 10+10');
  if (/essential\s*20|essential 20\+20/.test(b)) add('ESSENTIAL 20+20');
  if (/all in\s*20|all in 20\+20/.test(b)) add('ALL IN 20+20+20');
  if (/flex\s*15/.test(b)) add('FLEX 15');

  if (/extra:\s*.*early check|^early check/.test(b)) add('Early Check in');
  if (/extra:\s*.*late check|^late check/.test(b)) add('Late Check out');

  if (/persona extra|suplemento persona|extra person/.test(b)) {
    if (/gratuidad|gratis|\(0\)|€0|eur 0/.test(b)) add('Persona extra');
    else add('Persona extra');
  }

  if (/limpieza extra private|limpieza extra hab|private unit/.test(b)) add('Limpieza extra Private Unit');
  if (/limpieza cambio/.test(b)) add('Limpieza cambio de unidad');
  if (/limpieza extra 2 dorm|2 dormitorios/.test(b)) add('Limpieza Extra 2 Dormitorios');
  if (/limpieza terraza|terraza hab/.test(b)) add('Limpieza terraza habitación');
  if (/extra ropa|ropa hab/.test(b)) add('Limpieza (ropa unidad)');

  if (/parking:/.test(b) || /^parking\b|extra:\s*parking|meal plan:\s*parking/.test(b)) {
    if (/:\s*no\b|:\s*none\b|sin parking/.test(b)) return found;
    if (/gratis|gratuidad|bonificaci[oó]n|\(0\)|free|plaza de parking gratis/.test(b)) {
      add('Parking bonificación - Cliente');
    } else if (/d[ií]a|day|once/.test(b)) add('Parking día - Cliente');
    else if (/:\s*yes|parking mes|plaza de parking|parking:/.test(b)) add('Parking mes - Cliente');
  } else if (/^extra:\s*parking|^parking\b/.test(b)) {
    if (/gratis|gratuidad|\(0\)/.test(b)) add('Parking bonificación - Cliente');
    else if (/d[ií]a/.test(b)) add('Parking día - Cliente');
    else add('Parking mes - Cliente');
  }

  const namedDiscount = b.match(/descuento\s*(5|10|15)\s*%/);
  if (namedDiscount) {
    add(DISCOUNT_PERCENT_TO_PRODUCT[Number(namedDiscount[1])]);
  } else if (/extra:\s*.*descuento|extra:\s*.*discount|promotion on rate|discount ops|descuento tarifa/.test(b)) {
    add('Descuento tarifa');
  }

  if (/extra:\s*.*cargador|^cargador/.test(b)) add('Cargadores eléctricos');
  if (/^extra:\s*deposit\b|^deposit\b/.test(b)) add('Deposit');

  if (/^\s*[\d.]+\s*\)?\s*$/.test(b)) return found;

  return found;
}

function splitProductBlob(blob) {
  const c = clean(blob);
  if (!c) return [];
  const parts = c
    .split(/;/)
    .flatMap((p) => p.split(/,(?=\s*(?:Meal plan|Extra|Parking|Limpieza|Early|Late|Descuento|ALL IN|ESSENTIAL|FLOW|FLEX))/i))
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts : [c];
}

function reservationNotesBlob(row, customersFinal) {
  return [row?.['Reservation Notes'], customersFinal?.['Reservation Notes']].map(clean).filter(Boolean).join(' | ');
}

function explicitParkingNo(notesBlob) {
  const m = notesBlob.match(/Parking:\s*([^|]+)/i);
  return Boolean(m && /^no\b/i.test(m[1].trim()));
}

function explicitMealNo(notesBlob) {
  const m = notesBlob.match(/Meal plan:\s*([^|]+)/i);
  return Boolean(m && /^no\b/i.test(m[1].trim()));
}

function discountFieldValue(notesBlob) {
  const m = notesBlob.match(/Discount:\s*([^|]+)/i);
  return m ? m[1].trim() : null;
}

function discountFieldEmpty(notesBlob) {
  const v = discountFieldValue(notesBlob);
  if (v == null) return false;
  return v === '/' || v === '-' || /^no\b/i.test(v);
}

function noPromoInNotes(notesBlob) {
  return /no aplica,\s*no promo|\bno promo\b/i.test(normBlob(notesBlob));
}

/** Second guest free — Mews product Persona extra, not Descuento tarifa / %. */
export function isSecondPersonFreePromo(...blobs) {
  const text = normBlob(blobs.map(clean).filter(Boolean).join(' '));
  if (!text) return false;
  return (
    /2[aª]\s*persona\s*gratis|segunda\s+persona\s+gratis|promo\s*2[aª]\s*persona|descuento\s*(?:especifico:?\s*)?2[aª]\s*persona|de\s+\d+\s*€\s*por\s+2[aª]\s*persona|100\s*€\s*por\s+2[aª]/.test(
      text,
    ) || /descuento\s*2[aª]\s*persona\s*gratis/.test(text)
  );
}

function isNonTarifaDiscount(...blobs) {
  const text = normBlob(blobs.map(clean).filter(Boolean).join(' '));
  return /ausencia de costes|bonificado en su totalidad|\bderecho al uso del hub\b|fee de gesti[oó]n|coste adicional.*bonificado/.test(
    text,
  );
}

function stripParkingIfExplicitNo(names, notesBlob) {
  if (!explicitParkingNo(notesBlob)) return;
  for (let i = names.length - 1; i >= 0; i--) {
    if (names[i].startsWith('Parking')) names.splice(i, 1);
  }
}

function stripAllDescuentoProducts(names) {
  for (let i = names.length - 1; i >= 0; i--) {
    if (names[i].startsWith('Descuento')) names.splice(i, 1);
  }
}

function qualifiesGenericTarifaDiscount(...blobs) {
  const text = normBlob(blobs.map(clean).filter(Boolean).join(' '));
  if (!text || isSecondPersonFreePromo(text) || isNonTarifaDiscount(text) || noPromoInNotes(text)) return false;
  if (discountFieldEmpty(blobs.join(' '))) return false;
  const discField = discountFieldValue(blobs.join(' '));
  if (discField && isSecondPersonFreePromo(`Discount: ${discField}`)) return false;
  if (/se aplica un descuento sobre el precio,?\s*por lo que el importe/.test(text)) return true;
  if (/extra:.*descuento tarifa|promotion on rate|discount ops/.test(text)) return true;
  return false;
}

function mealParkingFromNotes(notes) {
  const c = clean(notes);
  if (!c) return [];
  const names = [];
  const add = (name) => {
    if (MEWS_PRODUCT_NAMES.includes(name) && !names.includes(name)) names.push(name);
  };
  const meal = c.match(/Meal plan:\s*([^|]+)/i);
  if (meal) {
    const part = meal[1].trim();
    if (!/^no\b/i.test(part)) {
      for (const name of matchSegment(`Meal plan: ${part}`)) add(name);
    }
  }
  const park = c.match(/Parking:\s*([^|]+)/i);
  if (park) {
    const part = park[1].trim();
    if (!/^no\b/i.test(part)) {
      for (const name of matchSegment(`Parking: ${part}`)) add(name);
    }
  }
  return names;
}

/** Parse Descuento tarifa % from contract / Final_Format customers text (section g style). */
export function discountPercentFromContractText(...blobs) {
  const text = blobs
    .map((b) => clean(b))
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (!text) return null;
  if (isSecondPersonFreePromo(text) || isNonTarifaDiscount(text)) return null;
  if (noPromoInNotes(text)) return null;
  const discVal = discountFieldValue(text);
  if (discVal && (discVal === '/' || discVal === '-' || isSecondPersonFreePromo(`Discount: ${discVal}`))) return null;
  if (!/descuento|discount/.test(text) && !/del\s+\d+\s*%/.test(text)) return null;

  const patterns = [
    /un\s+(\d+)\s*%\s*de\s+descuento/i,
    /descuento\s+del\s+(\d+)\s*%/i,
    /precio\s+del\s+(\d+)\s*%/i,
    /del\s+(\d+)\s*%\s*(?:por lo que|sobre el precio|para larga|de descuento)/i,
    /descuento[^|]{0,120}?del\s+(\d+)\s*%/i,
    /(\d+)\s*%\s*(?:por lo que el importe|de descuento sobre)/i,
    /-\s*(\d+)\s*%\s*of month/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const p = Number(m[1]);
    if (DISCOUNT_PERCENT_TO_PRODUCT[p]) return p;
  }
  return null;
}

function addDiscountProduct(names, percent) {
  const product = DISCOUNT_PERCENT_TO_PRODUCT[percent];
  if (!product) return;
  const idx = names.indexOf('Descuento tarifa');
  if (idx >= 0) names.splice(idx, 1);
  if (!names.includes(product)) names.push(product);
}

/**
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown>|null} [customersFinal] Final_Format_Customers_Contracts_Extraction row (same NC)
 * @returns {string|null} semicolon-separated Mews product names
 */
export function mapRowToMewsIncludedProducts(row, customersFinal = null) {
  const names = [];
  const addAll = (list) => {
    for (const name of list) {
      if (!names.includes(name)) names.push(name);
    }
  };
  const add = (name) => {
    if (MEWS_PRODUCT_NAMES.includes(name) && !names.includes(name)) names.push(name);
  };

  const notesBlob = reservationNotesBlob(row, customersFinal);
  const incl = firstNonEmpty(row['Included Products'], customersFinal?.['Included Products']);
  const contractBlobs = [
    row['Reservation Notes'],
    customersFinal?.['Reservation Notes'],
    customersFinal?.discount_section_g_text,
    incl,
  ];

  addAll(mealParkingFromNotes(row['Reservation Notes']));
  addAll(mealParkingFromNotes(customersFinal?.['Reservation Notes']));

  if (incl) {
    for (const segment of splitProductBlob(incl)) {
      for (const name of matchSegment(segment)) {
        if (name.startsWith('Parking') || name.startsWith('Descuento')) continue;
        add(name);
      }
    }
  }

  if (isSecondPersonFreePromo(...contractBlobs)) {
    add('Persona extra');
    stripAllDescuentoProducts(names);
  }

  const discountPct = discountPercentFromContractText(...contractBlobs);
  if (discountPct != null) {
    addDiscountProduct(names, discountPct);
  } else if (qualifiesGenericTarifaDiscount(...contractBlobs)) {
    add('Descuento tarifa');
  }

  if (discountFieldEmpty(notesBlob) || noPromoInNotes(notesBlob) || isNonTarifaDiscount(notesBlob)) {
    stripAllDescuentoProducts(names);
  }

  stripParkingIfExplicitNo(names, notesBlob);

  if (explicitMealNo(notesBlob)) {
    for (let i = names.length - 1; i >= 0; i--) {
      const n = names[i];
      if (/^(ALL IN|ESSENTIAL|FLEX|FLOW)/.test(n)) names.splice(i, 1);
    }
  }

  return names.length ? names.join('; ') : null;
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const c = clean(v);
    if (c && c !== '/' && c !== '-') return c;
  }
  return null;
}
