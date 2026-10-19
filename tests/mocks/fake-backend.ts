// In-memory stand-in for the backend's transfer service and WebSocket fan-out, following
// app/services/transfer_state.py (ALLOWED, ACTION_SOURCES, roles) and transfer_service.py
// (per-device limit, events to sender and recipients).
import { ApiError } from "@/lib/api/errors";
import type { TransferAction } from "@/lib/api/transfers";
import { ALLOWED } from "@/lib/webrtc/transfer-state";
import type { TransferApi } from "@/lib/webrtc/transfer-manager";
import type { ClientMessage, TransferEvent, TransferEventType } from "@/types/signaling";
import type { TransferConfigView, TransferCreate, TransferStatus, TransferView } from "@/types/transfer";

const TARGET: Record<TransferAction, TransferStatus> = {
  accept: "accepted",
  reject: "rejected",
  connect: "connecting",
  start: "transferring",
  pause: "paused",
  resume: "transferring",
  complete: "completed",
  fail: "failed",
  retry: "retrying",
  cancel: "cancelled",
};
const EVENT: Record<TransferAction, TransferEventType> = {
  accept: "transfer_accepted",
  reject: "transfer_rejected",
  connect: "transfer_connecting",
  start: "transfer_started",
  pause: "transfer_paused",
  resume: "transfer_resumed",
  complete: "transfer_completed",
  fail: "transfer_failed",
  retry: "transfer_retrying",
  cancel: "transfer_cancelled",
};
const SOURCES: Partial<Record<TransferAction, TransferStatus[]>> = {
  start: ["accepted", "connecting", "retrying"],
  resume: ["paused"],
};
const RECIPIENT_ONLY: TransferAction[] = ["accept", "reject", "complete"];
const TERMINAL: TransferStatus[] = ["rejected", "completed", "cancelled", "expired"];

export const TEST_CONFIG: TransferConfigView = {
  recommended_chunk_size: 64 * 1024,
  min_chunk_size: 16 * 1024,
  max_chunk_size: 8 * 1024 * 1024,
  max_recipients: 19,
  max_transfer_duration_seconds: 86_400,
  resume_window_seconds: 3600,
  require_recipient_acceptance: true,
  cloud_fallback_enabled: false,
};

let counter = 0;

export class FakeBackend {
  readonly transfers = new Map<string, TransferView>();
  readonly listeners = new Map<string, (event: TransferEvent) => void>();
  /** Highest number of unfinished transfers any sender had at once. */
  maxUnfinishedSeen = 0;
  /** Behave like a server that predates `batch_id` (rejects the unknown field). */
  rejectBatchIds = false;

  constructor(private readonly maxActivePerDevice = 20) {}

  connect(deviceId: string, onEvent: (event: TransferEvent) => void): void {
    this.listeners.set(deviceId, onEvent);
  }

  apiFor(deviceId: string): TransferApi {
    return {
      create: async (body) => this.create(deviceId, body),
      act: async (id, action, body) => this.act(deviceId, id, action, body ?? {}),
      get: async (id) => this.get(id),
    };
  }

  /** Handles the client→server WebSocket messages the manager sends (checkpoints). */
  wsFor(deviceId: string): (message: ClientMessage) => void {
    return (message) => {
      if (message.type !== "transfer_checkpoint") return;
      const view = this.transfers.get(message.transfer_id);
      const leg = view?.recipients.find((l) => l.device_id === deviceId);
      if (!view || !leg) return;
      leg.received_ranges = message.received_ranges;
      leg.last_verified_chunk = message.last_verified_chunk ?? null;
      this.emit(view, "transfer_checkpoint", deviceId, [deviceId], null, [view.sender_id]);
    };
  }

  unfinished(senderId: string): number {
    return [...this.transfers.values()].filter((t) => t.sender_id === senderId && t.finished_at === null).length;
  }

  private create(senderId: string, body: TransferCreate): TransferView {
    if (this.rejectBatchIds && body.batch_id !== undefined) {
      throw new ApiError(422, "VALIDATION_ERROR", "Extra inputs are not permitted");
    }
    if (this.unfinished(senderId) >= this.maxActivePerDevice) {
      throw new ApiError(429, "TRANSFER_LIMIT_REACHED", "Too many active transfers for this device.");
    }
    const chunk = body.file.chunk_size ?? TEST_CONFIG.recommended_chunk_size;
    const total = Math.ceil(body.file.file_size / chunk);
    if (body.file.total_chunks !== undefined && body.file.total_chunks !== total) {
      throw new ApiError(422, "VALIDATION_ERROR", "total_chunks mismatch");
    }
    const now = new Date().toISOString();
    counter += 1;
    const view: TransferView = {
      transfer_id: `tr_test${String(counter).padStart(16, "0")}`,
      room_id: "rm_test",
      sender_id: senderId,
      recipient_ids: [...body.recipient_ids],
      recipients: body.recipient_ids.map((id) => ({
        device_id: id,
        status: "pending",
        updated_at: now,
        received_ranges: [],
        last_verified_chunk: null,
        failure_reason: null,
      })),
      file: {
        file_name: body.file.file_name,
        file_size: body.file.file_size,
        mime_type: body.file.mime_type ?? "application/octet-stream",
        chunk_size: chunk,
        total_chunks: total,
        sha256: null,
      },
      encryption: null,
      mode: "p2p",
      batch_id: body.batch_id ?? null,
      status: "pending",
      created_at: now,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      finished_at: null,
    };
    this.transfers.set(view.transfer_id, view);
    this.maxUnfinishedSeen = Math.max(this.maxUnfinishedSeen, this.unfinished(senderId));
    this.emit(view, "transfer_request", senderId, view.recipient_ids, null, view.recipient_ids);
    this.emit(view, "transfer_created", senderId, view.recipient_ids, null, [senderId]);
    return clone(view);
  }

