// Rooms this device was in, for the History page: when, how long, and what moved. Kept only
// on this device (localStorage), like the transfer history. Never uploaded.
import { isRecord, LocalStore } from "@/lib/utils/local-store";
import { ROOM_KINDS, ROOM_THEMES, type RoomKind, type RoomTheme } from "@/types/room";

export type RoomEndReason = "expired" | "closed" | "removed" | "left";

export interface RoomHistoryEntry {
  roomId: string;
  roomCode: string;
  /** This device was the room's host at some point (usually: it created the room). */
  host: boolean;
  kind: RoomKind;
  theme: RoomTheme;
  /** "my-devices" and "room-link" rooms are opened by pairing / personal links. */
  mode: "standard" | "my-devices" | "room-link";
  /** Length the room was given; null for rooms without a time limit. */
  durationSeconds: number | null;
  timeExtended: boolean;
  joinedAt: number;
  /** Last time this device was seen in the room (ms); the end time if the room never ended here. */
  lastSeenAt: number;
  endedAt: number | null;
  endReason: RoomEndReason | null;
  peakDevices: number;
  sentFiles: number;
  sentBytes: number;
  receivedFiles: number;
  receivedBytes: number;
  chatMessages: number;
}

const MAX_ROOMS = 200;
const REASONS: readonly RoomEndReason[] = ["expired", "closed", "removed", "left"];
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isEntry(value: unknown): value is RoomHistoryEntry {
  return (
    isRecord(value) &&
    typeof value.roomId === "string" &&
    typeof value.roomCode === "string" &&
    typeof value.host === "boolean" &&
    (ROOM_KINDS as readonly unknown[]).includes(value.kind) &&
    (ROOM_THEMES as readonly unknown[]).includes(value.theme) &&
    (value.mode === "standard" || value.mode === "my-devices" || value.mode === "room-link") &&
    (value.durationSeconds === null || num(value.durationSeconds)) &&
    num(value.joinedAt) &&
    num(value.lastSeenAt) &&
    (value.endedAt === null || num(value.endedAt)) &&
    (value.endReason === null || (REASONS as readonly unknown[]).includes(value.endReason)) &&
    num(value.peakDevices) &&
    num(value.sentFiles) &&
    num(value.sentBytes) &&
    num(value.receivedFiles) &&
    num(value.receivedBytes) &&
    num(value.chatMessages)
  );
}

export const roomHistory = new LocalStore<RoomHistoryEntry[]>("droply:room-history", [], (raw) =>
  Array.isArray(raw) ? raw.filter(isEntry).slice(-MAX_ROOMS) : null,
);

export type RoomEntered = Pick<
  RoomHistoryEntry,
  "roomId" | "roomCode" | "host" | "kind" | "theme" | "mode" | "durationSeconds" | "timeExtended" | "peakDevices"
>;

/** Records entering a room. Coming back to a room this device was in reopens its entry. */
export function recordRoomEntered(room: RoomEntered): void {
  const now = Date.now();
  roomHistory.update((list) => {
    const previous = list.find((r) => r.roomId === room.roomId);
    const entry: RoomHistoryEntry = previous
      ? { ...previous, ...room, host: previous.host || room.host, peakDevices: Math.max(previous.peakDevices, room.peakDevices), lastSeenAt: now, endedAt: null, endReason: null }
      : {
          ...room,
          joinedAt: now,
          lastSeenAt: now,
          endedAt: null,
          endReason: null,
          sentFiles: 0,
          sentBytes: 0,
          receivedFiles: 0,
          receivedBytes: 0,
          chatMessages: 0,
        };
    return [...list.filter((r) => r.roomId !== room.roomId), entry].slice(-MAX_ROOMS);
  });
}

/** Updates a room's entry (no-op if it isn't recorded). */
export function updateRoomHistory(roomId: string, change: (entry: RoomHistoryEntry) => Partial<RoomHistoryEntry>): void {
  const list = roomHistory.get();
  const index = list.findIndex((r) => r.roomId === roomId);
  if (index < 0) return;
  const current = list[index]!;
  const next = { ...current, ...change(current), lastSeenAt: Date.now() };
  roomHistory.set(list.map((r, i) => (i === index ? next : r)));
}

export function recordRoomEnded(roomId: string, reason: RoomEndReason): void {
  updateRoomHistory(roomId, (entry) => (entry.endedAt === null ? { endedAt: Date.now(), endReason: reason } : {}));
}

export function clearRoomHistory(): void {
  roomHistory.set([]);
}
