/**
 * Fire the Render job for all 107 V3 B2B NCs (after deploying server.mjs + reextract-v3-b2b-from-drive.mjs).
 *
 *   set RENDER_EXTRACT_URL=https://contract-extraction-joyy.onrender.com/extract-v3-b2b-contracts
 *   set EXTRACT_TRIGGER_SECRET=...
 *   node trigger-v3-b2b-reextract-on-render.mjs
 */
const base =
  process.env.RENDER_EXTRACT_URL ||
  'https://contract-extraction-joyy.onrender.com/extract-v3-b2b-contracts';
const url = `${base}${base.includes('?') ? '&' : '?'}rebuild=1`;
const headers = {};
if (process.env.EXTRACT_TRIGGER_SECRET) {
  headers['X-Extract-Secret'] = process.env.EXTRACT_TRIGGER_SECRET;
}

const res = await fetch(url, { method: 'GET', headers });
const text = await res.text();
console.log(res.status, text);
