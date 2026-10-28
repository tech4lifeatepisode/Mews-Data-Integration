import fs from 'fs';

const ref = 'jujvtuyksxkoclegjznb';

async function loadPgClient() {
  try {
    const pg = (await import('pg')).default;
    return pg.Client;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * @param {string} sql
 * @param {{ passwordCandidates?: string[] }} [options]
 */
export async function applySqlViaPg(sql, options = {}) {
  const Client = await loadPgClient();
  if (typeof Client !== 'function') {
    return { ok: false, error: `pg not installed: ${Client.error}` };
  }

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
    urls.push(`postgresql://postgres:${encodeURIComponent(pwd)}@db.${ref}.supabase.co:6543/postgres`);
    for (const region of ['eu-west-1', 'eu-west-2', 'eu-central-1']) {
      urls.push(
        `postgresql://postgres.${ref}:${encodeURIComponent(pwd)}@aws-0-${region}.pooler.supabase.com:6543/postgres`,
      );
    }
  }

  const seen = new Set();
  let lastError = '';
  for (const connectionString of urls) {
    if (!connectionString || seen.has(connectionString)) continue;
    seen.add(connectionString);
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
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
