import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

spawnSync('node', [path.join(here, 'export-v4-tables-csv-21-10-2026.mjs'), 'v12'], { stdio: 'inherit', cwd: root });
const py = spawnSync('python', [path.join(here, 'build-v12-mews-import-from-v4.py')], { stdio: 'inherit', cwd: root });
process.exit(py.status ?? 1);
