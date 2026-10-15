/** Upload Final Format CSVs to Supabase Storage (backup when DB tables not created yet). */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'contract-analysis', 'External Data Sources');
const FILES = [
  'Final Format_Current Housemonk data 15.10.2026.csv',
  'Final Format_Current Seguirmento data 15.10.2026.csv',
];
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'Contracts';
const PREFIX = 'analysis-imports/final-format-15-10-2026';

const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
const text = fs.readFileSync(transcript, 'utf8');
const key = [...text.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)[0];
const supabase = createClient('https://jujvtuyksxkoclegjznb.supabase.co', key);

for (const name of FILES) {
  const filePath = path.join(ROOT, name);
  const body = fs.readFileSync(filePath);
  const objectPath = `${PREFIX}/${name}`;
  const { error } = await supabase.storage.from(BUCKET).upload(objectPath, body, {
    contentType: 'text/csv',
    upsert: true,
  });
  if (error) throw new Error(`${objectPath}: ${error.message}`);
  console.log(`storage://${BUCKET}/${objectPath}`);
}
