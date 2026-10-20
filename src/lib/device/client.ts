// What this device tells the server for the anonymous usage counts on the website's admin
// dashboard: that it is the native mobile app, and a random id that only lets the server
// count distinct users (it keeps a keyed hash in a counter, never the id).
import { localKv } from "@/lib/platform/kv";
import { randomBytes } from "@/lib/utils/hash";
import type { DeviceInfoIn } from "@/types/device";

const INSTALL_ID_KEY = "droply:install-id";
const INSTALL_ID = /^[A-Za-z0-9_-]{16,64}$/;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Random per-install id, created once (22 base64url characters). Null if storage fails. */
export function installId(): string | null {
  try {
    const stored = localKv.getItem(INSTALL_ID_KEY);
    if (stored && INSTALL_ID.test(stored)) return stored;
    let id = "";
    for (const byte of randomBytes(22)) id += ALPHABET[byte & 63];
    localKv.setItem(INSTALL_ID_KEY, id);
    return id;
  } catch {
    return null;
  }
}

/** Adds the app kind and install id to the device info sent on room create/join. */
export function withClientInfo(device: DeviceInfoIn): DeviceInfoIn {
  const id = installId();
  return { ...device, client: device.client ?? "app", ...(id && !device.install_id ? { install_id: id } : {}) };
}
