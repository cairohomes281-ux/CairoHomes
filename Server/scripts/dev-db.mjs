/**
 * Local throwaway Postgres for development (no Supabase / Docker needed).
 *
 * Usage: npm run dev:db   (from the repo root or Server/)
 * Then set in Server/.env:
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/cairohomes
 *
 * Data lives outside the repo in DEV_DB_DIR (default %LOCALAPPDATA%/CairoHomes/devdb/pgdata).
 */
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const baseDir = process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share');
const dataDir = process.env.DEV_DB_DIR || path.join(baseDir, 'CairoHomes', 'devdb', 'pgdata');
const port = Number(process.env.DEV_DB_PORT || 5433);
const fresh = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));

fs.mkdirSync(path.dirname(dataDir), { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

if (fresh) await pg.initialise();
await pg.start();
if (fresh) {
  await pg.createDatabase('cairohomes');
  const client = pg.getPgClient('cairohomes');
  await client.connect();
  // Supabase ships these roles; migrations reference them.
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
    END $$;`);
  await client.end();
}
console.log(`[devdb] Postgres ready on localhost:${port} (db: cairohomes, data: ${dataDir})`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
