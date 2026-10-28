/**
 * Wait for Render deploy (health lists /extract-b2c-28-10-2026), then POST to start extraction.
 */
const base = (process.env.RENDER_HEALTH_URL || 'https://contract-extraction-joyy.onrender.com').replace(
  /\/$/,
  '',
);
const secret = process.env.EXTRACT_TRIGGER_SECRET || '';
const maxMin = Number(process.env.RENDER_DEPLOY_WAIT_MINUTES) || 25;
const deadline = Date.now() + maxMin * 60 * 1000;

while (Date.now() < deadline) {
  const health = await fetch(`${base}/health`);
  const text = await health.text();
  if (text.includes('extract-b2c-28-10-2026')) {
    console.log('Render has B2C extraction route; triggering…');
    const headers = { Accept: 'application/json' };
    if (secret) headers['X-Extract-Secret'] = secret;
    const res = await fetch(`${base}/extract-b2c-28-10-2026`, { method: 'POST', headers });
    console.log(res.status, await res.text());
    process.exit(res.ok ? 0 : 1);
  }
  console.log('Waiting for deploy…', new Date().toISOString());
  await new Promise((r) => setTimeout(r, 30_000));
}
console.error('Timed out waiting for Render deploy.');
process.exit(1);
