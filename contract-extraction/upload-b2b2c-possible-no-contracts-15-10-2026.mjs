/**
 * Merge 20 B2B2C NCs from Final_Format_* tables → B2B2C_Possible_No_Contracts_15_10_2026.
 * Regenerates contract-analysis/supabase-b2b2c-possible-no-contracts-15-10-2026.sql (DDL + INSERTs).
 *
 * First run: paste that .sql file in Supabase SQL editor (see RUN-IN-SUPABASE-SQL-EDITOR.md).
 * Then: node upload-b2b2c-possible-no-contracts-15-10-2026.mjs
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tmp-build-b2b2c-no-hm-table.mjs');
const r = spawnSync(process.execPath, [script], { stdio: 'inherit', encoding: 'utf8' });
process.exit(r.status ?? 1);
