// Wire protocol on the per-peer DataChannel.
//
// - String messages are small JSON control messages (`Ctl`).
// - ArrayBuffer messages are binary frames: a fixed 16-byte header and a slice of one chunk.
//
// A chunk (default 4 MiB, declared to the backend) is the unit of resume, hashing and
// storage. A frame (default 64 KiB, at most the SCTP max message size) is one message.
//
// Each direction has its own slot namespace: frames always flow from the sender of that
// slot, and `role` on `file_close` says which side is closing.
import type { ChunkRange } from "@/types/transfer";

export const PROTOCOL_VERSION = 1;
export const FRAME_MAGIC = 0xd7;
export const FRAME_HEADER_BYTES = 16;
export const MAX_SLOT = 0xffff;

export interface Frame {
  slot: number;
  chunkIndex: number;
  offset: number;
  payload: Uint8Array;
}

/** Copies header + payload into one new buffer (the only copy on the send path). */
export function encodeFrame(slot: number, chunkIndex: number, offset: number, payload: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(FRAME_HEADER_BYTES + payload.byteLength);
  const view = new DataView(buffer);
  view.setUint8(0, FRAME_MAGIC);
  view.setUint8(1, PROTOCOL_VERSION);
  view.setUint16(2, slot, true);
  view.setUint32(4, chunkIndex, true);
  view.setUint32(8, offset, true);
  view.setUint32(12, payload.byteLength, true);
  new Uint8Array(buffer, FRAME_HEADER_BYTES).set(payload);
  return buffer;
}

/** Returns a view into `buffer` (no copy), or null if the header is malformed. */
export function decodeFrame(buffer: ArrayBuffer): Frame | null {
  if (buffer.byteLength < FRAME_HEADER_BYTES) return null;
  const view = new DataView(buffer);
  if (view.getUint8(0) !== FRAME_MAGIC || view.getUint8(1) !== PROTOCOL_VERSION) return null;
  const length = view.getUint32(12, true);
  if (length !== buffer.byteLength - FRAME_HEADER_BYTES) return null;
  return {
    slot: view.getUint16(2, true),
    chunkIndex: view.getUint32(4, true),
    offset: view.getUint32(8, true),
    payload: new Uint8Array(buffer, FRAME_HEADER_BYTES, length),
  };
}

export type CloseReason = "done" | "paused" | "cancelled" | "error";

export type Ctl =
  // Exchanged once when the channel opens.
  | { t: "hello"; v: number; maxFrame: number }
  // Sender → receiver: start (or restart) a file in this slot.
  | {
      t: "file_open";
      slot: number;
      transferId: string;
      size: number;
      chunkSize: number;
      totalChunks: number;
      /** Folder path relative to the selected folder ("photos/2026"); untrusted. */
      path?: string;
      /** Speed test: synthetic bytes, discarded on receipt, no server transfer. */
      test?: boolean;
    }
  // Small app messages between peers (text drops, chat, reactions, pairing).
  | { t: "app"; m: AppMessage }
  // Receiver → sender: ready, these chunks are already stored, and at most `window`
  // unacknowledged chunks may be in flight (receive-side memory bound).
  | { t: "file_ready"; slot: number; have: ChunkRange[]; window: number }
  // Sender → receiver: all frames of a chunk were sent; this is its digest.
  | { t: "chunk_end"; slot: number; index: number; sha256: string }
  // Receiver → sender: chunk verified and persisted (also returns one credit).
  | { t: "chunk_ack"; slot: number; index: number }
  // Receiver → sender: chunk digest did not match; send it again.
  | { t: "chunk_nack"; slot: number; index: number }
  // Sender → receiver: every chunk was acknowledged; this is the root digest.
  | { t: "file_end"; slot: number; root: string }
  // Receiver → sender: root digest check result.
  | { t: "file_done"; slot: number; ok: boolean }
  // Either side stops a slot. `role` is the role of the side that is closing.
  | { t: "file_close"; slot: number; role: "sender" | "receiver"; reason: CloseReason }
  // Sent before an intentional close so the other side does not try to recover.
  | { t: "bye" };

