/**
 * Viajes Puerta de Sevilla SL: Prepaid Amount = 655, Prepayment Type = Deposit.
 *
 *   node patch-puerta-de-sevilla-prepayment-22-10-2026.mjs           (dry-run)
 *   node patch-puerta-de-sevilla-prepayment-22-10-2026.mjs --apply
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import {
  PUERTA_DE_SEVILLA_PREPAID_AMOUNT,
  PUERTA_DE_SEVILLA_PREPAYMENT_TYPE,
  isPuertaDeSevillaRow,
} from './puerta-de-sevilla-prepayment.mjs';

const TABLES = [
  'V5_Final_B2C_and_B2B_All_Fields_Match_Mews_Import_21_10_2026',
  'V4_Final_B2C_and_B2B_All_Fields_Match_Mews_Import_21_10_2026',
  'V3_Final_B2B_All_Fields_Match_Mews_Import_20_10_2026',
  'V2_Final_Format_All_Fields_Match_Mews_Import_19_10_2026',
];

const PREPAID = PUERTA_DE_SEVILLA_PREPAID_AMOUNT;
const PREP_TYPE = PUERTA_DE_SEVILLA_PREPAYMENT_TYPE;

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

async function fetchAll(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').order('nc_number').range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

const report = { apply, prepaid: PREPAID, prepaymentType: PREP_TYPE, tables: [] };

for (const table of TABLES) {
  const rows = await fetchAll(table);
  const targets = rows.filter(isPuertaDeSevillaRow);
  const changes = targets.map((r) => ({
    nc_number: r.nc_number,
    group_code: r['Group Code'],
    partner: r['Partner Company'],
    from: { prepaid: r['Prepaid Amount'], type: r['Prepayment Type'] },
    to: { prepaid: PREPAID, type: PREP_TYPE },
  }));

  if (apply && targets.length) {
    for (const r of targets) {
      const { error } = await sb
        .from(table)
        .update({ 'Prepaid Amount': PREPAID, 'Prepayment Type': PREP_TYPE })
        .eq('nc_number', r.nc_number);
      if (error) throw error;
    }
  }

  report.tables.push({ table, matched: targets.length, changes });
}

const out = path.join(here, 'patch-puerta-de-sevilla-prepayment-22-10-2026-report.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
