// WebSocket control channel to the backend (/ws/v1/rooms/{room_id}).
//
// - The token is never in the URL: the first message is `join`, then the server replies
//   with `room_state`.
// - Replies `pong` to the server's `ping`, and treats 75 s of silence as a dead socket.
// - Keeps outbound traffic under the server's 200 messages / 10 s limit.
// - Reconnects with exponential backoff, except after close codes that mean "stop".
import { Backoff, SIGNALING_BACKOFF } from "@/lib/utils/backoff";
import { Emitter, Store } from "@/lib/utils/emitter";
import { logger } from "@/lib/utils/logger";
import type {
  ClientMessage,
  DeviceUpdate,
  MessageOf,
  RoomStateEvent,
  ServerMessage,
  ServerMessageType,
  TransferCheckpointMessage,
} from "@/types/signaling";
import { parseServerMessage } from "./server-messages";

export type SignalingStatus = "idle" | "connecting" | "open" | "reconnecting" | "ended";

export type EndReason =
  | "left" // we sent `leave`
  | "unauthorized" // 4001: token invalid, expired or device removed
  | "forbidden" // 4003: origin not allowed or token for another room
  | "room_not_found" // 4004
  | "room_ended" // 4010, room_closed, room_expired
  | "replaced" // 4011: another tab took over this device
  | "removed" // 4012: removed by the host
  | "gave_up"; // reconnect attempts exhausted

export interface SignalingState {
  status: SignalingStatus;
  attempts: number;
  endReason: EndReason | null;
}

type Events = {
  message: ServerMessage;
  roomState: RoomStateEvent;
  ended: EndReason;
};

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

/**
 * React Native's WebSocket takes headers as a third argument. A browser sends its page
 * origin automatically; the app sends a fixed `Origin` that the backend's
 * WS_ALLOWED_ORIGINS must list (otherwise the server closes with 4003).
 */
export function nativeSocketFactory(origin: string): WebSocketFactory {
  type NativeWebSocketCtor = new (url: string, protocols?: string | string[] | null, options?: { headers: Record<string, string> }) => WebSocketLike;
  const NativeWebSocket = WebSocket as unknown as NativeWebSocketCtor;
  return (url) => new NativeWebSocket(url, null, { headers: { Origin: origin } });
}

export interface SignalingOptions {
  wsUrl: string;
  roomId: string;
  token: string;
  device?: DeviceUpdate;
  /** The Origin header sent by the default socket factory. */
  origin?: string;
  createSocket?: WebSocketFactory;
  /** Outbound messages allowed per 10 s (the server allows 200). */
  budget?: number;
  silenceTimeoutMs?: number;
}

const OPEN = 1;
const MAX_FRAME_BYTES = 60 * 1024;
const RELAYED_TYPES: ReadonlySet<string> = new Set(["offer", "answer", "ice_candidate", "connection_state"]);
const STOP_CODES: Record<number, EndReason> = {
  4001: "unauthorized",
  4003: "forbidden",
  4004: "room_not_found",
  4010: "room_ended",
  4011: "replaced",
  4012: "removed",
};

export class SignalingClient {
  readonly events = new Emitter<Events>();
  readonly state = new Store<SignalingState>({ status: "idle", attempts: 0, endReason: null });

  private socket: WebSocketLike | null = null;
  private authenticated = false;
  private readonly backoff = new Backoff(SIGNALING_BACKOFF);
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly outbox: ClientMessage[] = [];
  /** Latest checkpoint per transfer; older ones are superseded, not queued. */
  private readonly checkpoints = new Map<string, TransferCheckpointMessage>();
  private sentTimes: number[] = [];
  private messageTooLargeOnce = false;
  private ended = false;
  private device: DeviceUpdate | undefined;

  constructor(private readonly options: SignalingOptions) {
    this.device = options.device;
  }

  get status(): SignalingStatus {
    return this.state.getSnapshot().status;
  }

