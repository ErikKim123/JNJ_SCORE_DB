// One-shot migration runner.
//   node scripts/apply-migrations.mjs           # apply all .sql in supabase/migrations
//   node scripts/apply-migrations.mjs 0001      # apply only files starting with "0001"
//
// Tries direct host first (db.<ref>.supabase.co:5432), falls back to AWS pooler
// in common regions if the host resolves but TCP fails (Windows IPv6 quirks).

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config as dotenv } from 'dotenv';
import pg from 'pg';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
dotenv({ path: join(root, '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!SUPABASE_URL || !PASSWORD) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_DB_PASSWORD in .env.local');
  process.exit(1);
}

const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
console.log(`[runner] project ref: ${projectRef}`);

// Connection candidates — if SUPABASE_DB_POOLER_HOST is set in .env, try it first.
const CACHED_HOST = process.env.SUPABASE_DB_POOLER_HOST;
const candidates = [
  ...(CACHED_HOST ? [{
    label: `cached ${CACHED_HOST}`,
    config: {
      host: CACHED_HOST,
      port: 5432,
      user: `postgres.${projectRef}`,
      password: PASSWORD,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
    },
  }] : []),
  {
    label: 'direct (db.<ref>.supabase.co:5432)',
    config: {
      host: `db.${projectRef}.supabase.co`,
      port: 5432,
      user: 'postgres',
      password: PASSWORD,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
    },
  },
  ...['aws-0', 'aws-1'].flatMap((cluster) =>
    [
      'ap-northeast-2', 'ap-northeast-1', 'ap-south-1',
      'ap-southeast-1', 'ap-southeast-2',
      'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
      'eu-west-1', 'eu-west-2', 'eu-central-1', 'eu-north-1',
    ].map((region) => ({
      label: `pooler ${cluster}-${region}`,
      config: {
        host: `${cluster}-${region}.pooler.supabase.com`,
        port: 5432,
        user: `postgres.${projectRef}`,
        password: PASSWORD,
        database: 'postgres',
        ssl: { rejectUnauthorized: false },
      },
    })),
  ),
];

async function connect() {
  for (const c of candidates) {
    process.stdout.write(`[runner] trying ${c.label} ... `);
    const client = new Client({ ...c.config, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      console.log('OK');
      return client;
    } catch (err) {
      console.log(`failed (${err.code || ''} ${err.message})`);
      try { await client.end(); } catch {}
    }
  }
  throw new Error('All connection candidates failed.');
}

const migrationsDir = join(root, 'supabase', 'migrations');
const filter = process.argv[2] || '';
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql') && f.startsWith(filter))
  .sort();
if (!files.length) {
  console.error(`No SQL files matched filter "${filter}" in ${migrationsDir}`);
  process.exit(1);
}

const client = await connect();
try {
  for (const f of files) {
    const sql = readFileSync(join(migrationsDir, f), 'utf8');
    console.log(`\n=== ${f} (${sql.length} bytes) ===`);
    await client.query(sql);
    console.log(`[runner] ${f} OK`);
  }
  console.log('\n✅ all migrations applied.');
} catch (err) {
  console.error('\n❌ migration failed:', err.message);
  if (err.position) console.error('   at SQL position', err.position);
  process.exit(1);
} finally {
  await client.end();
}
