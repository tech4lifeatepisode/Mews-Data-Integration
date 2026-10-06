import 'dotenv/config';
import { retryFailedUploads } from './drive-http.mjs';

const args = process.argv.slice(2);
const sourceSyncId = args.find((a) => a.startsWith('--sync-id='))?.slice('--sync-id='.length);
const driveFileIds = args
  .find((a) => a.startsWith('--ids='))
  ?.slice('--ids='.length)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const stats = await retryFailedUploads({ sourceSyncId, driveFileIds });
console.log(JSON.stringify(stats, null, 2));
