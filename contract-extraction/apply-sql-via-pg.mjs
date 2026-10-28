import fs from 'fs';
import pg from 'pg';

const ref = 'jujvtuyksxkoclegjznb';

/**
 * @param {string} sql
 * @param {{ passwordCandidates?: string[] }} [options]
 */
export async function applySqlViaPg(sql, options = {}) {
  const candidates = [
    process.env.SUPABASE_DB_URL,
    process.env.SUPABASE_DB_PASSWORD,
    process.env.PGPASSWORD,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SECRET_KEY,
    ...(options.passwordCandidates || []),
  ].filter(Boolean);

  const urls = [];
  if (process.env.SUPABASE_DB_URL) urls.push(process.env.SUPABASE_DB_URL);
  for (const pwd of candidates) {
    urls.push(`postgresql://postgres:${encodeURIComponent(pwd)}@db.${ref}.supabase.co:5432/postgres`);
    urls.push(
      `postgresql://postgres.${ref}:${encodeURIComponent(pwd)}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`,
    );
  }

  const seen = new Set();
  let lastError = '';
  for (const connectionString of urls) {
    if (!connectionString || seen.has(connectionString)) continue;
    seen.add(connectionString);
    const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
    try {
      await client.connect();
      await client.query(sql);
      await client.end();
      return { ok: true };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
  }
  return { ok: false, error: lastError || 'no connection attempts' };
}

export async function applySqlFile(relativePathFromRepoRoot) {
  const sqlPath = new URL(`../${relativePathFromRepoRoot}`, import.meta.url);
  const sql = fs.readFileSync(sqlPath, 'utf8');
  return applySqlViaPg(sql);
}
