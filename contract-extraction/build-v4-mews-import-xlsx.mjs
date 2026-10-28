/**
 * Build Mews_import-format xlsx (Customers + Companies) from V4 CSV exports.
 *
 *   node build-v4-mews-import-xlsx.mjs [customersCsv] [companiesCsv] [outputXlsx]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const template = path.join(root, 'Mews_import_v2.10.0.xlsx');

const defaultCustomersCsv = path.join(here, 'v4-customers-export-21-10-2026.csv');
const defaultCompaniesCsv = path.join(here, 'v4-companies-export-21-10-2026.csv');
const customersCsv = process.argv[2] || defaultCustomersCsv;
const companiesCsv = process.argv[3] || defaultCompaniesCsv;
const outputXlsx = process.argv[4] || path.join(root, 'Mews_import_V4_B2C_B2B_21_10_2026_combined.xlsx');

const pyScript = path.join(here, '_build_v2_mews_import_xlsx.py');
if (!fs.existsSync(pyScript)) {
  console.error('Missing', pyScript);
  process.exit(1);
}
if (!fs.existsSync(customersCsv)) {
  console.error('Missing customers CSV. Run: node upload-v4-mews-import-21-10-2026.mjs');
  process.exit(1);
}
if (!fs.existsSync(companiesCsv)) {
  console.error('Missing companies CSV. Run: node upload-v4-mews-import-21-10-2026.mjs');
  process.exit(1);
}

const r = spawnSync(
  'python',
  [pyScript, template, customersCsv, companiesCsv, outputXlsx],
  { encoding: 'utf8', stdio: 'inherit' },
);
process.exit(r.status ?? 1);
