/**
 * Smoke test: repo layout + live Render endpoints (no secrets required).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const renderBase = process.env.RENDER_HEALTH_URL || 'https://contract-extraction-joyy.onrender.com';

const results = [];

function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  const mark = pass ? 'OK' : 'FAIL';
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

check('contract-uploading/drive-http.mjs', exists('contract-uploading/drive-http.mjs'));
check('contract-extraction/server.mjs', exists('contract-extraction/server.mjs'));
check('contract-analysis/extract_no_shows.py', exists('contract-analysis/extract_no_shows.py'));
check('root package.json start script', (() => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return pkg.scripts?.start?.includes('contract-extraction');
})());

try {
  await import(pathToFileURL(path.join(root, 'contract-uploading', 'drive-http.mjs')).href);
  check('import contract-uploading', true);
} catch (e) {
  check('import contract-uploading', false, e.message);
}

const healthUrl = `${renderBase}/health`;
let healthText = '';
try {
  const res = await fetch(healthUrl, { signal: AbortSignal.timeout(45000) });
  healthText = await res.text();
  check('Render GET /health', res.ok, `${res.status}`);
  check('health mentions extraction', healthText.includes('Contract extraction'));
  check('health mentions Drive upload', healthText.includes('Contract uploading') && healthText.includes('/drive'));
  check('health Supabase bucket Contracts', healthText.includes('Contracts'));
} catch (e) {
  check('Render GET /health', false, e.message);
}

try {
  const res = await fetch(`${renderBase}/drive`, { signal: AbortSignal.timeout(45000) });
  const html = await res.text();
  check('Render GET /drive', res.ok, `${res.status}`);
  if (html.includes('Google Drive is authorized')) {
    check('Google Drive OAuth', true, 'authorized on server');
  } else if (html.includes('not authorized')) {
    check('Google Drive OAuth', false, 'open /drive and authorize');
  } else {
    check('Google Drive OAuth', false, 'unexpected /drive page');
  }
} catch (e) {
  check('Render GET /drive', false, e.message);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
