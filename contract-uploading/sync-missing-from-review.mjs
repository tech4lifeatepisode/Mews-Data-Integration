/**
 * Sync NC folders missing from review sheets (644/645 allowlist) from both Drive roots
 * into Supabase Storage, logged in contract_drive_uploads.
 * Run on Render (npm run sync-missing-from-review) or locally with the same env vars.
 */
import { syncMissingFromReviewNcFolders } from './drive-http.mjs';

const results = await syncMissingFromReviewNcFolders();
console.log('SYNC_DONE');
console.log(JSON.stringify(results, null, 2));