export const REACTIONS = ["👍", "❤️", "😂", "🔥", "🎉", "🙏"] as const;
export type Reaction = (typeof REACTIONS)[number];
export const MAX_TEXT_MESSAGE = 64 * 1024;
export const MAX_CHAT_MESSAGE = 2000;

export const MAX_REPLY_QUOTE = 200;
export const MAX_THUMB_REQUEST = 24;
/** Previews are small JPEGs; anything larger is dropped. */
export const MAX_THUMB_DATA = 96 * 1024;
export const MAX_MENTIONS = 50;

/** The chat message being replied to, quoted so it shows even if the receiver missed it. */
export interface ChatReply {
  id: string;
  /** Device that wrote the quoted message. */
  author: string;
  text: string;
}

export type AppMessage =
  | { kind: "text"; id: string; text: string }
  | { kind: "chat"; id: string; text: string; replyTo?: ChatReply; mentions?: string[] }
  // Adds (`on`) or removes this device's reaction on a chat message; sent to everyone.
  | { kind: "chat_reaction"; messageId: string; emoji: Reaction; on: boolean }
  | { kind: "reaction"; transferId: string; emoji: Reaction }
  // Event rooms. Guest → host: send me this shared file, as a transfer with `requestId` as
  // its batch id (so this guest accepts it without asking).
  | { kind: "event_get"; itemId: string; requestId: string }
  // Guest → host: previews of these shared files, please.
  | { kind: "event_thumbs"; itemIds: string[] }
  // Host → guest: a small JPEG preview (data URL).
  | { kind: "event_thumb"; itemId: string; data: string }
  // Host → guest: this file isn't available any more (e.g. the host reloaded the page).
  | { kind: "event_unavailable"; itemId: string }
  // Pairing ("My devices"): the requester shares its group key over the encrypted channel.
  | { kind: "pair_request"; key: string; name: string }
  | { kind: "pair_accept"; name: string }
  | { kind: "pair_decline" };
export type ChatMessage = Extract<AppMessage, { kind: "chat" }>;

type Obj = Record<string, unknown>;

const isInt = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isStr = (v: unknown, max: number, min = 0): v is string =>
  typeof v === "string" && v.length >= min && v.length <= max;
const isId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);

function parseApp(value: unknown): AppMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const m = value as Obj;
  switch (m.kind) {
    case "text":
      return isId(m.id) && isStr(m.text, MAX_TEXT_MESSAGE, 1) ? { kind: "text", id: m.id, text: m.text } : null;
    case "chat": {
      if (!isId(m.id) || !isStr(m.text, MAX_CHAT_MESSAGE, 1)) return null;
      const chat: ChatMessage = { kind: "chat", id: m.id, text: m.text };
      // Older peers send neither field; malformed extras are dropped, not the message.
      const reply = m.replyTo as Obj | undefined;
      if (typeof reply === "object" && reply !== null && isId(reply.id) && isId(reply.author) && isStr(reply.text, MAX_REPLY_QUOTE)) {
        chat.replyTo = { id: reply.id, author: reply.author, text: reply.text };
      }
      if (Array.isArray(m.mentions) && m.mentions.length <= MAX_MENTIONS && m.mentions.every(isId)) {
        chat.mentions = [...new Set(m.mentions as string[])];
      }
      return chat;
    }
    case "event_get":
      return isId(m.itemId) && isId(m.requestId) ? { kind: "event_get", itemId: m.itemId, requestId: m.requestId } : null;
    case "event_thumbs":
      return Array.isArray(m.itemIds) && m.itemIds.length <= MAX_THUMB_REQUEST && m.itemIds.every(isId)
        ? { kind: "event_thumbs", itemIds: m.itemIds as string[] }
        : null;
    case "event_thumb":
      return isId(m.itemId) && isStr(m.data, MAX_THUMB_DATA, 1) && (m.data as string).startsWith("data:image/jpeg;base64,")
        ? { kind: "event_thumb", itemId: m.itemId, data: m.data as string }
        : null;
    case "event_unavailable":
      return isId(m.itemId) ? { kind: "event_unavailable", itemId: m.itemId } : null;
    case "chat_reaction":
      return isId(m.messageId) && (REACTIONS as readonly unknown[]).includes(m.emoji) && typeof m.on === "boolean"
        ? { kind: "chat_reaction", messageId: m.messageId, emoji: m.emoji as Reaction, on: m.on }
        : null;
    case "reaction":
      return typeof m.transferId === "string" &&
        m.transferId.length <= 70 &&
        (REACTIONS as readonly unknown[]).includes(m.emoji)
        ? { kind: "reaction", transferId: m.transferId, emoji: m.emoji as Reaction }
        : null;
    case "pair_request":
      return typeof m.key === "string" && /^[A-Za-z0-9_-]{22,128}$/.test(m.key) && isStr(m.name, 64, 1)
        ? { kind: "pair_request", key: m.key, name: m.name }
        : null;
    case "pair_accept":
      return isStr(m.name, 64, 1) ? { kind: "pair_accept", name: m.name } : null;
    case "pair_decline":
      return { kind: "pair_decline" };
    default:
      return null;
  }
}
const isSlot = (v: unknown): v is number => isInt(v, 0, MAX_SLOT);
const isHex64 = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

