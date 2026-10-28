import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

spawnSync('node', [path.join(here, 'export-v6-tables-csv-21-10-2026.mjs'), 'v16'], { stdio: 'inherit', cwd: root });
const py = spawnSync('python', [path.join(here, 'build-v16-mews-import-from-v6.py')], { stdio: 'inherit', cwd: root });
process.exit(py.status ?? 1);
