import { ncNumberFromToken } from './nc-allowlist.mjs';

const AI_EXTRACTION_MIN_NC = 574;

function normSegment(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

/**
 * Customer NC folder from Drive route (e.g. NC_0436_DOMINIC... → 436).
 * @param {string[]} routeSegments
 * @returns {string | null}
 */
export function primaryNcFromRoute(routeSegments = []) {
  for (const seg of routeSegments) {
    const nc = ncNumberFromToken(seg);
    if (nc) return nc;
  }
  return null;
}

/**
 * @param {string[]} routeSegments
 * @param {string} [storagePath]
 * @returns {'Information' | 'Contracts' | 'Payments' | 'Other'}
 */
export function classifyPathCategory(routeSegments = [], storagePath = '') {
  const parts = [...routeSegments, ...(storagePath ? storagePath.split('/') : [])];
  for (const part of parts) {
    const s = normSegment(part);
    if (!s) continue;
    if (/\bINFORMATION\b/.test(s) || /^01[\.\s]/.test(s.trim())) return 'Information';
    if (/\bCONTRACT\b/.test(s) && !/\bSUBCONTRACT\b/.test(s)) return 'Contracts';
    if (
      /\bPAYMENT\b/.test(s) ||
      /\bDEPOSIT/.test(s) ||
      /\bDEPOSITO\b/.test(s) ||
      /\bPAGO\b/.test(s) ||
      /^03[\.\s]/.test(s.trim())
    ) {
      return 'Payments';
    }
  }
  return 'Other';
}

/**
 * Yes when file route is under Contracts and NC is NC_0574 or later.
 * @param {string[]} routeSegments
 * @param {string} [storagePath]
 * @returns {'Yes' | 'No'}
 */
export function classifyAiExtraction(routeSegments = [], storagePath = '') {
  const category = classifyPathCategory(routeSegments, storagePath);
  if (category !== 'Contracts') return 'No';
  const nc = primaryNcFromRoute(routeSegments);
  if (!nc) return 'No';
  return Number(nc) >= AI_EXTRACTION_MIN_NC ? 'Yes' : 'No';
}

export function deriveUploadMetadata(routeSegments = [], storagePath = '') {
  return {
    path_category: classifyPathCategory(routeSegments, storagePath),
    ai_extraction: classifyAiExtraction(routeSegments, storagePath),
    nc_number: primaryNcFromRoute(routeSegments),
  };
}
