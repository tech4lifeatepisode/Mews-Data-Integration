import 'dotenv/config';
import { syncDriveToSupabase } from './drive-http.mjs';
import { resolveMigrationGreenAllowlist } from './migration-xlsx-allowlist.mjs';

const xlsxPath = process.argv[2] || process.env.MIGRATION_XLSX_PATH;
const { allowlist, rows, xlsxPath: resolved, jsonPath } = await resolveMigrationGreenAllowlist(xlsxPath);

if (allowlist.size === 0) {
  console.error('No green column F rows with B2C/B2B2C found in', resolved || jsonPath);
  process.exit(1);
}

console.log(
  `Migration sync: ${allowlist.size} NC(s) from ${resolved} — ${[...allowlist].sort((a, b) => Number(a) - Number(b)).join(', ')}`,
);
console.log(JSON.stringify(rows, null, 2));

const stats = await syncDriveToSupabase({
  allowlist,
  allowlistLabel: 'migration-xlsx-green',
});
console.log(JSON.stringify(stats, null, 2));
