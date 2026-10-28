/**
 * Upload a local NC folder tree into Supabase Storage (Google Drive/ prefix) + contract_drive_uploads log.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ncNumberFromToken } from './nc-allowlist.mjs';
import { deriveUploadMetadata, reconcileAiExtractionForSync } from './upload-route-classify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_LOG_TABLE = 'contract_drive_uploads';
const DRIVE_ROOT_LABEL = '02. CUSTOMERS-REAL';
const MAX_FILE_BYTES = 80 * 1024 * 1024;

const MIME = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
};

function supabaseKey() {
  const transcript =
    'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
  const text = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    [...text.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];
  if (!key) throw new Error('Missing Supabase service key');
  return key;
}

function uploadFolder() {
  return (process.env.SUPABASE_UPLOAD_FOLDER || 'Google Drive').replace(/^\/+|\/+$/g, '');
}

function safeSegment(name) {
  const cleaned = String(name || 'untitled')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.\- ]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .replace(/^[\s._-]+|[\s._-]+$/g, '')
    .trim();
  return cleaned || 'untitled';
}

function joinRoute(segments) {
  return segments.filter(Boolean).join(' / ');
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

function isContractFile(name) {
  const n = name.toLowerCase();
  return n.endsWith('.pdf') || n.endsWith('.docx') || n.endsWith('.doc');
}

function findContractDir(ncPath) {
  for (const ent of fs.readdirSync(ncPath, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (/\bCONTRACT\b/i.test(ent.name) && !/\bSUBCONTRACT\b/i.test(ent.name)) {
      return path.join(ncPath, ent.name);
    }
  }
  return null;
}

function contractDirHasPdfOrDoc(contractDir) {
  if (!contractDir || !fs.existsSync(contractDir)) return false;
  const stack = [contractDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (isContractFile(ent.name)) return true;
    }
  }
  return false;
}

async function uploadBuffer(supabase, bucket, objectPath, data, ct) {
  const maxAttempts = 4;
  let lastMsg = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { error } = await supabase.storage.from(bucket).upload(objectPath, data, {
      upsert: true,
      contentType: ct,
    });
    if (!error) return;
    lastMsg = error.message || 'unknown error';
    if (!/502|503|504|timeout|fetch failed/i.test(lastMsg) || attempt >= maxAttempts) break;
    await new Promise((r) => setTimeout(r, 500 * attempt * attempt));
  }
  throw new Error(`${objectPath}: ${lastMsg}`);
}

async function recordTransfer(supabase, stats, row) {
  const routeSegments = row.routeSegments || [];
  const storagePath = row.storagePath || '';
  const meta = deriveUploadMetadata(
    routeSegments,
    storagePath,
    row.mimeType,
    row.driveName,
    row.itemType,
  );
  const { error } = await supabase.from(UPLOAD_LOG_TABLE).insert({
    sync_id: stats.syncId,
    google_account: stats.account,
    status: row.status,
    item_type: row.itemType,
    drive_file_id: row.driveFileId || null,
    drive_name: row.driveName || null,
    parent_drive_id: null,
    source_folder_route: row.sourceFolderRoute || '',
    source_route: row.sourceRoute || '',
    route_segments: routeSegments,
    storage_bucket: row.storageBucket || null,
    storage_path: storagePath || null,
    path_category: meta.path_category,
    ai_extraction: meta.ai_extraction,
    nc_number: meta.nc_number,
    file_format: meta.file_format,
    mime_type: row.mimeType || null,
    size_bytes: Number.isFinite(row.sizeBytes) ? row.sizeBytes : null,
    error_message: row.errorMessage || null,
  });
  if (error) stats.logError = error.message;
}

function walkLocalFiles(dir, baseDir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkLocalFiles(full, baseDir, out);
    else out.push({ full, rel: path.relative(baseDir, full) });
  }
}

/**
 * @param {string} localRoot absolute path to folder containing NC_* subfolders
 */
export async function uploadLocalB2cBatch(localRoot, options = {}) {
  const batchLabel = options.batchLabel || path.basename(localRoot);
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'Contracts';
  const prefix = uploadFolder();
  const sb = createClient(process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co', supabaseKey());
  const syncId = crypto.randomUUID();
  const stats = {
    syncId,
    batchLabel,
    bucket,
    prefix,
    account: 'local-upload',
    files: 0,
    failed: 0,
    skipped: 0,
    ncFolders: 0,
    logError: null,
  };

  const ncDirs = fs
    .readdirSync(localRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^NC_/i.test(d.name))
    .map((d) => d.name)
    .sort();

  const missingContractPdfOrDoc = [];

  for (const ncName of ncDirs) {
    stats.ncFolders += 1;
    const ncPath = path.join(localRoot, ncName);
    const contractDir = findContractDir(ncPath);
    if (!contractDirHasPdfOrDoc(contractDir)) {
      const nc = ncNumberFromToken(ncName);
      missingContractPdfOrDoc.push({ nc_folder: ncName, nc_number: nc ? Number(nc) : null });
    }

    const files = [];
    walkLocalFiles(ncPath, ncPath, files);
    for (const { full, rel } of files) {
      const size = fs.statSync(full).size;
      const relParts = rel.split(path.sep);
      const routeSegments = [DRIVE_ROOT_LABEL, ncName, ...relParts];
      const storageParts = [prefix, safeSegment(ncName), ...relParts.map(safeSegment)];
      const objectPath = storageParts.join('/');
      const fileName = path.basename(full);
      const sourceFolderRoute = joinRoute(routeSegments.slice(0, -1));
      const sourceRoute = joinRoute(routeSegments);

      if (size > MAX_FILE_BYTES) {
        stats.skipped += 1;
        await recordTransfer(sb, stats, {
          status: 'skipped',
          itemType: 'file',
          driveName: fileName,
          sourceFolderRoute,
          sourceRoute,
          routeSegments,
          storageBucket: bucket,
          mimeType: contentType(full),
          sizeBytes: size,
          errorMessage: `size ${size} exceeds ${MAX_FILE_BYTES}`,
        });
        continue;
      }

      try {
        const data = fs.readFileSync(full);
        const ct = contentType(full);
        await uploadBuffer(sb, bucket, objectPath, data, ct);
        stats.files += 1;
        await recordTransfer(sb, stats, {
          status: 'uploaded',
          itemType: 'file',
          driveName: fileName,
          sourceFolderRoute,
          sourceRoute,
          routeSegments,
          storageBucket: bucket,
          storagePath: objectPath,
          mimeType: ct,
          sizeBytes: data.length,
        });
      } catch (error) {
        stats.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        await recordTransfer(sb, stats, {
          status: 'failed',
          itemType: 'file',
          driveName: fileName,
          sourceFolderRoute,
          sourceRoute,
          routeSegments,
          storageBucket: bucket,
          mimeType: contentType(full),
          sizeBytes: size,
          errorMessage: message,
        });
      }
    }
  }

  let aiExtraction = null;
  if (!stats.logError) {
    try {
      aiExtraction = await reconcileAiExtractionForSync(sb, UPLOAD_LOG_TABLE, syncId);
    } catch (e) {
      aiExtraction = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return {
    ...stats,
    missingContractPdfOrDoc,
    aiExtraction,
  };
}
