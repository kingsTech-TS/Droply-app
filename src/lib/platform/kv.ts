// Synchronous key-value storage with the Web Storage shape, so modules ported from the
// website keep their synchronous reads.
//
// - `localKv`: everyday app data (preferences, history, my rooms, pairing metadata), in
//   SQLite (`expo-sqlite/kv-store`). Replaces the website's localStorage.
// - `secureKv`: bearer secrets (device tokens, host keys, pairing and room-link keys), in the
//   iOS Keychain / Android Keystore (`expo-secure-store`). Replaces sessionStorage. SecureStore
//   cannot enumerate keys, so an index of keys is kept alongside.
import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";
import Storage from "expo-sqlite/kv-store";
import * as SecureStore from "expo-secure-store";
import { migrateDatabase, privateSqliteDirectory } from "./private-dir";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

/** expo-sqlite/kv-store's database and table, so existing data carries over. */
const KV_DATABASE = "ExpoSQLiteStorage";

/** iOS: the same store, opened from the private folder (Documents is visible in Files). */
function privateKv(): KeyValueStore | null {
  const directory = privateSqliteDirectory();
  if (!directory) return null;
  let db: SQLiteDatabase;
  try {
    migrateDatabase(KV_DATABASE);
    db = openDatabaseSync(KV_DATABASE, undefined, directory);
    db.execSync("CREATE TABLE IF NOT EXISTS storage (key TEXT PRIMARY KEY NOT NULL, value TEXT);");
  } catch {
    return null;
  }
  return {
    getItem: (key) => db.getFirstSync<{ value: string | null }>("SELECT value FROM storage WHERE key = ?;", key)?.value ?? null,
    setItem: (key, value) => {
      db.runSync("INSERT INTO storage (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;", key, value);
    },
    removeItem: (key) => {
      db.runSync("DELETE FROM storage WHERE key = ?;", key);
    },
    keys: () => db.getAllSync<{ key: string }>("SELECT key FROM storage;").map((row) => row.key),
  };
}

const defaultKv: KeyValueStore = {
  getItem: (key) => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
  removeItem: (key) => {
    Storage.removeItemSync(key);
  },
  keys: () => Storage.getAllKeysSync(),
};

export const localKv: KeyValueStore = privateKv() ?? defaultKv;

// SecureStore keys may only contain letters, digits, ".", "-" and "_".
const secureName = (key: string): string => key.replace(/[^A-Za-z0-9._-]/g, ".");
const INDEX_KEY = "droply.secure-index";

function readIndex(): string[] {
  try {
    const raw = SecureStore.getItem(INDEX_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function writeIndex(keys: string[]): void {
  try {
    SecureStore.setItem(INDEX_KEY, JSON.stringify([...new Set(keys)]));
  } catch {
    // The index is only used to enumerate; individual items still work.
  }
}

export const secureKv: KeyValueStore = {
  getItem: (key) => {
    try {
      return SecureStore.getItem(secureName(key));
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    SecureStore.setItem(secureName(key), value);
    const index = readIndex();
    if (!index.includes(key)) writeIndex([...index, key]);
  },
  removeItem: (key) => {
    void SecureStore.deleteItemAsync(secureName(key)).catch(() => undefined);
    writeIndex(readIndex().filter((k) => k !== key));
  },
  keys: () => readIndex(),
};
