/**
 * Build V10 Mews import xlsx package from V4 CSV exports.
 *
 *   node contract-extraction/build-v10-mews-import-xlsx.mjs
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const py = path.join(here, 'build-v10-mews-import-from-v4.py');
const r = spawnSync('python', [py], { stdio: 'inherit', cwd: path.join(here, '..') });
process.exit(r.status ?? 1);
