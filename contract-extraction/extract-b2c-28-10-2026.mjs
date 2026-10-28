/**
 * B2C upload batch 28 Oct 2026 → Customers_Contracts_Extraction_28_10_2026_B2C
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runDriveAiExtraction } from './extract-drive-ai.mjs';

const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
if (fs.existsSync(transcript)) {
  const text = fs.readFileSync(transcript, 'utf8');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SECRET_KEY) {
    const sb = [...text.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];
    if (sb) process.env.SUPABASE_SECRET_KEY = sb;
  }
  if (!process.env.OPENAI_API_KEY) {
    const openai = [...text.matchAll(/OPENAI_API_KEY=(sk-proj-[A-Za-z0-9_\-]+)/g)].at(-1)?.[1];
    if (openai) process.env.OPENAI_API_KEY = openai;
  }
}
process.env.SUPABASE_URL ||= 'https://jujvtuyksxkoclegjznb.supabase.co';

export const B2C_28_10_EXTRACTION_TABLE = 'Customers_Contracts_Extraction_28_10_2026_B2C';

const here = path.dirname(fileURLToPath(import.meta.url));
const ALLOWLIST_JSON = path.join(here, 'b2c-28-10-2026-nc-allowlist.json');

export function loadB2c2810NcAllowlist() {
  const raw = JSON.parse(fs.readFileSync(ALLOWLIST_JSON, 'utf8'));
  const nums = (Array.isArray(raw) ? raw : raw.ncs || []).map((n) => String(n).trim()).filter(Boolean);
  return new Set([...new Set(nums)]);
}

/** @param {{ skipNcAlreadyInTable?: boolean }} [options] */
export async function runB2c2810DriveExtraction(options = {}) {
  const ncAllowlist = loadB2c2810NcAllowlist();
  return runDriveAiExtraction({
    extractionTable: B2C_28_10_EXTRACTION_TABLE,
    ncAllowlist,
    skipNcAlreadyInExtractionTable: options.skipNcAlreadyInTable !== false,
  });
}

const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isCli) {
  const force = process.argv.includes('--force');
  runB2c2810DriveExtraction({ skipNcAlreadyInTable: !force })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
