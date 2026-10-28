/**
 * Run B2C 28-10 extraction in batches until no pending files remain (or stall).
 */
import fs from 'fs';
import { runB2c2810DriveExtraction } from './extract-b2c-28-10-2026.mjs';

const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SECRET_KEY && fs.existsSync(transcript)) {
  const text = fs.readFileSync(transcript, 'utf8');
  const sb = [...text.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];
  if (sb) process.env.SUPABASE_SECRET_KEY = sb;
}
if (!process.env.SUPABASE_URL) {
  process.env.SUPABASE_URL = 'https://jujvtuyksxkoclegjznb.supabase.co';
}
if (!process.env.OPENAI_API_KEY && fs.existsSync(transcript)) {
  const text = fs.readFileSync(transcript, 'utf8');
  const openai = [...text.matchAll(/OPENAI_API_KEY=(sk-proj-[A-Za-z0-9_\-]+)/g)].at(-1)?.[1];
  if (openai) process.env.OPENAI_API_KEY = openai;
}
if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY not set (env or transcript). Use Render /extract-b2c-28-10-2026 after deploy.');
  process.exit(1);
}

process.env.MAX_EXTRACTION_FILES = process.env.MAX_EXTRACTION_FILES || '8';

const maxRounds = Number(process.env.B2C_EXTRACTION_MAX_ROUNDS) || 200;
let round = 0;
let lastPending = Infinity;

while (round < maxRounds) {
  round += 1;
  console.log(`\n=== B2C extraction round ${round} ===`);
  const result = await runB2c2810DriveExtraction({ skipNcAlreadyInTable: true });
  console.log(JSON.stringify(result, null, 2));
  if (result.pending === 0 && result.success === 0 && result.failed === 0) break;
  if (result.pending === 0) break;
  if (result.pending >= lastPending && result.success === 0) {
    console.warn('No progress this round; stopping.');
    break;
  }
  lastPending = result.pending;
}
