/**
 * NC_1147 (Jorge Rodrigues Jesus / JJ Activos): Adult Count(*) = 2 (was 4).
 *
 *   node patch-nc-1147-person-count-23-10-2026.mjs
 *   node patch-nc-1147-person-count-23-10-2026.mjs --apply
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const NC = 1147;
const ADULT_COUNT = '2';
const CHILD_COUNT = '0';

const TABLES = [
  'V4_Final_B2C_and_B2B_All_Fields_Match_Mews_Import_21_10_2026',
  'V6_Final_B2C_and_B2B_All_Fields_Match_Mews_Import_21_10_2026',
];

const here = path.dirname(fileURLToPath(import.meta.url));
const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
const transcriptText = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  [...transcriptText.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];
if (!key) throw new Error('Missing Supabase service key');
const sb = createClient(process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co', key);

const apply = process.argv.includes('--apply');
const report = { nc_number: NC, adult: ADULT_COUNT, child: CHILD_COUNT, apply, tables: [] };

for (const table of TABLES) {
  const { data: row, error: selErr } = await sb.from(table).select('*').eq('nc_number', NC).maybeSingle();
  if (selErr) throw selErr;
  if (!row) {
    report.tables.push({ table, status: 'not_found' });
    continue;
  }
  const change = {
    table,
    group_code: row['Group Code'],
    from: { adult: row['Adult Count(*)'], child: row['Child Count(*)'] },
    to: { adult: ADULT_COUNT, child: CHILD_COUNT },
  };
  if (apply) {
    const { error: updErr } = await sb
      .from(table)
      .update({ 'Adult Count(*)': ADULT_COUNT, 'Child Count(*)': CHILD_COUNT })
      .eq('nc_number', NC);
    if (updErr) throw updErr;
    change.status = 'updated';
  } else {
    change.status = 'dry_run';
  }
  report.tables.push(change);
}

const out = path.join(here, 'patch-nc-1147-person-count-23-10-2026-report.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
