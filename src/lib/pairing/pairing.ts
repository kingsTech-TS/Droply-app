// "My devices" pairing and the personal room link. Both are random keys kept on the device.
// The backend only ever sees a keyed hash of them (rendezvous): whoever holds the key can
// meet in the shared room without a code. Pairing keys travel only over the encrypted
// peer-to-peer channel, never through the server.
import { env } from "@/config/env";
import { secureKv } from "@/lib/platform/kv";
import { randomBytes } from "@/lib/utils/hash";
import { isRecord, LocalStore } from "@/lib/utils/local-store";
import type { DeviceType } from "@/types/device";

export interface PairedDevice {
  name: string;
  type: DeviceType;
  pairedAt: number;
}

export interface Pairing {
  key: string | null;
  devices: PairedDevice[];
}

const DEVICE_TYPES: readonly DeviceType[] = ["phone", "tablet", "laptop", "desktop", "unknown"];
const KEY_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

function isPairedDevice(value: unknown): value is PairedDevice {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    DEVICE_TYPES.includes(value.type as DeviceType) &&
    typeof value.pairedAt === "number"
  );
}

export const pairing = new LocalStore<Pairing>("droply:pairing", { key: null, devices: [] }, (raw) =>
  isRecord(raw)
    ? {
        key: typeof raw.key === "string" && KEY_PATTERN.test(raw.key) ? raw.key : null,
        devices: Array.isArray(raw.devices) ? raw.devices.filter(isPairedDevice).slice(0, 50) : [],
      }
    : null,
  // Holds the pairing key, a secret: Keychain / Keystore.
  secureKv,
);

/** The secret behind this device's personal room link (droply.app/r/<key>). */
export const roomLinkKey = new LocalStore<string | null>("droply:room-link", null, (raw) =>
  typeof raw === "string" && KEY_PATTERN.test(raw) ? raw : null,
  secureKv,
);

/** 256 random bits, base64url (43 characters). */
export function generateKey(): string {
  const bytes = randomBytes(32);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  // base64url is just the key's text form; no file data is ever Base64-encoded.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/** This device's pairing key, created on first use. */
export function ensurePairingKey(): string {
  const current = pairing.get();
  if (current.key) return current.key;
  const key = generateKey();
  pairing.set({ ...current, key });
  return key;
}

/** Records a newly paired device (and adopts its group key if we were asked to join). */
export function addPairedDevice(device: Omit<PairedDevice, "pairedAt">, adoptKey?: string): void {
  pairing.update((current) => {
    const devices = current.devices.filter((d) => d.name !== device.name);
    return {
      key: adoptKey && isValidKey(adoptKey) ? adoptKey : current.key,
      devices: [...devices, { ...device, pairedAt: Date.now() }],
    };
  });
}

export function forgetPairedDevice(name: string): void {
  pairing.update((current) => ({ ...current, devices: current.devices.filter((d) => d.name !== name) }));
}

/** Leaves the group: a new key on next pairing, so old devices can no longer meet us. */
export function unpairAll(): void {
  pairing.set({ key: null, devices: [] });
}

export function ensureRoomLinkKey(): string {
  const current = roomLinkKey.get();
  if (current) return current;
  const key = generateKey();
  roomLinkKey.set(key);
  return key;
}

/** Invalidates the old personal link (anyone holding it can no longer join). */
export function resetRoomLinkKey(): string {
  const key = generateKey();
  roomLinkKey.set(key);
  return key;
}

/** The shareable personal link. Opens the website (or this app, via universal/app links). */
export function roomLinkUrl(key: string, fallbackOrigin: string | null = null): string {
  const origin = env.webUrl ?? fallbackOrigin ?? "";
  return `${origin}/r/${key}`;
}
