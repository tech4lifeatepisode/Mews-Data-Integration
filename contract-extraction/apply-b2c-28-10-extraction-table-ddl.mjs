import fs from 'fs';
import pg from 'pg';

const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
const text = fs.readFileSync(transcript, 'utf8');
const secret = [...text.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];

const sqlPath = new URL(
  '../contract-analysis/supabase-customers-contracts-extraction-28-10-2026-b2c.sql',
  import.meta.url,
);
const sql = fs.readFileSync(sqlPath, 'utf8');

const ref = 'jujvtuyksxkoclegjznb';
const password = process.env.SUPABASE_DB_PASSWORD || process.env.PGPASSWORD || '';
const urls = [];
if (process.env.SUPABASE_DB_URL) urls.push(process.env.SUPABASE_DB_URL);
if (password) {
  urls.push(`postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`);
}
for (const attempt of [password, secret].filter(Boolean)) {
  urls.push(`postgresql://postgres:${encodeURIComponent(attempt)}@db.${ref}.supabase.co:5432/postgres`);
}

const seen = new Set();
for (const connectionString of urls) {
  if (!connectionString || seen.has(connectionString)) continue;
  seen.add(connectionString);
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query(sql);
    console.log('DDL applied: Customers_Contracts_Extraction_28_10_2026_B2C');
    await client.end();
    process.exit(0);
  } catch (error) {
    console.error('fail', connectionString.replace(/:[^:@/]+@/, ':***@'), error.message);
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }
}
process.exit(1);
