/**
 * Upload Contracts to upload 28.10.2026 B2C → Supabase; Drive backfill for NCs missing contract PDF/DOC.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { uploadLocalB2cBatch } from './upload-local-b2c-batch.mjs';
import { syncDriveToSupabase } from './drive-http.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '.env') });
dotenv.config({ path: path.join(here, '..', 'contract-extraction', '.env') });

const LOCAL = path.join(here, 'Contracts to upload 28.10.2026 B2C');
const REPORT = path.join(here, 'upload-b2c-28-10-2026-report.json');

if (!fs.existsSync(LOCAL)) {
  throw new Error(`Missing folder: ${LOCAL}`);
}

console.log('Local upload → Supabase Storage…');
const local = await uploadLocalB2cBatch(LOCAL, { batchLabel: '28.10.2026 B2C' });
console.log(
  `Local done: ${local.files} files, ${local.failed} failed, ${local.skipped} skipped, ${local.ncFolders} NC folders`,
);

const report = { local, driveSync: null, driveSyncError: null };

const needDrive = local.missingContractPdfOrDoc.filter((r) => r.nc_number != null);
if (needDrive.length) {
  console.log(`Drive backfill for ${needDrive.length} NC(s) missing PDF/DOC in 02. CONTRACT locally…`);
  const allowlist = new Set(needDrive.map((r) => String(r.nc_number)));
  try {
    report.driveSync = await syncDriveToSupabase({
      allowlist,
      allowlistLabel: 'b2c-28-10-2026-missing-contract',
    });
    console.log(
      `Drive sync: ${report.driveSync.files} files, ${report.driveSync.skipped} skipped, ${report.driveSync.failed} failed`,
    );
  } catch (error) {
    report.driveSyncError = error instanceof Error ? error.message : String(error);
    console.error('Drive sync failed:', report.driveSyncError);
    console.error(
      'Authorize Google Drive (GOOGLE_REFRESH_TOKEN or contract-uploading/.google-token.json) or run POST /drive/sync on Render with those NCs on Drive.',
    );
  }
} else {
  console.log('All NC folders have a contract PDF or DOCX locally — no Drive backfill needed.');
}

fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(`Report: ${REPORT}`);
