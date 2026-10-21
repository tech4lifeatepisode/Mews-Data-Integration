import path from 'path';

export const DRIVE_FOLDER = (process.env.SUPABASE_STORAGE_FOLDER || process.env.SUPABASE_UPLOAD_FOLDER || 'Google Drive').replace(
  /^\/+|\/+$/g,
  '',
);

export function ncLabel(n) {
  return `NC_${String(n).padStart(4, '0')}`;
}

export function uploadScore(u, nc, folder = DRIVE_FOLDER) {
  const label = ncLabel(nc);
  const pathS = String(u.storage_path || '');
  const name = String(u.drive_name || '').toLowerCase();
  const blob = `${pathS} ${name}`.toLowerCase();
  if (!pathS.replace(/^\/+/, '').startsWith(folder)) return null;
  if (!pathS || u.mime_type === 'application/vnd.google-apps.folder') return null;
  if (name === '.keep' || blob.includes('/.keep')) return null;
  if (/payment|payments|renta|deposito|depósito|transferencia|justificante|constancia|detalle_transferencia/.test(blob)) {
    if (!/\/02\.\s*contract\//i.test(pathS) && !blob.includes('02. contract')) return null;
  }
  if (/constancia de dep|copia de constancia|signed \(\d+\)\.pdf$/i.test(blob) && !blob.includes('02. contract')) {
    return null;
  }

  let score = 0;
  if (Number(u.nc_number) === nc) score += 40;
  else if (blob.includes(label.toLowerCase())) score += 30;
  else if (new RegExp(`nc_0*${nc}(?:[^0-9]|$)`, 'i').test(blob)) score += 20;
  else return null;

  if (/\/02\.\s*contract\//i.test(pathS) || blob.includes('02. contract')) score += 50;
  if (new RegExp(`[/\\\\]NC_0*${nc}([^0-9]|/|$)`, 'i').test(pathS)) score += 30;
  if (/constancia|depósito|deposito de|justificante/i.test(name)) score -= 70;
  if (name.endsWith('.docx')) score += 35;
  else if (name.endsWith('.pdf') && !name.includes('docx.pdf')) score += 25;
  else if (name.endsWith('docx.pdf')) score += 10;
  if (/adenda|constancia|anexo\s*iii/i.test(blob)) score -= 15;
  if (/\.(png|jpg|jpeg|webp|txt)$/.test(name)) score -= 40;
  return score;
}

export function findContractUploadForNc(uploads, nc, folder = DRIVE_FOLDER) {
  const scored = [];
  for (const u of uploads) {
    const score = uploadScore(u, nc, folder);
    if (score != null) scored.push({ u, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (b.u.size_bytes || 0) - (a.u.size_bytes || 0) ||
      String(b.u.storage_path || '').localeCompare(String(a.u.storage_path || '')),
  );
  return scored[0]?.u || null;
}

export function mimeForUpload(upload) {
  const name = upload.drive_name || path.basename(upload.storage_path || '');
  if (upload.mime_type && upload.mime_type !== 'application/vnd.google-apps.folder') {
    return upload.mime_type;
  }
  const lower = String(name).toLowerCase();
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/pdf';
}
