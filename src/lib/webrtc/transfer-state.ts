// Transfer leg state machine. Server states and transitions are copied from the backend's
// app/services/transfer_state.py (ALLOWED); `queued` and `requesting` exist only on the
// client, before the server knows about the transfer.
import type { TransferStatus } from "@/types/transfer";

export type LocalStatus = "queued" | "requesting";
export type LegStatus = LocalStatus | TransferStatus;

export const ALLOWED: Readonly<Record<LegStatus, readonly LegStatus[]>> = {
  queued: ["requesting", "cancelled"],
  requesting: ["pending", "queued", "failed", "cancelled"],
  pending: ["accepted", "rejected", "cancelled", "expired"],
  accepted: ["connecting", "cancelled", "expired"],
  connecting: ["transferring", "failed", "cancelled", "expired"],
  transferring: ["paused", "completed", "failed", "cancelled", "expired"],
  paused: ["transferring", "failed", "cancelled", "expired"],
  failed: ["retrying", "cancelled", "expired"],
  retrying: ["connecting", "transferring", "failed", "cancelled", "expired"],
  rejected: [],
  completed: [],
  cancelled: [],
  expired: [],
};

export const TERMINAL: ReadonlySet<LegStatus> = new Set(["rejected", "completed", "cancelled", "expired"]);
export const ACTIVE: ReadonlySet<LegStatus> = new Set(["connecting", "transferring", "retrying"]);

export function canTransition(from: LegStatus, to: LegStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function isTerminal(status: LegStatus): boolean {
  return TERMINAL.has(status);
}

/** Unfinished on the server: counts against the backend's per-device transfer limit. */
export function isUnfinishedOnServer(status: LegStatus): boolean {
  return status !== "queued" && status !== "requesting" && !isTerminal(status);
}

export class InvalidTransitionError extends Error {
  override readonly name = "InvalidTransitionError";
  constructor(from: LegStatus, to: LegStatus) {
    super(`Invalid transfer transition ${from} → ${to}`);
  }
}

/**
 * Local transitions must be valid. Server views always win (see applyServerStatus), because
 * the server is the source of truth and may have moved on (e.g. expiry).
 */
export function transition(from: LegStatus, to: LegStatus): LegStatus {
  if (from === to) return to;
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
  return to;
}

export function applyServerStatus(_current: LegStatus, server: TransferStatus): LegStatus {
  return server;
}

const LABELS: Record<LegStatus, string> = {
  queued: "Queued",
  requesting: "Preparing",
  pending: "Waiting for acceptance",
  accepted: "Accepted",
  rejected: "Declined",
  connecting: "Connecting",
  transferring: "Transferring",
  paused: "Paused",
  completed: "Complete",
  failed: "Interrupted",
  retrying: "Retrying",
  cancelled: "Cancelled",
  expired: "Expired",
};

export function statusLabel(status: LegStatus): string {
  return LABELS[status];
}
