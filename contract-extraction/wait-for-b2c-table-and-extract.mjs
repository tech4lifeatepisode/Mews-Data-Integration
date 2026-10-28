/**
 * Poll until Customers_Contracts_Extraction_28_10_2026_B2C exists, then run extraction batches.
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { runB2c2810DriveExtraction, B2C_28_10_EXTRACTION_TABLE } from './extract-b2c-28-10-2026.mjs';

const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
if (!process.env.SUPABASE_SECRET_KEY && fs.existsSync(transcript)) {
  const text = fs.readFileSync(transcript, 'utf8');
  const sb = [...text.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];
  if (sb) process.env.SUPABASE_SECRET_KEY = sb;
}
if (!process.env.OPENAI_API_KEY && fs.existsSync(transcript)) {
  const text = fs.readFileSync(transcript, 'utf8');
  const openai = [...text.matchAll(/OPENAI_API_KEY=(sk-proj-[A-Za-z0-9_\-]+)/g)].at(-1)?.[1];
  if (openai) process.env.OPENAI_API_KEY = openai;
}
process.env.SUPABASE_URL ||= 'https://jujvtuyksxkoclegjznb.supabase.co';
process.env.MAX_EXTRACTION_FILES ||= '8';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function tableReady() {
  const { error } = await sb.from(B2C_28_10_EXTRACTION_TABLE).select('id').limit(1);
  return !error || !/schema cache|does not exist/i.test(error.message);
}

const maxWaitMin = Number(process.env.B2C_TABLE_WAIT_MINUTES) || 30;
const deadline = Date.now() + maxWaitMin * 60 * 1000;
while (Date.now() < deadline) {
  if (await tableReady()) break;
  console.log(`Waiting for table ${B2C_28_10_EXTRACTION_TABLE}… (run contract-analysis/supabase-customers-contracts-extraction-28-10-2026-b2c.sql in Supabase SQL editor)`);
  await new Promise((r) => setTimeout(r, 15_000));
}
if (!(await tableReady())) {
  console.error('Table still missing; aborting.');
  process.exit(1);
}

console.log('Table ready; starting extraction…');
const maxRounds = Number(process.env.B2C_EXTRACTION_MAX_ROUNDS) || 200;
for (let round = 1; round <= maxRounds; round += 1) {
  console.log(`\n=== round ${round} ===`);
  const result = await runB2c2810DriveExtraction({ skipNcAlreadyInTable: true });
  console.log(JSON.stringify(result, null, 2));
  if (result.pending === 0) break;
  if (result.success === 0 && result.failed === 0) break;
}

const { count } = await sb.from(B2C_28_10_EXTRACTION_TABLE).select('*', { count: 'exact', head: true });
console.log(`Done. Rows in ${B2C_28_10_EXTRACTION_TABLE}:`, count);
