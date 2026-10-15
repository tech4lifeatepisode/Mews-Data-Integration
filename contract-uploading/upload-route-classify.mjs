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
 * @param {string | null | undefined} mimeType
 * @param {string | null | undefined} fileName
 * @returns {'PDF' | 'DOCX' | 'Other' | null}
 */
export function classifyFileFormat(mimeType, fileName) {
  const mime = String(mimeType || '').toLowerCase();
  const name = String(fileName || '').toLowerCase();
  if (!mime && !name) return null;
  if (mime === 'application/pdf' || name.endsWith('.pdf') || /_pdf$/i.test(name)) return 'PDF';
  if (
    mime.includes('wordprocessingml') ||
    mime === 'application/msword' ||
    name.endsWith('.docx') ||
    name.endsWith('.doc')
  ) {
    return 'DOCX';
  }
  return 'Other';
}

/**
 * @param {string[]} routeSegments
 * @param {string} [storagePath]
 * @param {string | null} [mimeType]
 * @param {string | null} [driveName]
 * @param {'file' | 'folder'} [itemType]
 */
export function deriveUploadMetadata(
  routeSegments = [],
  storagePath = '',
  mimeType = null,
  driveName = null,
  itemType = 'file',
) {
  return {
    path_category: classifyPathCategory(routeSegments, storagePath),
    nc_number: primaryNcFromRoute(routeSegments),
    file_format: itemType === 'file' ? classifyFileFormat(mimeType, driveName) : null,
    ai_extraction: 'No',
  };
}

/**
 * After a sync, set ai_extraction per NC contract folder:
 * - Under Contracts, NC_0574+, one file → Yes
 * - Multiple files same NC + contract folder → PDF(s) Yes; else one DOCX Yes; else one file Yes
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} tableName
 * @param {string} syncId
 */
const FILE_PAGE_SIZE = 1000;
const UPDATE_CHUNK = 100;

async function fetchSyncFiles(supabase, tableName, syncId) {
  const rows = [];
  for (let from = 0; ; from += FILE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from(tableName)
      .select('id, nc_number, path_category, file_format, source_folder_route, drive_name, ai_extraction')
      .eq('sync_id', syncId)
      .eq('item_type', 'file')
      .order('id', { ascending: true })
      .range(from, from + FILE_PAGE_SIZE - 1);
    if (error) throw new Error(`reconcile ai_extraction: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < FILE_PAGE_SIZE) break;
  }
  return rows;
}

async function setAiExtraction(supabase, tableName, ids, value) {
  let updated = 0;
  for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
    const chunk = ids.slice(i, i + UPDATE_CHUNK);
    const { error } = await supabase.from(tableName).update({ ai_extraction: value }).in('id', chunk);
    if (error) throw new Error(`reconcile ai_extraction update: ${error.message}`);
    updated += chunk.length;
  }
  return updated;
}

/** Pick ai_extraction=Yes file ids per NC contract folder (Contracts, NC_0574+). */
export function pickAiExtractionYesIds(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.path_category !== 'Contracts') continue;
    const nc = row.nc_number ? Number(row.nc_number) : NaN;
    if (!Number.isFinite(nc) || nc < AI_EXTRACTION_MIN_NC) continue;
    const key = `${row.nc_number}\0${row.source_folder_route || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const yesIds = new Set();
  for (const members of groups.values()) {
    const sorted = [...members].sort((a, b) =>
      String(a.drive_name || '').localeCompare(String(b.drive_name || '')),
    );
    if (sorted.length === 1) {
      yesIds.add(sorted[0].id);
      continue;
    }
    const pdfs = sorted.filter((m) => m.file_format === 'PDF');
    if (pdfs.length > 0) {
      for (const pdf of pdfs) yesIds.add(pdf.id);
      continue;
    }
    const docxs = sorted.filter((m) => m.file_format === 'DOCX');
    if (docxs.length > 0) {
      yesIds.add(docxs[0].id);
      continue;
    }
    yesIds.add(sorted[0].id);
  }
  return yesIds;
}

async function applyAiExtractionPicks(supabase, tableName, rows, yesIds) {
  const yesToWrite = [];
  const noToWrite = [];
  for (const row of rows) {
    if (row.path_category !== 'Contracts') continue;
    const nc = row.nc_number ? Number(row.nc_number) : NaN;
    if (!Number.isFinite(nc) || nc < AI_EXTRACTION_MIN_NC) continue;
    const ai = yesIds.has(row.id) ? 'Yes' : 'No';
    if (row.ai_extraction === ai) continue;
    if (ai === 'Yes') yesToWrite.push(row.id);
    else noToWrite.push(row.id);
  }
  const updated =
    (await setAiExtraction(supabase, tableName, yesToWrite, 'Yes')) +
    (await setAiExtraction(supabase, tableName, noToWrite, 'No'));
  return { updated, yes: yesIds.size, files: rows.length };
}

async function fetchAllContractFiles(supabase, tableName) {
  const rows = [];
  for (let from = 0; ; from += FILE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from(tableName)
      .select('id, nc_number, path_category, file_format, source_folder_route, drive_name, ai_extraction')
      .eq('item_type', 'file')
      .eq('path_category', 'Contracts')
      .order('id', { ascending: true })
      .range(from, from + FILE_PAGE_SIZE - 1);
    if (error) throw new Error(`reconcile ai_extraction (all): ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < FILE_PAGE_SIZE) break;
  }
  return rows;
}

export async function reconcileAiExtractionForSync(supabase, tableName, syncId) {
  await supabase
    .from(tableName)
    .update({ ai_extraction: 'No' })
    .eq('sync_id', syncId)
    .eq('item_type', 'folder');

  const rows = await fetchSyncFiles(supabase, tableName, syncId);
  if (!rows.length) return { updated: 0, yes: 0, files: 0 };

  const yesIds = pickAiExtractionYesIds(rows);
  return applyAiExtractionPicks(supabase, tableName, rows, yesIds);
}

/** Reconcile ai_extraction for every Contracts file row (NC_0574+) in the upload log. */
export async function reconcileAiExtractionAll(supabase, tableName) {
  const rows = await fetchAllContractFiles(supabase, tableName);
  if (!rows.length) return { updated: 0, yes: 0, files: 0 };
  const yesIds = pickAiExtractionYesIds(rows);
  return applyAiExtractionPicks(supabase, tableName, rows, yesIds);
}
