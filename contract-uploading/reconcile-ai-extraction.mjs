import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { reconcileAiExtractionForSync } from './upload-route-classify.mjs';

const syncId = process.argv[2] || process.env.SYNC_ID;
if (!syncId) {
  console.error('Usage: node reconcile-ai-extraction.mjs <sync_id>');
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);
const result = await reconcileAiExtractionForSync(supabase, 'contract_drive_uploads', syncId);
console.log(JSON.stringify(result, null, 2));
