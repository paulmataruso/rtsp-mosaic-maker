import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';
import { loadEnv } from '../config/env.js';
import { getLogger } from '../config/logger.js';

/**
 * Locate the generated Drizzle migrations folder. The path differs between
 * `tsx` (running from src/) and the bundled build (dist/), so try the likely
 * candidates and use the first that exists.
 */
function resolveMigrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.DRIZZLE_MIGRATIONS_DIR,
    resolve(here, '..', '..', 'drizzle'),
    resolve(here, '..', 'drizzle'),
    resolve(here, 'drizzle'),
    resolve(process.cwd(), 'drizzle'),
    resolve(process.cwd(), 'backend', 'drizzle'),
  ].filter((p): p is string => !!p);
  for (const c of candidates) {
    if (existsSync(resolve(c, 'meta', '_journal.json'))) return c;
  }
  return candidates[1]!; // sensible default; migrate() will error clearly if wrong
}

export type DB = BetterSQLite3Database<typeof schema>;

let sqlite: Database.Database | undefined;
let db: DB | undefined;

/** Resolve `file:/path`, `/path`, or `:memory:` from DATABASE_URL. */
function resolveSqlitePath(databaseUrl: string): string {
  if (databaseUrl === ':memory:' || databaseUrl === 'file::memory:') return ':memory:';
  const stripped = databaseUrl.startsWith('file:') ? databaseUrl.slice('file:'.length) : databaseUrl;
  if (stripped.startsWith('postgres://') || stripped.startsWith('postgresql://')) {
    throw new Error(
      'PostgreSQL support is not wired up yet. Use a file: SQLite URL. The schema is written to be portable so a pg dialect can be added later.',
    );
  }
  return stripped;
}

export function getDb(): DB {
  if (db) return db;
  const env = loadEnv();
  const path = resolveSqlitePath(env.DATABASE_URL);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  db = drizzle(sqlite, { schema });
  return db;
}

/** Apply pending migrations. Called once during boot (and by tests). */
export function runMigrations(target?: DB): void {
  const database = target ?? getDb();
  const migrationsFolder = resolveMigrationsFolder();
  migrate(database, { migrationsFolder });
  getLogger().info({ component: 'db', migrationsFolder }, 'database migrations applied');
}

/** Close the connection (graceful shutdown / tests). */
export function closeDb(): void {
  sqlite?.close();
  sqlite = undefined;
  db = undefined;
}

/** Build an isolated in-memory DB for tests. */
export function createTestDb(): { db: DB; close: () => void } {
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  const testDb = drizzle(mem, { schema });
  migrate(testDb, { migrationsFolder: resolveMigrationsFolder() });
  return { db: testDb, close: () => mem.close() };
}

export { schema };
