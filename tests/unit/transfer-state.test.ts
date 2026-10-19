import { ALLOWED, canTransition, InvalidTransitionError, transition, type LegStatus } from "@/lib/webrtc/transfer-state";
import type { TransferStatus } from "@/types/transfer";

// Copied verbatim from the backend's app/services/transfer_state.py (ALLOWED).
const BACKEND: Record<TransferStatus, TransferStatus[]> = {
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

const SERVER_STATES = Object.keys(BACKEND) as TransferStatus[];

describe("transfer state machine", () => {
  // Every pair of server states (121 cases), like the backend's own table test.
  for (const from of SERVER_STATES) {
    for (const to of SERVER_STATES) {
      const allowed = BACKEND[from].includes(to);
      it(`${from} → ${to} is ${allowed ? "allowed" : "rejected"}`, () => {
        expect(canTransition(from, to)).toBe(allowed);
      });
    }
  }

  it("has client-only states before the server knows the transfer", () => {
    expect(canTransition("queued", "requesting")).toBe(true);
    expect(canTransition("requesting", "pending")).toBe(true);
    expect(canTransition("queued", "transferring")).toBe(false);
  });

  it("throws on invalid local transitions", () => {
    expect(() => transition("completed", "transferring")).toThrow(InvalidTransitionError);
    expect(transition("transferring", "paused")).toBe("paused");
  });

  it("covers every state", () => {
    const all: LegStatus[] = ["queued", "requesting", ...SERVER_STATES];
    expect(Object.keys(ALLOWED).sort()).toEqual([...all].sort());
  });
});
