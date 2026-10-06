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
  const cleaned = String(name || 'untitled').replace(/[\\#?]/g, '_').replace(/^\/+|\/+$/g, '');
  return cleaned || 'untitled';
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
    `  Redirect URI ${redirectUri()}\n`
  );
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
  const { error } = await supabase.storage.from(bucket).upload(objectPath, data, {
    upsert: true,
    contentType,
  });
  if (error) throw new Error(`${objectPath}: ${error.message}`);
}

async function walk(drive, supabase, bucket, parentId, prefix, stats) {
  const children = await listChildren(drive, parentId);
  if (children.length === 0) {
    await uploadBuffer(supabase, bucket, `${prefix}/.keep`, Buffer.from('empty-folder\n'), 'text/plain');
    stats.folders += 1;
    return;
  }
  for (const child of children) {
    const file = await resolveShortcut(drive, child);
    if (file.mimeType === FOLDER_MIME) {
      stats.folders += 1;
      await walk(drive, supabase, bucket, file.id, `${prefix}/${safeSegment(file.name)}`, stats);
      continue;
    }
    const size = Number(file.size || 0);
    if (size > MAX_FILE_BYTES) {
      stats.skipped += 1;
      console.warn(`Skip ${file.name}: ${size} bytes exceeds ${MAX_FILE_BYTES}`);
      continue;
    }
    const downloaded = await downloadFile(drive, file);
    if (!downloaded) {
      stats.skipped += 1;
      console.warn(`Skip unsupported Google file ${file.name} (${file.mimeType})`);
      continue;
    }
    const objectPath = `${prefix}/${safeSegment(downloaded.name)}`;
    await uploadBuffer(supabase, bucket, objectPath, downloaded.data, downloaded.contentType);
    stats.files += 1;
    console.log(`Uploaded ${objectPath}`);
  }
}

export async function syncDriveToSupabase() {
  if (!authorized()) {
    throw new Error('Google Drive is not authorized. Open /drive and sign in.');
  }
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'Contracts';
  const prefix = uploadFolder();
  const auth = oauthClient();
  const drive = google.drive({ version: 'v3', auth });
  const supabase = supabaseClient();
  const stats = { files: 0, folders: 0, skipped: 0, folder: prefix, bucket, account: null, rootName: null };
  stats.account = await signedInAccount(drive);

  const rootMeta = await drive.files.get({
    fileId: driveFolderId(),
    fields: 'id, name, mimeType, driveId, shortcutDetails',
    supportsAllDrives: true,
  });
  const root = await resolveShortcut(drive, rootMeta.data);
  stats.rootName = root.name || rootMeta.data.name || null;
  console.log(
    `Drive sync as ${stats.account}: root "${stats.rootName}" (${root.id}) driveId=${root.driveId || 'my-drive'}`,
  );

  await uploadBuffer(
    supabase,
    bucket,
    `${prefix}/.keep`,
    Buffer.from('Contracts fetched from Google Drive.\n'),
    'text/plain',
  );
  await walk(drive, supabase, bucket, root.id, prefix, stats);
  if (stats.files === 0) {
    stats.warning =
      `No files were visible to ${stats.account}. Re-authorize /drive with an account that can open the Episode contract folder.`;
    console.warn(stats.warning);
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
