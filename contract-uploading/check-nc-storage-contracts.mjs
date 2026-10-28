import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const ncs = process.argv.slice(2).map(Number).filter(Boolean);
if (!ncs.length) ncs.push(2091, 2102, 2118, 2122, 2152, 2155, 2156, 2157, 2163, 2167, 2174, 2185, 2189);

const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
const text = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  [...text.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];
const sb = createClient(process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co', key);

const { data, error } = await sb
  .from('contract_drive_uploads')
  .select('nc_number,status,path_category,file_format,drive_name,storage_path,ai_extraction,created_at,sync_id')
  .in(
    'nc_number',
    ncs.map(String),
  )
  .eq('status', 'uploaded')
  .order('created_at', { ascending: false });

if (error) throw error;

const byNc = Object.fromEntries(ncs.map((n) => [n, { contracts: [], other: [] }]));
for (const row of data || []) {
  const nc = Number(row.nc_number);
  if (!byNc[nc]) continue;
  const item = {
    name: row.drive_name,
    fmt: row.file_format,
    path: row.storage_path,
    ai: row.ai_extraction,
    sync: row.sync_id,
  };
  if (row.path_category === 'Contracts' && row.drive_name !== '.keep') {
    byNc[nc].contracts.push(item);
  } else if (row.path_category === 'Contracts') {
    byNc[nc].emptyContractMarker = true;
  } else {
    byNc[nc].other.push(item);
  }
}

for (const nc of ncs) {
  const c = byNc[nc].contracts.filter((x) => x.fmt === 'PDF' || x.fmt === 'DOCX');
  byNc[nc].hasExtractableContract = c.length > 0;
  byNc[nc].extractableCount = c.length;
}

console.log(JSON.stringify(byNc, null, 2));
