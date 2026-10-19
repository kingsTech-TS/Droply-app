// Synchronous key-value storage with the Web Storage shape, so modules ported from the
// website keep their synchronous reads.
//
// - `localKv`: everyday app data (preferences, history, my rooms, pairing metadata), in
//   SQLite (`expo-sqlite/kv-store`). Replaces the website's localStorage.
// - `secureKv`: bearer secrets (device tokens, host keys, pairing and room-link keys), in the
//   iOS Keychain / Android Keystore (`expo-secure-store`). Replaces sessionStorage. SecureStore
//   cannot enumerate keys, so an index of keys is kept alongside.
import Storage from "expo-sqlite/kv-store";
import * as SecureStore from "expo-secure-store";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

export const localKv: KeyValueStore = {
  getItem: (key) => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
  removeItem: (key) => {
    Storage.removeItemSync(key);
  },
  keys: () => Storage.getAllKeysSync(),
};

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
