import { rendezvous } from "@/lib/api/rooms";
import { localKv } from "@/lib/platform/kv";
import type { DeviceInfoIn } from "@/types/device";
import { loadSession, saveSession, toStoredSession, type SessionMode } from "./session-store";

const LAST_ROOM_PREFIX = "droply:rendezvous-room:";

function lastRoomKey(mode: SessionMode, key: string): string {
  // Only a short, non-secret fingerprint of the key goes into the storage key name.
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return `${LAST_ROOM_PREFIX}${mode}:${(hash >>> 0).toString(36)}`;
}

/**
 * Enters the room shared by everyone holding `key` ("My devices" or a personal room link)
 * and returns its id. Re-uses this tab's device in that room when it still exists.
 */
export async function enterRendezvous(key: string, mode: SessionMode, device: DeviceInfoIn): Promise<string> {
  let token: string | null = null;
  try {
    const roomId = localKv.getItem(lastRoomKey(mode, key));
    token = roomId ? loadSession(roomId)?.token ?? null : null;
  } catch {
    // no previous session
  }
  const session = await rendezvous(key, device, token);
  saveSession(toStoredSession(session, mode));
  try {
    localKv.setItem(lastRoomKey(mode, key), session.room_id);
  } catch {
    // ignore
  }
  return session.room_id;
}
