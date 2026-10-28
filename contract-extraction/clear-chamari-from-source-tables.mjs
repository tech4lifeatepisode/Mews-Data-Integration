/**
 * Null CHAMARI / B42861468 on Partner Company fields in Supabase source tables.
 *   node clear-chamari-from-source-tables.mjs [--dry-run]
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { isChamariEntity } from './chamari-strip.mjs';

const TABLES = [
  'Customers_Contracts_Extraction_12_10_2026',
  'Final_Format_Customers_Contracts_Extraction_15_10_2026',
  'V2_Final_Format_All_Fields_Match_Mews_Import_19_10_2026',
  'V3_Final_B2B_All_Fields_Match_Mews_Import_20_10_2026',
];

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '.env') });
const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
const transcriptText = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  [...transcriptText.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];
const url = process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co';
if (!key) throw new Error('Missing Supabase service key');
const sb = createClient(url, key);
const dryRun = process.argv.includes('--dry-run');

async function fetchAll(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('id,nc_number,Partner Company,Company Id,Tax Identification Number').range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function main() {
  const summary = {};
  for (const table of TABLES) {
    let rows;
    try {
      rows = await fetchAll(table);
    } catch (e) {
      summary[table] = { error: e.message };
      continue;
    }
    let cleared = 0;
    for (const row of rows) {
      if (
        !isChamariEntity(row['Partner Company']) &&
        !isChamariEntity(row['Company Id']) &&
        !isChamariEntity(row['Tax Identification Number'])
      ) {
        continue;
      }
      const patch = {};
      if (isChamariEntity(row['Partner Company'])) patch['Partner Company'] = null;
      if (isChamariEntity(row['Company Id'])) patch['Company Id'] = null;
      if (isChamariEntity(row['Tax Identification Number'])) patch['Tax Identification Number'] = null;
      if (!dryRun) {
        const { error } = await sb.from(table).update(patch).eq('id', row.id);
        if (error) throw error;
      }
      cleared++;
    }
    summary[table] = { rows: rows.length, cleared };
  }
  console.log(JSON.stringify({ dryRun, summary }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
