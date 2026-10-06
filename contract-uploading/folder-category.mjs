/** @typedef {'contract' | 'information' | 'payment' | 'other'} ContentCategory */

const NC_FOLDER = /^NC[_\s-]*\d+/i;

/**
 * Classify a single Drive folder segment (not the NC customer folder).
 * @param {string} segment
 * @returns {ContentCategory}
 */
export function classifyFolderSegment(segment) {
  const name = String(segment || '').trim();
  if (!name || NC_FOLDER.test(name)) return 'other';
  const upper = name.toUpperCase();

  if (
    /\bCONTRACT\b/.test(upper) ||
    /\bCONTRATO\b/.test(upper) ||
    /02\.\s*CONTRACT/.test(upper)
  ) {
    return 'contract';
  }
  if (
    /\bINFORMATION\b/.test(upper) ||
    /\bINFORMAC/.test(upper) ||
    /01\.\s*INFORMATION/.test(upper) ||
    /\bID[-\s]*NOMINAS\b/.test(upper) ||
    /\bPASAPORTE\b/.test(upper) ||
    /\bDNI\b/.test(upper)
  ) {
    return 'information';
  }
  if (
    /\bPAYMENT\b/.test(upper) ||
    /\bPAGO\b/.test(upper) ||
    /\bDEPOSIT/.test(upper) ||
    /\bDEPOSITO\b/.test(upper) ||
    /03\.\s*PAY/.test(upper)
  ) {
    return 'payment';
  }
  return 'other';
}

/**
 * Deepest matching folder wins (e.g. file under NC / 02. CONTRACT).
 * @param {string[] | null | undefined} routeSegments
 */
export function classifyRoute(routeSegments) {
  const segments = routeSegments || [];
  /** @type {ContentCategory} */
  let contentCategory = 'other';
  let contentCategoryFolder = null;

  for (const seg of segments) {
    const cat = classifyFolderSegment(seg);
    if (cat !== 'other') {
      contentCategory = cat;
      contentCategoryFolder = seg;
    }
  }

  const routeSegmentsLabeled = segments.map((seg) => {
    const cat = classifyFolderSegment(seg);
    return cat === 'other' ? seg : `[${cat}] ${seg}`;
  });

  const ncIndex = segments.findIndex((seg) => NC_FOLDER.test(String(seg || '')));
  let storagePathUnderNc = null;
  if (ncIndex >= 0) {
    const tail = segments.slice(ncIndex + 1);
    if (tail.length) {
      const parts = [];
      if (contentCategory !== 'other') parts.push(contentCategory);
      parts.push(...tail);
      storagePathUnderNc = parts.join('/');
    }
  }

  return {
    contentCategory,
    contentCategoryFolder,
    routeSegmentsLabeled,
    storagePathUnderNc,
  };
}
