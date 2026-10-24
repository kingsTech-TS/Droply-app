// Entering rooms, shared by every screen that does it (the website repeats these steps in
// start-sharing, join-form, active-rooms, my-devices and room-link-join).
import { createRoom, joinRoom } from "@/lib/api/rooms";
import type { LocalFile } from "@/lib/files/local-file";
import { normalizeRoomCode } from "@/lib/utils/room-code";
import type { DeviceInfoIn } from "@/types/device";
import type { RoomKind, RoomTheme } from "@/types/room";
import { myRooms, rememberRoom, type MyRoom } from "./my-rooms";
import { setPendingFiles, setPendingText } from "./pending-files";
import { enterRendezvous } from "./rendezvous-join";
import { findSessionByCode, loadSession, saveSession, toStoredSession, type SessionMode } from "./session-store";

export interface StartOptions {
  kind?: RoomKind;
  theme?: RoomTheme;
  files?: LocalFile[];
  text?: string | null;
}

/** Creates a room (optionally with files to send) and returns its id. */
export async function startRoom(device: DeviceInfoIn, options: StartOptions = {}): Promise<string> {
  const session = await createRoom(device, undefined, options.kind ?? "standard", options.theme ?? "default");
  saveSession(toStoredSession(session));
  rememberRoom(session);
  setPendingFiles(options.files ?? []);
  setPendingText(options.text ?? null);
  return session.room_id;
}

/** Joins by code. Re-joining a room this device is already in keeps the same device. */
export async function joinByCode(code: string, device: DeviceInfoIn): Promise<string> {
  const normalized = normalizeRoomCode(code);
  const existing = findSessionByCode(normalized);
  const hostKey = myRooms.get().find((r) => r.roomCode === normalized)?.hostKey ?? null;
  const session = await joinRoom(normalized, device, existing?.token ?? null, undefined, hostKey);
  saveSession(toStoredSession(session));
  rememberRoom(session);
  return session.room_id;
}

/** "Rejoin" from Your active rooms: back into the room, as host if this device created it. */
export async function rejoinRoom(room: MyRoom, device: DeviceInfoIn): Promise<string> {
  if (loadSession(room.roomId)) return room.roomId;
  const session = await joinRoom(room.roomCode, device, null, undefined, room.hostKey);
  saveSession(toStoredSession(session));
  rememberRoom(session);
  return session.room_id;
}

/** My devices / personal room link. */
export function enterSharedRoom(key: string, mode: Extract<SessionMode, "my-devices" | "room-link">, device: DeviceInfoIn): Promise<string> {
  return enterRendezvous(key, mode, device);
}
