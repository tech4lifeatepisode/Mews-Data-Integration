/**
 * POST /extract-rent-products-v6-v7 on Render (after deploy).
 *
 *   node contract-extraction/trigger-rent-products-v6-v7-on-render.mjs
 *   node contract-extraction/trigger-rent-products-v6-v7-on-render.mjs nc=2172,2037
 *   node contract-extraction/trigger-rent-products-v6-v7-on-render.mjs pending
 *
 * Prefer poll-render-and-trigger-rent-products-v6-v7.mjs to wait for deploy first.
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
const headers = { Accept: 'application/json' };
if (secret) headers['X-Extract-Secret'] = secret;

let qs = process.argv.slice(2).filter((a) => !a.startsWith('pending')).join('&');
if (process.argv.includes('pending')) {
  const { nc_numbers: ncs } = JSON.parse(
    fs.readFileSync(path.join(here, 'rent-products-v6-v7-pending-ncs.json'), 'utf8'),
  );
  qs = `nc=${ncs.join(',')}`;
}

const url = `${base}/extract-rent-products-v6-v7${qs ? `?${qs}` : ''}`;

const health = await fetch(`${base}/health`);
const healthText = await health.text();
if (!healthText.includes('extract-rent-products-v6-v7')) {
  console.error(
    'Render health does not list /extract-rent-products-v6-v7 yet — run poll-render-and-trigger-rent-products-v6-v7.mjs or deploy main first.',
  );
  process.exit(1);
}

console.log('POST', url);
const res = await fetch(url, { method: 'POST', headers });
console.log(res.status, await res.text());
