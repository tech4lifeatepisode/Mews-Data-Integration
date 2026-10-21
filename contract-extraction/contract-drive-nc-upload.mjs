/**
 * Pick the best contract file in Supabase Storage (Google Drive folder) for an NC.
 */
const DEFAULT_FOLDER = (process.env.SUPABASE_STORAGE_FOLDER ||
  process.env.SUPABASE_UPLOAD_FOLDER ||
  'Google Drive').replace(/^\/+|\/+$/g, '');

export function ncLabel(n) {
  return `NC_${String(n).padStart(4, '0')}`;
}

export function uploadScore(u, nc, folder = DEFAULT_FOLDER) {
  const label = ncLabel(nc);
  const pathS = String(u.storage_path || '');
  const name = String(u.drive_name || '').toLowerCase();
  const blob = `${pathS} ${name}`.toLowerCase();
  if (!pathS.replace(/^\/+/, '').startsWith(folder)) return null;
  if (!pathS || u.mime_type === 'application/vnd.google-apps.folder') return null;
  if (name === '.keep' || blob.includes('/.keep')) return null;
  if (/payment|payments|renta|deposito|transferencia|justificante/.test(blob) && !/contract/.test(blob)) {
    return null;
  }

  let score = 0;
  if (Number(u.nc_number) === nc) score += 40;
  else if (blob.includes(label.toLowerCase())) score += 30;
  else if (new RegExp(`nc_0*${nc}(?:[^0-9]|$)`, 'i').test(blob)) score += 20;
  else return null;

  if (/\/02\.\s*contract\//i.test(pathS) || blob.includes('02. contract')) score += 50;
  if (name.endsWith('.docx')) score += 35;
  else if (name.endsWith('.pdf') && !name.includes('docx.pdf')) score += 25;
  else if (name.endsWith('docx.pdf')) score += 10;
  if (/adenda|constancia/i.test(name) && !/contract/.test(blob)) score -= 15;
  if (/\.(png|jpg|jpeg|webp|txt)$/.test(name)) score -= 40;
  return score;
}

export function findBestUploadForNc(uploads, nc, folder = DEFAULT_FOLDER) {
  const scored = [];
  for (const u of uploads) {
    const score = uploadScore(u, nc, folder);
    if (score != null) scored.push({ u, score });
  }
  scored.sort((a, b) => b.score - a.score || (b.u.size_bytes || 0) - (a.u.size_bytes || 0));
  return scored[0]?.u || null;
}

export function filterDriveExtractableUploads(uploads, folder = DEFAULT_FOLDER) {
  return uploads.filter((u) => {
    if (u.item_type !== 'file' || u.status !== 'uploaded' || u.ai_extraction !== 'Yes') return false;
    const pathS = String(u.storage_path || '').replace(/^\/+/, '');
    if (!pathS.startsWith(folder)) return false;
    const name = String(u.drive_name || '').toLowerCase();
    if (!name || name === '.keep') return false;
    if (u.file_format === 'Other') return false;
    if (u.file_format && u.file_format !== 'PDF' && u.file_format !== 'DOCX') return false;
    return true;
  });
}
