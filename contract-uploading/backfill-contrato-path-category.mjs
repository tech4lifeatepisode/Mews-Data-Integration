/**
 * Fix path_category for rows under CONTRATO/ (Spanish folder layout on Drive).
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { reconcileAiExtractionAll } from './upload-route-classify.mjs';

const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
const text = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  [...text.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];
const sb = createClient('https://jujvtuyksxkoclegjznb.supabase.co', key);

const { data: rows, error } = await sb
  .from('contract_drive_uploads')
  .select('id,storage_path,path_category,file_format,nc_number')
  .eq('item_type', 'file')
  .ilike('storage_path', '%/CONTRATO/%');
if (error) throw error;

let updated = 0;
for (const row of rows || []) {
  if (row.path_category === 'Contracts') continue;
  const { error: uerr } = await sb
    .from('contract_drive_uploads')
    .update({ path_category: 'Contracts' })
    .eq('id', row.id);
  if (uerr) throw uerr;
  updated += 1;
}

const recon = await reconcileAiExtractionAll(sb, 'contract_drive_uploads');
console.log(JSON.stringify({ contratoRows: rows?.length || 0, pathCategoryFixed: updated, recon }, null, 2));
