/**
 * Wait for Render deploy (health lists /extract-rent-products-v6-v7), then POST to start job.
 *
 *   node contract-extraction/poll-render-and-trigger-rent-products-v6-v7.mjs
 *   node contract-extraction/poll-render-and-trigger-rent-products-v6-v7.mjs pending
 *     → only NCs in rent-products-v6-v7-pending-ncs.json (contract AI)
 *   node contract-extraction/poll-render-and-trigger-rent-products-v6-v7.mjs full
 *     → all V6 ∪ V7 extraction rows (604)
 *
 * Env: RENDER_HEALTH_URL, EXTRACT_TRIGGER_SECRET, RENDER_DEPLOY_WAIT_MINUTES (default 25)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = (process.env.RENDER_HEALTH_URL || 'https://contract-extraction-joyy.onrender.com').replace(
  /\/$/,
  '',
);
const secret = process.env.EXTRACT_TRIGGER_SECRET || '';
const maxMin = Number(process.env.RENDER_DEPLOY_WAIT_MINUTES) || 25;
const deadline = Date.now() + maxMin * 60 * 1000;

const mode = (process.argv[2] || 'full').toLowerCase();
let query = '';
if (mode === 'pending') {
  const pendingPath = path.join(here, 'rent-products-v6-v7-pending-ncs.json');
  const { nc_numbers: ncs } = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
  query = `nc=${ncs.join(',')}`;
  console.log(`Mode pending: ${ncs.length} NCs`);
} else if (mode !== 'full') {
  console.error('Usage: poll-render-and-trigger-rent-products-v6-v7.mjs [full|pending]');
  process.exit(1);
} else {
  console.log('Mode full: all V6 ∪ V7 extraction rows on Render');
}

const routeNeedle = 'extract-rent-products-v6-v7';

while (Date.now() < deadline) {
  const health = await fetch(`${base}/health`);
  const text = await health.text();
  if (text.includes(routeNeedle)) {
    console.log('Render has rent-products route; triggering…');
    const headers = { Accept: 'application/json' };
    if (secret) headers['X-Extract-Secret'] = secret;
    const url = `${base}/extract-rent-products-v6-v7${query ? `?${query}` : ''}`;
    console.log('POST', url);
    const res = await fetch(url, { method: 'POST', headers });
    const body = await res.text();
    console.log(res.status, body);
    process.exit(res.ok || res.status === 202 ? 0 : 1);
  }
  console.log('Waiting for deploy…', new Date().toISOString());
  await new Promise((r) => setTimeout(r, 30_000));
}
console.error('Timed out waiting for Render deploy.');
process.exit(1);
