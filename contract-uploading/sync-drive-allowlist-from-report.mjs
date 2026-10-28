/**
 * Drive → Supabase for NCs listed in upload-b2c-28-10-2026-report.json (missing local contract).
 *
 *   node sync-drive-allowlist-from-report.mjs
 *   BASE_URL=https://contract-extraction-joyy.onrender.com node sync-drive-allowlist-from-report.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { syncDriveToSupabase } from './drive-http.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '.env') });
dotenv.config({ path: path.join(here, '..', 'contract-extraction', '.env') });

const reportPath = path.join(here, 'upload-b2c-28-10-2026-report.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const ncs = (report.local?.missingContractPdfOrDoc || [])
  .map((r) => r.nc_number)
  .filter((n) => n != null);

if (!ncs.length) {
  console.log('No NCs need Drive backfill.');
  process.exit(0);
}

const allowlist = new Set(ncs.map(String));
const base = (process.env.BASE_URL || '').replace(/\/$/, '');

if (base) {
  const url = `${base}/drive/sync-allowlist?ncs=${ncs.join(',')}`;
  console.log('POST', url);
  const res = await fetch(url, { method: 'POST' });
  const text = await res.text();
  console.log(res.status, text.slice(0, 500));
  process.exit(res.ok ? 0 : 1);
}

console.log(`Local Drive sync for NCs: ${ncs.join(', ')}`);
const stats = await syncDriveToSupabase({ allowlist, allowlistLabel: 'b2c-28-10-2026-missing-contract' });
console.log(JSON.stringify(stats, null, 2));
