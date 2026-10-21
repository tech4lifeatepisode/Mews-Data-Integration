/**
 * Build Mews_import-format xlsx from V3 B2C Supabase CSV export (Customers only; Companies sheet empty).
 * Usage:
 *   node build-v3-mews-import-xlsx.mjs [customersCsv] [outputXlsx]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const template = path.join(root, 'Mews_import_v2.10.0.xlsx');
const emptyCompanies = path.join(here, '_empty_companies_header.csv');

const defaultCustomersCsv = path.join(here, 'v3-b2c-customers-export-20-10-2026.csv');
const customersCsv =
  process.argv[2] ||
  (fs.existsSync(defaultCustomersCsv)
    ? defaultCustomersCsv
    : 'C:/Users/Claudio/Downloads/V3_Final_B2C_All_Fields_Match_Mews_Import_20_10_2026_rows.csv');
const outputXlsx =
  process.argv[3] || path.join(root, 'Mews_import_V3_B2C_20_10_2026_combined.xlsx');

const pyScript = path.join(here, '_build_v2_mews_import_xlsx.py');
if (!fs.existsSync(pyScript)) {
  console.error('Missing', pyScript);
  process.exit(1);
}
if (!fs.existsSync(emptyCompanies)) {
  console.error('Missing', emptyCompanies);
  process.exit(1);
}

const r = spawnSync(
  'python',
  [pyScript, template, customersCsv, emptyCompanies, outputXlsx],
  { encoding: 'utf8', stdio: 'inherit' },
);
process.exit(r.status ?? 1);