function isRanges(v: unknown): v is ChunkRange[] {
  return (
    Array.isArray(v) &&
    v.length <= 100_000 &&
    v.every((r) => Array.isArray(r) && r.length === 2 && isInt(r[0]) && isInt(r[1]) && r[0] <= r[1])
  );
}

/** Parses a control message from the remote peer. Returns null for anything malformed. */
export function parseCtl(raw: string): Ctl | null {
  if (raw.length > 4 * 1024 * 1024) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const m = data as Obj;
  switch (m.t) {
    case "hello":
      return isInt(m.v) && isInt(m.maxFrame, 1) ? { t: "hello", v: m.v, maxFrame: m.maxFrame } : null;
    case "file_open":
      return isSlot(m.slot) &&
        typeof m.transferId === "string" &&
        m.transferId.length <= 70 &&
        isInt(m.size, 1) &&
        isInt(m.chunkSize, 1) &&
        isInt(m.totalChunks, 1) &&
        m.totalChunks === Math.ceil(m.size / m.chunkSize) &&
        (m.path === undefined || isStr(m.path, 1024)) &&
        (m.test === undefined || typeof m.test === "boolean")
        ? {
            t: "file_open",
            slot: m.slot,
            transferId: m.transferId,
            size: m.size,
            chunkSize: m.chunkSize,
            totalChunks: m.totalChunks,
            ...(typeof m.path === "string" && m.path ? { path: m.path } : {}),
            ...(m.test === true ? { test: true } : {}),
          }
        : null;
    case "app": {
      const app = parseApp(m.m);
      return app ? { t: "app", m: app } : null;
    }
    case "file_ready":
      return isSlot(m.slot) && isRanges(m.have) && isInt(m.window, 1, 64)
        ? { t: "file_ready", slot: m.slot, have: m.have, window: m.window }
        : null;
    case "chunk_end":
      return isSlot(m.slot) && isInt(m.index) && isHex64(m.sha256)
        ? { t: "chunk_end", slot: m.slot, index: m.index, sha256: m.sha256 }
        : null;
    case "chunk_ack":
    case "chunk_nack":
      return isSlot(m.slot) && isInt(m.index) ? { t: m.t, slot: m.slot, index: m.index } : null;
    case "file_end":
      return isSlot(m.slot) && isHex64(m.root) ? { t: "file_end", slot: m.slot, root: m.root } : null;
    case "file_done":
      return isSlot(m.slot) && typeof m.ok === "boolean" ? { t: "file_done", slot: m.slot, ok: m.ok } : null;
    case "file_close":
      return isSlot(m.slot) &&
        (m.role === "sender" || m.role === "receiver") &&
        (m.reason === "done" || m.reason === "paused" || m.reason === "cancelled" || m.reason === "error")
        ? { t: "file_close", slot: m.slot, role: m.role, reason: m.reason }
        : null;
    case "bye":
      return { t: "bye" };
    default:
      return null;
  }
}

export function chunkLength(index: number, size: number, chunkSize: number): number {
  const start = index * chunkSize;
  return Math.max(0, Math.min(chunkSize, size - start));
}
