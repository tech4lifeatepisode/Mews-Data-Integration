/**
 * Google Drive → Supabase Storage uploader.
 * Served by the Render extraction process, and runnable on its own with `npm start`.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { loadAllowedNcNumbers, nameMatchesAllowlist, ncNumbersInName } from './nc-allowlist.mjs';
import { resolveMigrationGreenAllowlist } from './migration-xlsx-allowlist.mjs';
import { deriveUploadMetadata, reconcileAiExtractionForSync } from './upload-route-classify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '.env') });
dotenv.config({ path: path.join(here, '..', 'contract-extraction', '.env') });

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const MAX_FILE_BYTES = 80 * 1024 * 1024;
const TOKEN_PATH = path.join(here, '.google-token.json');

const EXPORTS = {
  'application/vnd.google-apps.document': { mime: 'application/pdf', ext: '.pdf' },
  'application/vnd.google-apps.spreadsheet': {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: '.xlsx',
  },
  'application/vnd.google-apps.presentation': { mime: 'application/pdf', ext: '.pdf' },
};

const pendingStates = new Set();
const UPLOAD_LOG_TABLE = 'contract_drive_uploads';
let syncRunning = false;
let lastSync = null;
let memoryTokens = null;

function uploadFolder() {
  return (process.env.SUPABASE_UPLOAD_FOLDER || 'Google Drive').replace(/^\/+|\/+$/g, '');
}

function driveFolderId() {
  return process.env.GOOGLE_DRIVE_FOLDER_ID || '1yolAv0AGafMmsdNCtc58Qrk8HHJURysS';
}

function redirectUri() {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  if (process.env.RENDER_EXTERNAL_URL) {
    return `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/drive/oauth/callback`;
  }
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}/drive/oauth/callback`;
}

function loadGoogleClient() {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }
  const candidates = [];
  if (process.env.GOOGLE_CLIENT_SECRET_FILE) candidates.push(process.env.GOOGLE_CLIENT_SECRET_FILE);
  for (const dir of [here, path.join(here, '..')]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('client_secret') && name.endsWith('.json')) {
        candidates.push(path.join(dir, name));
      }
    }
  }
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const web = parsed.web || parsed.installed;
    if (web?.client_id && web?.client_secret) {
      return { clientId: web.client_id, clientSecret: web.client_secret };
    }
  }
  throw new Error(
    'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server. The client secret JSON is not committed.',
  );
}

function oauthClient() {
  const { clientId, clientSecret } = loadGoogleClient();
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri());
  const tokens = loadTokens();
  if (tokens) client.setCredentials(tokens);
  return client;
}

function loadTokens() {
  if (memoryTokens?.refresh_token || memoryTokens?.access_token) return memoryTokens;
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    memoryTokens = { refresh_token: process.env.GOOGLE_REFRESH_TOKEN };
    return memoryTokens;
  }
  if (fs.existsSync(TOKEN_PATH)) {
    memoryTokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    return memoryTokens;
  }
  return null;
}

function saveTokens(tokens) {
  const previous = loadTokens() || {};
  memoryTokens = {
    ...previous,
    ...tokens,
    refresh_token: tokens.refresh_token || previous.refresh_token,
  };
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(memoryTokens));
}

function supabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  return createClient(url, key);
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

/** Supabase object path from log route_segments (drops Drive root, keeps NC tree). */
function storagePathFromRouteSegments(routeSegments) {
  const prefix = uploadFolder();
  const parts = (routeSegments || []).slice(1).map(safeSegment).filter(Boolean);
  return parts.length ? `${prefix}/${parts.join('/')}` : prefix;
}

function ensureExt(name, ext) {
  return name.toLowerCase().endsWith(ext) ? name : `${name}${ext}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlPage(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: Georgia, serif; max-width: 42rem; margin: 2.5rem auto; padding: 0 1rem; color: #1c1917; }
    a, button { font: inherit; }
    code { font-family: Consolas, monospace; }
    .warn { background: #fef3c7; padding: 0.75rem 1rem; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${body}
</body>
</html>`;
}