  private act(actorId: string, id: string, action: TransferAction, body: { device_id?: string; reason?: string }): TransferView {
    const view = this.transfers.get(id);
    if (!view) throw new ApiError(404, "TRANSFER_NOT_FOUND", "Transfer not found.");
    const role = actorId === view.sender_id ? "sender" : view.recipient_ids.includes(actorId) ? "recipient" : null;
    if (!role) throw new ApiError(403, "FORBIDDEN", "Not a participant.");
    if (role === "sender" && RECIPIENT_ONLY.includes(action)) throw new ApiError(403, "FORBIDDEN", "Recipient only.");
    const legIds = role === "recipient" ? [actorId] : body.device_id ? [body.device_id] : [...view.recipient_ids];
    const affected: string[] = [];
    for (const legId of legIds) {
      const leg = view.recipients.find((l) => l.device_id === legId);
      if (!leg) throw new ApiError(404, "DEVICE_NOT_FOUND", "Not a recipient.");
      const path: TransferStatus[] = action === "start" && leg.status === "accepted" ? ["connecting", "transferring"] : [TARGET[action]];
      const sources = SOURCES[action];
      let state = leg.status;
      let ok = !sources || sources.includes(state);
      for (const step of path) {
        if (!ok || !ALLOWED[state].includes(step)) {
          ok = false;
          break;
        }
        state = step;
      }
      if (!ok) {
        if (legIds.length === 1) throw new ApiError(409, "INVALID_STATE", `Cannot ${action} a leg that is ${leg.status}.`);
        continue;
      }
      leg.status = state;
      leg.updated_at = new Date().toISOString();
      if (action === "fail") leg.failure_reason = body.reason ?? null;
      affected.push(legId);
    }
    if (affected.length === 0) throw new ApiError(409, "INVALID_STATE", `Cannot ${action}.`);
    view.status = derive(view.recipients.map((l) => l.status));
    if (view.recipients.every((l) => TERMINAL.includes(l.status))) view.finished_at = new Date().toISOString();
    this.emit(view, EVENT[action], actorId, affected, body.reason ?? null, [view.sender_id, ...view.recipient_ids]);
    return clone(view);
  }

  /** Server-driven pause, as when a device's socket drops past the grace period. */
  serverPause(id: string, deviceId: string): void {
    const view = this.transfers.get(id);
    const leg = view?.recipients.find((l) => l.device_id === deviceId);
    if (!view || !leg || leg.status !== "transferring") return;
    leg.status = "paused";
    this.emit(view, "transfer_paused", null, [deviceId], "disconnected", [view.sender_id, ...view.recipient_ids]);
  }

  private get(id: string): TransferView {
    const view = this.transfers.get(id);
    if (!view) throw new ApiError(404, "TRANSFER_NOT_FOUND", "Transfer not found.");
    return clone(view);
  }

  private emit(
    view: TransferView,
    type: TransferEventType,
    actorId: string | null,
    deviceIds: string[],
    reason: string | null,
    to: string[],
  ): void {
    const event: TransferEvent = { type, transfer: clone(view), actor_id: actorId, device_ids: deviceIds, reason };
    for (const deviceId of new Set(to)) {
      const listener = this.listeners.get(deviceId);
      // WebSocket delivery is asynchronous.
      if (listener) setTimeout(() => listener(structuredClone(event)), 1);
    }
  }
}

function derive(statuses: TransferStatus[]): TransferStatus {
  const unique = new Set(statuses);
  if (unique.size === 1) return statuses[0]!;
  for (const s of ["transferring", "connecting", "retrying", "paused", "failed", "accepted", "pending"] as const) {
    if (unique.has(s)) return s;
  }
  if (unique.has("completed")) return "completed";
  if (unique.has("cancelled")) return "cancelled";
  return unique.size === 1 && unique.has("rejected") ? "rejected" : "expired";
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
