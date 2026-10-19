import type { WebSocketLike } from "@/lib/webrtc/signaling-client";

export class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  closedWith: number | null = null;
  onopen: WebSocketLike["onopen"] = null;
  onclose: WebSocketLike["onclose"] = null;
  onerror: WebSocketLike["onerror"] = null;
  onmessage: WebSocketLike["onmessage"] = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  static reset(): void {
    FakeSocket.instances = [];
  }

  static latest(): FakeSocket {
    const socket = FakeSocket.instances[FakeSocket.instances.length - 1];
    if (!socket) throw new Error("no socket created");
    return socket;
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("not open");
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code = 1000): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closedWith = code;
    this.onclose?.({ code });
  }

  // --- test controls ---
  serverOpen(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  serverSend(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  serverClose(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  sentTypes(): string[] {
    return this.sent.map((m) => String(m.type));
  }
}

export function roomStateEvent(selfId = "dv_self00000000000000", peers: unknown[] = []) {
  return {
    type: "room_state",
    self_device_id: selfId,
    room: {
      room_id: "rm_test",
      room_code: "K7X9PQ",
      join_url: "https://droply.test/join/K7X9PQ",
      created_at: "2026-01-01T00:00:00Z",
      expires_at: "2099-01-01T00:00:00Z",
      max_expires_at: "2099-01-01T00:00:00Z",
      status: "open",
      max_devices: 20,
      host_device_id: selfId,
      devices: [],
    },
    peers,
    ice_servers: [{ urls: ["stun:stun.test:3478"], username: null, credential: null }],
    transfer_config: {
      recommended_chunk_size: 4194304,
      min_chunk_size: 16384,
      max_chunk_size: 67108864,
      max_recipients: 19,
      max_transfer_duration_seconds: 86400,
      resume_window_seconds: 3600,
      require_recipient_acceptance: true,
      cloud_fallback_enabled: false,
    },
    heartbeat_seconds: 30,
  };
}
