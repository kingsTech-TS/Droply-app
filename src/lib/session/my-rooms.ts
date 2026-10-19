// Rooms this device created or joined, so they can be found again after leaving ("Your
// active rooms" on the home page). Kept in localStorage on this device only. The device
// token is never stored here; rejoining uses the room code like any other join. The
// creator's host key (from creating the room) is kept so they come back as host.
import { isRecord, LocalStore } from "@/lib/utils/local-store";
import { ROOM_KINDS, ROOM_THEMES, type RoomKind, type RoomSession, type RoomTheme } from "@/types/room";

export interface MyRoom {
  roomId: string;
  roomCode: string;
  /** This device created the room (it holds the host key). */
  created: boolean;
  hostKey: string | null;
  theme: RoomTheme;
  kind: RoomKind;
  /** When this device last entered the room (ms). */
  at: number;
}

const MAX_ROOMS = 10;

function isMyRoom(value: unknown): value is MyRoom {
  return (
    isRecord(value) &&
    typeof value.roomId === "string" &&
    typeof value.roomCode === "string" &&
    typeof value.created === "boolean" &&
    (value.hostKey === null || typeof value.hostKey === "string") &&
    (ROOM_THEMES as readonly unknown[]).includes(value.theme) &&
    (ROOM_KINDS as readonly unknown[]).includes(value.kind) &&
    typeof value.at === "number"
  );
}

export const myRooms = new LocalStore<MyRoom[]>("droply:my-rooms", [], (raw) =>
  Array.isArray(raw) ? raw.filter(isMyRoom).slice(0, MAX_ROOMS) : null,
);

/** Records a room this device entered by creating or joining it (newest first). */
export function rememberRoom(session: RoomSession): void {
  myRooms.update((list) => {
    const previous = list.find((r) => r.roomId === session.room_id);
    const hostKey = session.host_key ?? previous?.hostKey ?? null;
    const entry: MyRoom = {
      roomId: session.room_id,
      roomCode: session.room_code,
      created: hostKey !== null,
      hostKey,
      theme: session.room.theme,
      kind: session.room.kind,
      at: Date.now(),
    };
    return [entry, ...list.filter((r) => r.roomId !== session.room_id)].slice(0, MAX_ROOMS);
  });
}

/** Forgets rooms that ended, or that this device was removed from. */
export function forgetRooms(roomIds: readonly string[]): void {
  if (roomIds.length === 0) return;
  const gone = new Set(roomIds);
  const list = myRooms.get();
  if (list.some((r) => gone.has(r.roomId))) myRooms.set(list.filter((r) => !gone.has(r.roomId)));
}

/** Keeps the remembered theme in sync with the room (the host may change it). */
export function updateRememberedTheme(roomId: string, theme: RoomTheme): void {
  const list = myRooms.get();
  const room = list.find((r) => r.roomId === roomId);
  if (room && room.theme !== theme) myRooms.set(list.map((r) => (r.roomId === roomId ? { ...r, theme } : r)));
}