  /** Typed subscription to one server message type. */
  on<T extends ServerMessageType>(type: T, handler: (message: MessageOf<T>) => void): () => void {
    return this.events.on("message", (message) => {
      if (message.type === type) handler(message as MessageOf<T>);
    });
  }

  connect(): void {
    if (this.ended || this.socket) return;
    this.open();
  }

  /** Updates the name/type sent on the next `join` (e.g. after a rename). */
  setDevice(device: DeviceUpdate): void {
    this.device = device;
  }

  /** Sends a message, queueing it while the socket is (re)connecting or over budget. */
  send(message: ClientMessage): void {
    if (this.ended) return;
    if (message.type === "transfer_checkpoint") {
      this.checkpoints.set(message.transfer_id, message);
    } else {
      this.outbox.push(message);
    }
    this.flush();
  }

  /** Leaves the room for good: the server removes this device and revokes its token. */
  leave(): void {
    if (this.ended) return;
    const socket = this.socket;
    if (socket && socket.readyState === OPEN && this.authenticated) {
      try {
        socket.send(JSON.stringify({ type: "leave" }));
      } catch {
        // ignore
      }
    }
    this.end("left");
    socket?.close(1000, "leave");
  }

  /** Closes without leaving (page teardown); the server keeps the device for a grace period. */
  dispose(): void {
    if (this.ended) return;
    this.ended = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close(1000, "dispose");
    }
    this.state.set({ status: "ended", attempts: 0, endReason: null });
    this.events.clear();
  }

  /** Reconnects immediately (e.g. when the browser comes back online). */
  retryNow(): void {
    if (this.ended) return;
    if (this.state.getSnapshot().endReason === "gave_up") this.ended = false;
    if (this.socket) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.backoff.reset();
    this.open();
  }

  /**
   * Quick health check after the page was in the background (a phone's file picker or
   * camera, a locked screen). Frozen pages can come back with a socket that looks open but
   * is dead: ping, and reconnect at once if nothing answers within `timeoutMs`.
   */
  checkAlive(timeoutMs = 4000): void {
    if (this.ended) return;
    if (!this.socket) {
      this.retryNow();
      return;
    }
    if (!this.authenticated || this.socket.readyState !== OPEN) return;
    if (this.sendNow({ type: "ping", ts: Date.now() })) this.armSilenceTimer(timeoutMs);
  }

  // --- internals -------------------------------------------------------------

  private open(): void {
    const url = `${this.options.wsUrl}/rooms/${encodeURIComponent(this.options.roomId)}`;
    const create = this.options.createSocket ?? nativeSocketFactory(this.options.origin ?? "droply-app://mobile");
    const reconnecting = this.backoff.attempts > 0;
    this.state.set({ status: reconnecting ? "reconnecting" : "connecting", attempts: this.backoff.attempts, endReason: null });
    let socket: WebSocketLike;
    try {
      socket = create(url);
    } catch (error) {
      logger.warn("signaling", "socket creation failed", String(error));
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.authenticated = false;

    socket.onopen = () => {
      const join: ClientMessage = { type: "join", token: this.options.token };
      if (this.device) join.device = this.device;
      socket.send(JSON.stringify(join));
      this.armSilenceTimer();
    };
    socket.onmessage = (event) => this.onMessage(event.data);
    socket.onerror = () => {
      // A close event always follows; reconnect logic lives there.
    };
    socket.onclose = (event) => this.onClose(socket, event.code);
  }

  private onMessage(raw: unknown): void {
    this.armSilenceTimer();
    const message = parseServerMessage(raw);
    if (!message) {
      logger.warn("signaling", "dropped message outside the contract");
      return;
    }
    switch (message.type) {
      case "ping":
        this.sendNow({ type: "pong", ts: message.ts });
        break;
      case "room_state":
        this.authenticated = true;
        this.backoff.reset();
        this.state.set({ status: "open", attempts: 0, endReason: null });
        this.events.emit("roomState", message);
        this.flush();
        break;
      case "room_closed":
      case "room_expired":
        this.events.emit("message", message);
        this.end("room_ended");
        return;
      case "error":
        logger.warn("signaling", `server error ${message.code}`, { message: message.message, ref: message.ref });
        break;
      default:
        break;
    }
    this.events.emit("message", message);
  }

  private onClose(socket: WebSocketLike, code: number): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.authenticated = false;
    this.clearSilenceTimer();
    if (this.ended) return;
    // Offers and candidates for the old socket session would be stale after a reconnect;
    // the peer layer renegotiates instead.
    const kept = this.outbox.filter((m) => !RELAYED_TYPES.has(m.type));
    this.outbox.splice(0, this.outbox.length, ...kept);
    const stop = STOP_CODES[code];
    if (stop) {
      this.end(stop);
      return;
    }
    if (code === 4009) {
      logger.error("signaling", "server rejected an oversized message");
      if (this.messageTooLargeOnce) {
        this.end("gave_up");
        return;
      }
      this.messageTooLargeOnce = true;
    }
    this.scheduleReconnect(code === 4008 ? 4000 : 0);
  }

  private scheduleReconnect(minDelayMs = 0): void {
    const delay = this.backoff.next();
    if (delay === null) {
      this.end("gave_up");
      return;
    }
    this.state.set({ status: "reconnecting", attempts: this.backoff.attempts, endReason: null });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, Math.max(delay, minDelayMs));
  }

  private end(reason: EndReason): void {
    if (this.ended && reason !== "gave_up") return;
    this.ended = reason !== "gave_up";
    this.clearTimers();
    this.outbox.length = 0;
    this.checkpoints.clear();
    this.state.set({ status: "ended", attempts: this.backoff.attempts, endReason: reason });
    this.events.emit("ended", reason);
    if (reason !== "left") {
      const socket = this.socket;
      this.socket = null;
      if (socket) {
        socket.onclose = null;
        socket.close(1000);
      }
    }
  }

  private sendNow(message: ClientMessage): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) return false;
    const data = JSON.stringify(message);
    if (data.length > MAX_FRAME_BYTES) {
      logger.error("signaling", `refusing to send oversized ${message.type} (${data.length} bytes)`);
      return true; // Drop it: sending would close the socket.
    }
    try {
      socket.send(data);
      this.sentTimes.push(Date.now());
      return true;
    } catch {
      return false;
    }
  }

  private budgetLeft(now: number): number {
    const windowStart = now - 10_000;
    this.sentTimes = this.sentTimes.filter((t) => t > windowStart);
    return (this.options.budget ?? 150) - this.sentTimes.length;
  }

  private flush(): void {
    if (!this.authenticated || !this.socket || this.socket.readyState !== OPEN) return;
    const now = Date.now();
    while (this.budgetLeft(now) > 0) {
      const next = this.outbox[0];
      if (next) {
        if (!this.sendNow(next)) return;
        this.outbox.shift();
        continue;
      }
      const checkpoint = this.checkpoints.entries().next();
      if (checkpoint.done) return;
      const [transferId, message] = checkpoint.value;
      if (!this.sendNow(message)) return;
      this.checkpoints.delete(transferId);
    }
    // Over budget: try again when the oldest send leaves the 10 s window.
    if (!this.flushTimer && (this.outbox.length > 0 || this.checkpoints.size > 0)) {
      const oldest = this.sentTimes[0] ?? now;
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, Math.max(50, oldest + 10_000 - now));
    }
  }

  private armSilenceTimer(timeoutMs = this.options.silenceTimeoutMs ?? 75_000): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      logger.warn("signaling", "no traffic from server; reconnecting");
      const socket = this.socket;
      if (socket) {
        this.onClose(socket, 4000);
        socket.onclose = null;
        socket.close(4000);
      }
    }, timeoutMs);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  private clearTimers(): void {
    this.clearSilenceTimer();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.reconnectTimer = null;
    this.flushTimer = null;
  }
}
