/**
 * Blank Group Code HM rows → Possible_BCN_Properties_15_10_2026.
 * First run: contract-analysis/supabase-possible-bcn-properties-15-10-2026.sql in SQL editor.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tmp-build-possible-bcn-properties-table.mjs');
const r = spawnSync(process.execPath, [script], { stdio: 'inherit', encoding: 'utf8' });
process.exit(r.status ?? 1);
