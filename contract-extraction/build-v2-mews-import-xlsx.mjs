/**
 * Build Mews_import-format xlsx from V2 Supabase CSV exports.
 * Usage:
 *   node build-v2-mews-import-xlsx.mjs [customersCsv] [companiesCsv] [outputXlsx]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const template = path.join(root, 'Mews_import_v2.10.0.xlsx');

const customersCsv =
  process.argv[2] ||
  'C:/Users/Claudio/Downloads/V2_Final_Format_All_Fields_Match_Mews_Import_19_10_2026_rows.csv';
const companiesCsv =
  process.argv[3] ||
  'C:/Users/Claudio/Downloads/V2_Final_Format_All_Fields_Match_Mews_Import_Companies_19_10_20_rows.csv';
const outputXlsx =
  process.argv[4] ||
  path.join(root, 'Mews_import_V2_19_10_2026_combined.xlsx');

const pyScript = path.join(here, '_build_v2_mews_import_xlsx.py');
if (!fs.existsSync(pyScript)) {
  console.error('Missing', pyScript);
  process.exit(1);
}

const r = spawnSync(
  'python',
  [pyScript, template, customersCsv, companiesCsv, outputXlsx],
  { encoding: 'utf8', stdio: 'inherit' },
);
process.exit(r.status ?? 1);