function sendHtml(res, status, title, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(htmlPage(title, body));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function authorized() {
  return Boolean(loadTokens()?.refresh_token || loadTokens()?.access_token);
}

export function driveHealthLines() {
  return (
    'Contract uploading:\n' +
    `  GET /drive — authorize and sync.\n` +
    `  Drive folder ${driveFolderId()}\n` +
    `  Supabase bucket ${process.env.SUPABASE_STORAGE_BUCKET || 'Contracts'} / ${uploadFolder()}/\n` +
    `  Redirect URI ${redirectUri()}\n` +
    `  Upload log table ${UPLOAD_LOG_TABLE}\n` +
    '  Storage keys: ascii-safe\n' +
    `  NC allowlist: column B unique codes only\n` +
    '  POST/GET /drive/retry-failed — re-upload rows with status failed\n' +
    '  POST/GET /drive/reconcile-ai?sync_id= — fix ai_extraction on an existing sync\n' +
    '  POST/GET /drive/sync-migration — upload NCs with green F + B2C/B2B2C in migration xlsx\n'
  );
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
    parent_drive_id: row.parentDriveId || null,
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
  if (error) {
    stats.logError = error.message;
    console.error(`${UPLOAD_LOG_TABLE} insert failed:`, error.message);
  }
}

async function listChildren(drive, parentId) {
  const files = [];
  let pageToken;
  const q = `'${String(parentId).replace(/'/g, "\\'")}' in parents and trashed = false`;
  do {
    const res = await drive.files.list({
      q,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size, shortcutDetails, driveId)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: 'allDrives',
    });
    files.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

async function signedInAccount(drive) {
  const about = await drive.about.get({ fields: 'user(emailAddress,displayName)' });
  return about.data.user?.emailAddress || about.data.user?.displayName || 'unknown';
}

async function resolveShortcut(drive, file) {
  if (file.mimeType !== SHORTCUT_MIME || !file.shortcutDetails?.targetId) return file;
  const target = await drive.files.get({
    fileId: file.shortcutDetails.targetId,
    fields: 'id, name, mimeType, modifiedTime, size, shortcutDetails, driveId',
    supportsAllDrives: true,
  });
  return target.data;
}

async function downloadFile(drive, file) {
  const exp = EXPORTS[file.mimeType];
  if (exp) {
    const res = await drive.files.export(
      { fileId: file.id, mimeType: exp.mime },
      { responseType: 'arraybuffer' },
    );
    return { data: Buffer.from(res.data), name: ensureExt(file.name, exp.ext), contentType: exp.mime };
  }
  if (String(file.mimeType || '').startsWith('application/vnd.google-apps.')) {
    return null;
  }
  const res = await drive.files.get(
    { fileId: file.id, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  );
  return {
    data: Buffer.from(res.data),
    name: file.name,
    contentType: file.mimeType || 'application/octet-stream',
  };
}

async function uploadBuffer(supabase, bucket, objectPath, data, contentType) {
  const maxAttempts = Number(process.env.STORAGE_UPLOAD_RETRIES) || 4;
  let lastMsg = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { error } = await supabase.storage.from(bucket).upload(objectPath, data, {
      upsert: true,
      contentType,
    });
    if (!error) return;
    lastMsg = error.message || 'unknown error';
    const retryable = /502|503|504|timeout|fetch failed/i.test(lastMsg);
    if (!retryable || attempt >= maxAttempts) break;
    await new Promise((r) => setTimeout(r, 500 * attempt * attempt));
  }
  throw new Error(`${objectPath}: ${lastMsg}`);
}

function joinRoute(segments) {
  return segments.filter(Boolean).join(' / ');
}

async function walk(drive, supabase, bucket, parentId, prefix, stats, route) {
  let children;
  try {
    children = await listChildren(drive, parentId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stats.failed += 1;
    await recordTransfer(supabase, stats, {
      status: 'failed',
      itemType: 'folder',
      driveFileId: parentId,
      driveName: route.names.at(-1) || stats.rootName,
      sourceFolderRoute: joinRoute(route.names),
      sourceRoute: joinRoute(route.names),
      routeSegments: route.names,
      storageBucket: bucket,
      storagePath: prefix,
      errorMessage: `list: ${message}`,
    });
    console.error(`List failed at ${joinRoute(route.names)}: ${message}`);
    return;
  }

  if (children.length === 0) {
    if (!route.allowed) return;
    const markerPath = `${prefix}/.keep`;
    try {
      await uploadBuffer(supabase, bucket, markerPath, Buffer.from('empty-folder\n'), 'text/plain');
      stats.folders += 1;
      await recordTransfer(supabase, stats, {
        status: 'uploaded',
        itemType: 'file',
        driveName: '.keep',
        parentDriveId: parentId,
        sourceFolderRoute: joinRoute(route.names),
        sourceRoute: joinRoute([...route.names, '.keep']),
        routeSegments: [...route.names, '.keep'],
        storageBucket: bucket,
        storagePath: markerPath,
        mimeType: 'text/plain',
        sizeBytes: 13,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stats.failed += 1;
      await recordTransfer(supabase, stats, {
        status: 'failed',
        itemType: 'folder',
        driveFileId: parentId,
        driveName: route.names.at(-1) || stats.rootName,
        sourceFolderRoute: joinRoute(route.names),
        sourceRoute: joinRoute(route.names),
        routeSegments: route.names,
        storageBucket: bucket,
        storagePath: prefix,
        errorMessage: `empty folder marker: ${message}`,
      });
    }
    return;
  }

  for (const child of children) {
    let file = child;
    try {
      file = await resolveShortcut(drive, child);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stats.failed += 1;
      await recordTransfer(supabase, stats, {
        status: 'failed',
        itemType: 'file',
        driveFileId: child.id,
        driveName: child.name,
        parentDriveId: parentId,
        sourceFolderRoute: joinRoute(route.names),
        sourceRoute: joinRoute([...route.names, child.name || child.id]),
        routeSegments: [...route.names, child.name || child.id],
        storageBucket: bucket,
        mimeType: child.mimeType,
        errorMessage: `shortcut: ${message}`,
      });
      continue;
    }

    const nextNames = [...route.names, file.name || file.id];
    const ncs = ncNumbersInName(file.name || '');
    const matchesAllow = nameMatchesAllowlist(file.name || '', stats.allowlist);
    if (file.mimeType === FOLDER_MIME) {
      if (!route.allowed && ncs.length > 0 && !matchesAllow) {
        stats.skipped += 1;
        const message = `skipped: ${ncs.map((nc) => `NC_${nc}`).join(', ')} is not in column B unique code`;
        console.log(`Skip folder ${joinRoute(nextNames)}: ${message}`);
        await recordTransfer(supabase, stats, {
          status: 'skipped',
          itemType: 'folder',
          driveFileId: file.id,
          driveName: file.name,
          parentDriveId: parentId,
          sourceFolderRoute: joinRoute(route.names),
          sourceRoute: joinRoute(nextNames),
          routeSegments: nextNames,
          storageBucket: bucket,
          mimeType: file.mimeType,
          errorMessage: message,
        });
        continue;
      }
      const childAllowed = route.allowed || matchesAllow;
      if (!childAllowed) {
        await walk(drive, supabase, bucket, file.id, prefix, stats, { names: nextNames, allowed: false });
        continue;
      }
      const folderPrefix = `${prefix}/${safeSegment(file.name)}`;
      stats.folders += 1;
      await recordTransfer(supabase, stats, {
        status: 'listed',
        itemType: 'folder',
        driveFileId: file.id,
        driveName: file.name,
        parentDriveId: parentId,
        sourceFolderRoute: joinRoute(route.names),
        sourceRoute: joinRoute(nextNames),
        routeSegments: nextNames,
        storageBucket: bucket,
        storagePath: folderPrefix,
        mimeType: file.mimeType,
      });
      await walk(drive, supabase, bucket, file.id, folderPrefix, stats, { names: nextNames, allowed: true });
      continue;
    }

    if (!route.allowed && !matchesAllow) {
      if (ncs.length > 0) {
        stats.skipped += 1;
        await recordTransfer(supabase, stats, {
          status: 'skipped',
          itemType: 'file',
          driveFileId: file.id,
          driveName: file.name,
          parentDriveId: parentId,
          sourceFolderRoute: joinRoute(route.names),
          sourceRoute: joinRoute(nextNames),
          routeSegments: nextNames,
          storageBucket: bucket,
          mimeType: file.mimeType,
          errorMessage: `skipped: ${ncs.map((nc) => `NC_${nc}`).join(', ')} is not in column B unique code`,
        });
      }
      continue;
    }

    const sourceFolderRoute = joinRoute(route.names);
    const sourceRoute = joinRoute(nextNames);
    const size = Number(file.size || 0);
    if (size > MAX_FILE_BYTES) {
      stats.skipped += 1;
      const message = `size ${size} bytes exceeds ${MAX_FILE_BYTES}`;
      console.warn(`Skip ${sourceRoute}: ${message}`);
      await recordTransfer(supabase, stats, {
        status: 'skipped',
        itemType: 'file',
        driveFileId: file.id,
        driveName: file.name,
        parentDriveId: parentId,
        sourceFolderRoute,
        sourceRoute,
        routeSegments: nextNames,
        storageBucket: bucket,
        mimeType: file.mimeType,
        sizeBytes: size,
        errorMessage: message,
      });
      continue;
    }

    let downloaded;
    try {
      downloaded = await downloadFile(drive, file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stats.failed += 1;
      console.error(`Download failed ${sourceRoute}: ${message}`);
      await recordTransfer(supabase, stats, {
        status: 'failed',
        itemType: 'file',
        driveFileId: file.id,
        driveName: file.name,
        parentDriveId: parentId,
        sourceFolderRoute,
        sourceRoute,
        routeSegments: nextNames,
        storageBucket: bucket,
        mimeType: file.mimeType,
        sizeBytes: size || null,
        errorMessage: `download: ${message}`,
      });
      continue;
    }
    if (!downloaded) {
      stats.skipped += 1;
      const message = `unsupported Google file type ${file.mimeType || 'unknown'}`;
      console.warn(`Skip ${sourceRoute}: ${message}`);
      await recordTransfer(supabase, stats, {
        status: 'skipped',
        itemType: 'file',
        driveFileId: file.id,
        driveName: file.name,
        parentDriveId: parentId,
        sourceFolderRoute,
        sourceRoute,
        routeSegments: nextNames,
        storageBucket: bucket,
        mimeType: file.mimeType,
        errorMessage: message,
      });
      continue;
    }

    const objectPath = `${prefix}/${safeSegment(downloaded.name)}`;
    try {
      await uploadBuffer(supabase, bucket, objectPath, downloaded.data, downloaded.contentType);
      stats.files += 1;
      console.log(`Uploaded ${objectPath}`);
      await recordTransfer(supabase, stats, {
        status: 'uploaded',
        itemType: 'file',
        driveFileId: file.id,
        driveName: downloaded.name,
        parentDriveId: parentId,
        sourceFolderRoute,
        sourceRoute,
        routeSegments: [...route.names, downloaded.name],
        storageBucket: bucket,
        storagePath: objectPath,
        mimeType: downloaded.contentType,
        sizeBytes: downloaded.data.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stats.failed += 1;
      console.error(`Upload failed ${sourceRoute}: ${message}`);
      await recordTransfer(supabase, stats, {
        status: 'failed',
        itemType: 'file',
        driveFileId: file.id,
        driveName: downloaded.name,
        parentDriveId: parentId,
        sourceFolderRoute,
        sourceRoute,
        routeSegments: [...route.names, downloaded.name],
        storageBucket: bucket,
        storagePath: objectPath,
        mimeType: downloaded.contentType,
        sizeBytes: downloaded.data.length,
        errorMessage: `upload: ${message}`,
      });
    }
  }
}

/**
 * @param {{ allowlist?: Set<string>, allowlistLabel?: string }} [options]
 */
export async function syncDriveToSupabase(options = {}) {
  if (!authorized()) {
    throw new Error('Google Drive is not authorized. Open /drive and sign in.');
  }
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'Contracts';
  const prefix = uploadFolder();
  const auth = oauthClient();
  const drive = google.drive({ version: 'v3', auth });
  const supabase = supabaseClient();
  const stats = {
    files: 0,
    folders: 0,
    skipped: 0,
    failed: 0,
    folder: prefix,
    bucket,
    account: null,
    rootName: null,
    syncId: crypto.randomUUID(),
    logTable: UPLOAD_LOG_TABLE,
    logError: null,
    allowlist: null,
    allowlistCount: 0,
    allowlistSource: options.allowlistLabel || 'csv',
  };
  stats.allowlist = options.allowlist ?? loadAllowedNcNumbers();
  stats.allowlistCount = stats.allowlist.size;
  stats.account = await signedInAccount(drive);

  const rootMeta = await drive.files.get({
    fileId: driveFolderId(),
    fields: 'id, name, mimeType, driveId, shortcutDetails',
    supportsAllDrives: true,
  });
  const root = await resolveShortcut(drive, rootMeta.data);
  stats.rootName = root.name || rootMeta.data.name || null;
  console.log(
    `Drive sync as ${stats.account}: root "${stats.rootName}" (${root.id}) driveId=${root.driveId || 'my-drive'} allowlist=${stats.allowlistCount}`,
  );

  const rootRoute = [stats.rootName || 'Drive'];
  const rootAllowed = nameMatchesAllowlist(stats.rootName || '', stats.allowlist);
  await recordTransfer(supabase, stats, {
    status: 'listed',
    itemType: 'folder',
    driveFileId: root.id,
    driveName: stats.rootName,
    sourceFolderRoute: '',
    sourceRoute: joinRoute(rootRoute),
    routeSegments: rootRoute,
    storageBucket: bucket,
    storagePath: prefix,
    mimeType: root.mimeType,
  });
  await walk(drive, supabase, bucket, root.id, prefix, stats, { names: rootRoute, allowed: rootAllowed });
  if (stats.logError) {
    stats.warning =
      `Upload log was not saved (${stats.logError}). Run contract-uploading/supabase-drive-upload-log.sql in the Supabase SQL editor.`;
    console.warn(stats.warning);
  } else if (stats.files === 0) {
    stats.warning =
      `No files were visible to ${stats.account}. Re-authorize /drive with an account that can open the Episode contract folder.`;
    console.warn(stats.warning);
  }
  if (!stats.logError) {
    try {
      stats.aiExtraction = await reconcileAiExtractionForSync(supabase, UPLOAD_LOG_TABLE, stats.syncId);
    } catch (e) {
      console.error('ai_extraction reconcile failed:', e);
    }
  }
  delete stats.allowlist;
  return stats;
}

/** Upload only NC folders listed as green (column F) + B2C/B2B2C in the migration workbook. */
export async function syncMigrationReviewXlsx() {
  const { allowlist, rows, xlsxPath, jsonPath } = await resolveMigrationGreenAllowlist();
  if (allowlist.size === 0) {
    throw new Error(`No eligible green migration NCs (xlsx: ${xlsxPath || 'n/a'}, json: ${jsonPath || 'n/a'})`);
  }
  const stats = await syncDriveToSupabase({
    allowlist,
    allowlistLabel: 'migration-xlsx-green',
  });
  stats.migrationXlsx = xlsxPath || null;
  stats.migrationAllowlistJson = jsonPath || null;
  stats.migrationNcRows = rows;
  return stats;
}

/**
 * Re-download failed rows from Drive and upload with current safe storage keys.
 * @param {{ sourceSyncId?: string, driveFileIds?: string[], limit?: number }} options
 */
export async function retryFailedUploads(options = {}) {
  if (!authorized()) {
    throw new Error('Google Drive is not authorized. Open /drive and sign in.');
  }
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'Contracts';
  const auth = oauthClient();
  const drive = google.drive({ version: 'v3', auth });
  const supabase = supabaseClient();
  const stats = {
    syncId: crypto.randomUUID(),
    retried: 0,
    uploaded: 0,
    failed: 0,
    skipped: 0,
    account: await signedInAccount(drive),
    logTable: UPLOAD_LOG_TABLE,
    logError: null,
  };

  let query = supabase
    .from(UPLOAD_LOG_TABLE)
    .select('*')
    .eq('status', 'failed')
    .eq('item_type', 'file')
    .not('drive_file_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(options.limit || 500);
  if (options.sourceSyncId) query = query.eq('sync_id', options.sourceSyncId);
  if (options.driveFileIds?.length) query = query.in('drive_file_id', options.driveFileIds);

  const { data: rows, error } = await query;
  if (error) throw new Error(`Load failed uploads: ${error.message}`);
  if (!rows?.length) {
    stats.message = 'no failed file rows to retry';
    return stats;
  }

  for (const row of rows) {
    stats.retried += 1;
    const objectPath = storagePathFromRouteSegments(row.route_segments);
    const routeSegments = row.route_segments || [];
    const sourceFolderRoute = routeSegments.slice(0, -1).join(' / ');
    const sourceRoute = routeSegments.join(' / ');

    try {
      const meta = await drive.files.get({
        fileId: row.drive_file_id,
        fields: 'id, name, mimeType, size',
        supportsAllDrives: true,
      });
      const file = meta.data;
      const size = Number(file.size || row.size_bytes || 0);
      if (size > MAX_FILE_BYTES) {
        stats.skipped += 1;
        await recordTransfer(supabase, stats, {
          status: 'skipped',
          itemType: 'file',
          driveFileId: row.drive_file_id,
          driveName: file.name || row.drive_name,
          sourceFolderRoute,
          sourceRoute,
          routeSegments,
          storageBucket: bucket,
          storagePath: objectPath,
          mimeType: file.mimeType || row.mime_type,
          sizeBytes: size,
          errorMessage: `retry skipped: size ${size} exceeds ${MAX_FILE_BYTES}`,
        });
        continue;
      }
      const downloaded = await downloadFile(drive, file);
      if (!downloaded) {
        stats.skipped += 1;
        await recordTransfer(supabase, stats, {
          status: 'skipped',
          itemType: 'file',
          driveFileId: row.drive_file_id,
          driveName: file.name || row.drive_name,
          sourceFolderRoute,
          sourceRoute,
          routeSegments,
          storageBucket: bucket,
          storagePath: objectPath,
          mimeType: file.mimeType || row.mime_type,
          errorMessage: 'retry skipped: unsupported Google file type',
        });
        continue;
      }
      const finalPath = storagePathFromRouteSegments([
        ...routeSegments.slice(0, -1),
        downloaded.name,
      ]);
      await uploadBuffer(supabase, bucket, finalPath, downloaded.data, downloaded.contentType);
      stats.uploaded += 1;
      await recordTransfer(supabase, stats, {
        status: 'uploaded',
        itemType: 'file',
        driveFileId: row.drive_file_id,
        driveName: downloaded.name,
        sourceFolderRoute,
        sourceRoute,
        routeSegments: [...routeSegments.slice(0, -1), downloaded.name],
        storageBucket: bucket,
        storagePath: finalPath,
        mimeType: downloaded.contentType,
        sizeBytes: downloaded.data.length,
      });
      console.log(`Retry uploaded ${finalPath}`);
    } catch (e) {
      stats.failed += 1;
      const message = e instanceof Error ? e.message : String(e);
      await recordTransfer(supabase, stats, {
        status: 'failed',
        itemType: 'file',
        driveFileId: row.drive_file_id,
        driveName: row.drive_name,
        sourceFolderRoute,
        sourceRoute,
        routeSegments,
        storageBucket: bucket,
        storagePath: objectPath,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        errorMessage: `retry: ${message}`,
      });
      console.error(`Retry failed ${row.drive_name}: ${message}`);
    }
  }
  if (!stats.logError) {
    try {
      stats.aiExtraction = await reconcileAiExtractionForSync(supabase, UPLOAD_LOG_TABLE, stats.syncId);
    } catch (e) {
      console.error('ai_extraction reconcile failed:', e);
    }
  }
  return stats;
}

function checkSyncAuth(req, bodyText) {
  const secret = process.env.EXTRACT_TRIGGER_SECRET;
  if (!secret) return true;
  const header = req.headers['x-extract-secret'];
  const params = new URLSearchParams(bodyText || '');
  const fromQuery = new URL(req.url || '/', 'http://localhost').searchParams.get('secret');
  return header === secret || params.get('secret') === secret || fromQuery === secret;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function homeBody() {
  const ready = authorized() ? 'Google Drive is authorized.' : 'Google Drive is not authorized yet.';
  let account = '';
  if (authorized()) {
    try {
      const drive = google.drive({ version: 'v3', auth: oauthClient() });
      account = `<p>Signed in as <code>${escapeHtml(await signedInAccount(drive))}</code>. Use an account that can open the shared contract folder (for example an Episode address on the file’s share list).</p>`;
    } catch (error) {
      account = `<p>Could not read the Google account: ${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
    }
  }
  const last = lastSync
    ? `<p>Last sync: ${lastSync.ok ? 'ok' : 'failed'} — ${escapeHtml(lastSync.message)}</p>`
    : '';
  return `
    <p>${ready}</p>
    ${account}
    <p>Source folder <code>${driveFolderId()}</code> uploads into Supabase bucket <code>${process.env.SUPABASE_STORAGE_BUCKET || 'Contracts'}</code>, prefix <code>${uploadFolder()}/</code>.</p>
    ${last}
    <p><a href="/drive/auth">Authorize Google Drive</a></p>
    <form method="post" action="/drive/sync">
      <p><label>Sync secret (only if EXTRACT_TRIGGER_SECRET is set)<br><input name="secret" type="password"></label></p>
      <button type="submit">Sync contracts to Supabase</button>
    </form>
    <form method="post" action="/drive/retry-failed">
      <p><label>Retry failed uploads (same secret if set)<br><input name="secret" type="password"></label></p>
      <button type="submit">Retry failed uploads from log</button>
    </form>
    <form method="post" action="/drive/reconcile-ai">
      <p><label>Reconcile AI flags for sync_id (optional query on URL)<br><input name="sync_id" placeholder="e5a3b2a2-..."></label></p>
      <button type="submit">Reconcile ai_extraction</button>
    </form>
    <form method="post" action="/drive/sync-migration">
      <p><label>Migration xlsx sync secret (if set)<br><input name="secret" type="password"></label></p>
      <button type="submit">Sync green migration NCs (xlsx column F)</button>
    </form>`;
}

export async function handleDriveHttp(req, res) {
  const raw = req.url || '/';
  const url = raw.split('?')[0];
  if (!url.startsWith('/drive')) return false;

  try {
    if (url === '/drive' && req.method === 'GET') {
      sendHtml(res, 200, 'Contract uploading', await homeBody());
      return true;
    }

    if (url === '/drive/auth' && req.method === 'GET') {
      const state = crypto.randomBytes(16).toString('hex');
      pendingStates.add(state);
      const auth = oauthClient();
      const link = auth.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [DRIVE_SCOPE],
        state,
      });
      res.writeHead(302, { Location: link });
      res.end();
      return true;
    }

    if (url === '/drive/oauth/callback' && req.method === 'GET') {
      const query = new URL(raw, 'http://localhost').searchParams;
      const state = query.get('state');
      const code = query.get('code');
      const err = query.get('error');
      if (err) {
        sendHtml(res, 400, 'Drive authorization failed', `<p>${escapeHtml(err)}</p>`);
        return true;
      }
      if (!state || !pendingStates.has(state) || !code) {
        sendHtml(res, 400, 'Drive authorization failed', '<p>Missing or unknown OAuth state.</p>');
        return true;
      }
      pendingStates.delete(state);
      const auth = oauthClient();
      const { tokens } = await auth.getToken(code);
      saveTokens(tokens);
      const refreshNote = tokens.refresh_token
        ? `<div class="warn"><p>Copy this refresh token into Render as <code>GOOGLE_REFRESH_TOKEN</code> so the next deploy stays signed in.</p><p><code>${escapeHtml(tokens.refresh_token)}</code></p></div>`
        : '<p>Google did not return a new refresh token. The existing token is still in use.</p>';
      sendHtml(
        res,
        200,
        'Drive authorized',
        `${refreshNote}<p><a href="/drive">Back to sync</a></p>`,
      );
      return true;
    }

    if (url === '/drive/sync' && (req.method === 'POST' || req.method === 'GET')) {
      const bodyText = req.method === 'POST' ? await readBody(req) : '';
      if (!checkSyncAuth(req, bodyText)) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return true;
      }
      if (syncRunning) {
        sendJson(res, 409, { ok: false, error: 'sync_already_running' });
        return true;
      }
      syncRunning = true;
      const started = `Sync started into ${process.env.SUPABASE_STORAGE_BUCKET || 'Contracts'}/${uploadFolder()}`;
      const formPost = (req.headers['content-type'] || '').includes('application/x-www-form-urlencoded');
      if (formPost) sendHtml(res, 202, 'Sync started', `<p>${escapeHtml(started)}</p><p>Progress is in the Render logs. <a href="/drive">Back</a></p>`);
      else sendJson(res, 202, { ok: true, accepted: true, message: started });
      syncDriveToSupabase()
        .then((stats) => {
          lastSync = { ok: true, message: JSON.stringify(stats), at: new Date().toISOString() };
          console.log('Drive sync finished', stats);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          lastSync = { ok: false, message, at: new Date().toISOString() };
          console.error('Drive sync failed:', message);
        })
        .finally(() => {
          syncRunning = false;
        });
      return true;
    }

    if (url === '/drive/sync-migration' && (req.method === 'POST' || req.method === 'GET')) {
      const bodyText = req.method === 'POST' ? await readBody(req) : '';
      if (!checkSyncAuth(req, bodyText)) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return true;
      }
      if (syncRunning) {
        sendJson(res, 409, { ok: false, error: 'sync_already_running' });
        return true;
      }
      syncRunning = true;
      const started =
        'Migration xlsx sync started (green column F, B2C/B2B2C only)';
      const formPost = (req.headers['content-type'] || '').includes('application/x-www-form-urlencoded');
      if (formPost) {
        sendHtml(
          res,
          202,
          'Migration sync started',
          `<p>${escapeHtml(started)}</p><p>Progress is in the Render logs. <a href="/drive">Back</a></p>`,
        );
      } else {
        sendJson(res, 202, { ok: true, accepted: true, message: started });
      }
      syncMigrationReviewXlsx()
        .then((stats) => {
          lastSync = { ok: true, message: JSON.stringify(stats), at: new Date().toISOString() };
          console.log('Migration xlsx sync finished', stats);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          lastSync = { ok: false, message, at: new Date().toISOString() };
          console.error('Migration xlsx sync failed:', message);
        })
        .finally(() => {
          syncRunning = false;
        });
      return true;
    }

    if (url === '/drive/retry-failed' && (req.method === 'POST' || req.method === 'GET')) {
      const bodyText = req.method === 'POST' ? await readBody(req) : '';
      if (!checkSyncAuth(req, bodyText)) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return true;
      }
      if (syncRunning) {
        sendJson(res, 409, { ok: false, error: 'sync_already_running' });
        return true;
      }
      const query = new URL(raw, 'http://localhost').searchParams;
      const sourceSyncId = query.get('sync_id') || undefined;
      const driveFileIds = query.get('drive_file_ids')?.split(',').map((s) => s.trim()).filter(Boolean);
      syncRunning = true;
      const started = 'Retry of failed Drive uploads started';
      const formPost = (req.headers['content-type'] || '').includes('application/x-www-form-urlencoded');
      if (formPost) {
        sendHtml(res, 202, 'Retry started', `<p>${escapeHtml(started)}</p><p>Check contract_drive_uploads for new rows. <a href="/drive">Back</a></p>`);
      } else {
        sendJson(res, 202, { ok: true, accepted: true, message: started });
      }
      retryFailedUploads({ sourceSyncId, driveFileIds })
        .then((stats) => {
          lastSync = { ok: true, message: JSON.stringify(stats), at: new Date().toISOString() };
          console.log('Drive retry finished', stats);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          lastSync = { ok: false, message, at: new Date().toISOString() };
          console.error('Drive retry failed:', message);
        })
        .finally(() => {
          syncRunning = false;
        });
      return true;
    }

    if (url === '/drive/reconcile-ai' && (req.method === 'POST' || req.method === 'GET')) {
      const bodyText = req.method === 'POST' ? await readBody(req) : '';
      if (!checkSyncAuth(req, bodyText)) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return true;
      }
      const query = new URL(raw, 'http://localhost').searchParams;
      const params = new URLSearchParams(bodyText || '');
      const syncId =
        query.get('sync_id')?.trim() ||
        params.get('sync_id')?.trim() ||
        process.env.DRIVE_LAST_SYNC_ID?.trim();
      if (!syncId) {
        sendJson(res, 400, { ok: false, error: 'sync_id required' });
        return true;
      }
      try {
        const supabase = supabaseClient();
        const result = await reconcileAiExtractionForSync(supabase, UPLOAD_LOG_TABLE, syncId);
        sendJson(res, 200, { ok: true, sync_id: syncId, ...result });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        sendJson(res, 500, { ok: false, error: message });
      }
      return true;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Drive route failed:', message);
    if (!res.headersSent) sendHtml(res, 500, 'Contract uploading', `<p>${escapeHtml(message)}</p>`);
    return true;
  }

  sendHtml(res, 404, 'Contract uploading', '<p>Not found.</p>');
  return true;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const port = Number(process.env.PORT) || 3000;
  http.createServer((req, res) => {
    handleDriveHttp(req, res).then((handled) => {
      if (handled) return;
      if ((req.url || '/').split('?')[0] === '/health' || (req.url || '/') === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(driveHealthLines());
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found\n');
    });
  }).listen(port, '0.0.0.0', () => {
    console.log(`Contract uploading listening on ${port}`);
  });
}
