// Runtime checks for inbound WebSocket messages. The server is trusted for shape, but a
// proxy, a version skew or a bug must never crash the client, so anything that does not
// match the contract is dropped.
import type { ServerMessage, TransferEventType } from "@/types/signaling";
import { TRANSFER_EVENT_TYPES } from "@/types/signaling";

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (o: Obj, k: string) => typeof o[k] === "string";
const num = (o: Obj, k: string) => typeof o[k] === "number" && Number.isFinite(o[k]);
const nullableStr = (o: Obj, k: string) => o[k] === null || o[k] === undefined || str(o, k);

function isDevice(value: unknown): boolean {
  return (
    isObj(value) &&
    str(value, "device_id") &&
    str(value, "device_name") &&
    str(value, "device_type") &&
    str(value, "connection_state") &&
    typeof value.is_host === "boolean"
  );
}

function isRoom(value: unknown): boolean {
  return (
    isObj(value) &&
    str(value, "room_id") &&
    str(value, "room_code") &&
    str(value, "expires_at") &&
    Array.isArray(value.devices) &&
    value.devices.every(isDevice)
  );
}

function isRange(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

function isTransfer(value: unknown): boolean {
  if (!isObj(value)) return false;
  const file = value.file;
  return (
    str(value, "transfer_id") &&
    str(value, "sender_id") &&
    str(value, "status") &&
    Array.isArray(value.recipients) &&
    value.recipients.every(
      (leg) =>
        isObj(leg) &&
        str(leg, "device_id") &&
        str(leg, "status") &&
        Array.isArray(leg.received_ranges) &&
        leg.received_ranges.every(isRange),
    ) &&
    isObj(file) &&
    str(file, "file_name") &&
    num(file, "file_size") &&
    num(file, "chunk_size") &&
    num(file, "total_chunks")
  );
}

function isSessionDescription(value: unknown, type: "offer" | "answer"): boolean {
  return isObj(value) && value.type === type && str(value, "sdp");
}

function isRelayed(o: Obj): boolean {
  return str(o, "sender_id") && str(o, "target_id") && str(o, "connection_id");
}

const transferEventTypes: ReadonlySet<string> = new Set<TransferEventType>(TRANSFER_EVENT_TYPES);

function isValid(o: Obj): boolean {
  switch (o.type) {
    case "room_state":
      return (
        isRoom(o.room) &&
        str(o, "self_device_id") &&
        Array.isArray(o.peers) &&
        o.peers.every((p) => isDevice(p) && isObj(p) && typeof p.polite === "boolean") &&
        Array.isArray(o.ice_servers) &&
        isObj(o.transfer_config) &&
        num(o, "heartbeat_seconds")
      );
    case "peer_joined":
    case "peer_updated":
      return isDevice(o.device);
    case "peer_left":
      return str(o, "device_id") && str(o, "reason");
    case "offer":
      return isRelayed(o) && isSessionDescription(o.payload, "offer");
    case "answer":
      return isRelayed(o) && isSessionDescription(o.payload, "answer");
    case "ice_candidate":
      return (
        isRelayed(o) && isObj(o.payload) && (o.payload.candidate === null || str(o.payload, "candidate"))
      );
    case "connection_state":
      return isRelayed(o) && str(o, "state");
    case "ping":
      return num(o, "ts");
    case "pong":
      return true;
    case "error":
      return str(o, "code") && str(o, "message") && nullableStr(o, "ref");
    case "room_closed":
    case "room_expired":
      return str(o, "room_id");
    case "room_updated":
      return isRoom(o.room);
    default:
      return (
        typeof o.type === "string" &&
        transferEventTypes.has(o.type) &&
        isTransfer(o.transfer) &&
        nullableStr(o, "actor_id") &&
        (o.device_ids === undefined ||
          (Array.isArray(o.device_ids) && o.device_ids.every((d) => typeof d === "string")))
      );
  }
}

/** Parses one WebSocket text frame. Returns null for anything outside the contract. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== "string") return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(data) || !isValid(data)) return null;
  if (transferEventTypes.has(String(data.type))) {
    // Fill defaults the server may omit so consumers can rely on the full shape.
    if (data.device_ids === undefined) data.device_ids = [];
    if (data.reason === undefined) data.reason = null;
    if (data.actor_id === undefined) data.actor_id = null;
  }
  // The checks above establish the discriminated shape.
  return data as unknown as ServerMessage;
}
