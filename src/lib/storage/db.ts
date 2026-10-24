// The app's SQLite database (replaces the website's IndexedDB "droply" database). Holds
// resume metadata and chunk digests. Payloads never go here: received bytes live in sandbox
// files (see sinks/sandbox-sink.ts).
import * as SQLite from "expo-sqlite";
import { migrateDatabase, privateSqliteDirectory } from "@/lib/platform/private-dir";
import { logger } from "@/lib/utils/logger";

export const DB_NAME = "droply.db";
const SCHEMA_VERSION = 1;

let opening: Promise<SQLite.SQLiteDatabase | null> | null = null;

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const version = row?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS legs (
      key TEXT PRIMARY KEY NOT NULL,
      room_id TEXT NOT NULL,
      record TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS legs_room ON legs(room_id);
    CREATE TABLE IF NOT EXISTS digests (
      role TEXT NOT NULL,
      transfer_id TEXT NOT NULL,
      chunk INTEGER NOT NULL,
      digest TEXT NOT NULL,
      PRIMARY KEY (role, transfer_id, chunk)
    );
    PRAGMA user_version = ${SCHEMA_VERSION};
  `);
}

/** The shared database, or null if it can't be opened (resume then works in memory only). */
export function openDb(): Promise<SQLite.SQLiteDatabase | null> {
  opening ??= (async () => {
    try {
      // iOS: out of Documents, which the Files app shows (received files live there).
      migrateDatabase(DB_NAME);
      const db = await SQLite.openDatabaseAsync(DB_NAME, undefined, privateSqliteDirectory() ?? undefined);
      await migrate(db);
      return db;
    } catch (error) {
      logger.warn("db", "SQLite unavailable", String(error));
      return null;
    }
  })();
  return opening;
}
