/**
 * POST /extract-b2c-28-10-2026 on Render (after deploy).
 * Optional: EXTRACT_TRIGGER_SECRET or X-Extract-Secret in env.
 */
const base = (process.env.RENDER_HEALTH_URL || 'https://contract-extraction-joyy.onrender.com').replace(
  /\/$/,
  '',
);
const secret = process.env.EXTRACT_TRIGGER_SECRET || '';
const headers = { Accept: 'application/json' };
if (secret) headers['X-Extract-Secret'] = secret;

const health = await fetch(`${base}/health`);
const healthText = await health.text();
if (!healthText.includes('extract-b2c-28-10-2026')) {
  console.error('Render health does not list /extract-b2c-28-10-2026 yet — deploy main with latest server.mjs first.');
  process.exit(1);
}

const res = await fetch(`${base}/extract-b2c-28-10-2026`, { method: 'POST', headers });
console.log(res.status, await res.text());
