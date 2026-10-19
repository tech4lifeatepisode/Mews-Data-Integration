import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tmp-build-missing-group-code-hm-table.mjs');
const r = spawnSync(process.execPath, [script], { stdio: 'inherit', encoding: 'utf8' });
process.exit(r.status ?? 1);
