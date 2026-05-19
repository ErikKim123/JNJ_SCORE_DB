// Quick query helper. Usage:
//   node scripts/db-shell.mjs "select count(*) from competitions"
//   node scripts/db-shell.mjs --file path/to/file.sql
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config as dotenv } from 'dotenv';
import pg from 'pg';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
dotenv({ path: join(root, '.env.local') });

const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const client = new Client({
  host: process.env.SUPABASE_DB_POOLER_HOST,
  port: 5432,
  user: `postgres.${ref}`,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
});

const args = process.argv.slice(2);
const sql = args[0] === '--file' ? readFileSync(args[1], 'utf8') : args.join(' ');
if (!sql) { console.error('Usage: db-shell.mjs "<sql>" | --file <path>'); process.exit(1); }

await client.connect();
try {
  const r = await client.query(sql);
  if (Array.isArray(r)) {
    r.forEach((rr, i) => { console.log(`--- result ${i} ---`); console.table(rr.rows); });
  } else {
    console.table(r.rows);
  }
} finally { await client.end(); }
