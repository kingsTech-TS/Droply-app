// The device token is a bearer secret. It lives in the Keychain / Keystore (the website keeps
// it in sessionStorage) and is never put in a URL or a log. It survives an app restart, so the
// device can rejoin within the server's reconnect window.
import { secureKv } from "@/lib/platform/kv";
import { ROOM_THEMES, type RoomSession, type RoomTheme } from "@/types/room";

const sessionStorage = secureKv;

const PREFIX = "droply:session:";

/**
 * How the room was entered. "my-devices": the shared room of paired devices (everyone in it
 * holds the pairing key, so transfers are auto-accepted). "room-link": a personal link.
 */
export type SessionMode = "standard" | "my-devices" | "room-link";

export interface StoredSession {
  roomId: string;
  roomCode: string;
  joinUrl: string;
  deviceId: string;
  token: string;
  tokenExpiresAt: string;
  mode: SessionMode;
  /** The room's theme when this device entered, so the room is themed while it loads. */
  theme?: RoomTheme;
}

export function toStoredSession(session: RoomSession, mode: SessionMode = "standard"): StoredSession {
  return {
    roomId: session.room_id,
    roomCode: session.room_code,
    joinUrl: session.join_url,
    deviceId: session.device.device_id,
    token: session.device_token,
    tokenExpiresAt: session.token_expires_at,
    mode,
    theme: session.room.theme,
  };
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const fields = ["roomId", "roomCode", "joinUrl", "deviceId", "token", "tokenExpiresAt"].every(
    (key) => typeof v[key] === "string",
  );
  if (!fields) return false;
  // Sessions saved before modes existed are standard rooms.
  if (v.mode !== "my-devices" && v.mode !== "room-link") v.mode = "standard";
  if (!(ROOM_THEMES as readonly unknown[]).includes(v.theme)) delete v.theme;
  return true;
}

export function saveSession(session: StoredSession): void {
  try {
    sessionStorage.setItem(PREFIX + session.roomId, JSON.stringify(session));
  } catch {
    // Storage blocked: the session works until the tab reloads.
  }
}

export function loadSession(roomId: string): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + roomId);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredSession(parsed)) return null;
    if (Date.parse(parsed.tokenExpiresAt) <= Date.now()) {
      clearSession(roomId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Finds a session for a room by its code, used when re-opening a join link. */
export function findSessionByCode(roomCode: string): StoredSession | null {
  try {
    for (const key of sessionStorage.keys()) {
      if (!key.startsWith(PREFIX)) continue;
      const session = loadSession(key.slice(PREFIX.length));
      if (session && session.roomCode === roomCode) return session;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Every stored session that hasn't expired (the app keeps sessions across restarts). */
export function allSessions(): StoredSession[] {
  const out: StoredSession[] = [];
  for (const key of sessionStorage.keys()) {
    if (!key.startsWith(PREFIX)) continue;
    const session = loadSession(key.slice(PREFIX.length));
    if (session) out.push(session);
  }
  return out;
}

export function clearSession(roomId: string): void {
  try {
    sessionStorage.removeItem(PREFIX + roomId);
  } catch {
    // ignore
  }
}
