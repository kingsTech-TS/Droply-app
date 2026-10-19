// Wraps one RTCDataChannel: control/frame demultiplexing and send-side backpressure.
//
// React Native note: in react-native-webrtc, `bufferedAmount` is updated by native events, not
// synchronously on `send()` as in browsers. The transport therefore keeps an optimistic count
// (bytes handed to the channel since the last native update) and uses whichever is larger, so
// backpressure never runs ahead of a stale native value.
import { Emitter } from "@/lib/utils/emitter";
import { logger } from "@/lib/utils/logger";
import { decodeFrame, parseCtl, type Ctl, type Frame } from "./protocol";

export type DataChannelState = "connecting" | "open" | "closing" | "closed";

type ChannelListener = (event: { data?: unknown; type?: string; error?: { message?: string } }) => void;

/** The subset of RTCDataChannel this module uses (react-native-webrtc, or a fake in tests). */
export interface DataChannelLike {
  readonly readyState: DataChannelState | string;
  readonly bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  binaryType: string;
  send(data: string | ArrayBuffer): void;
  close(): void;
  addEventListener(type: string, listener: ChannelListener): void;
  removeEventListener(type: string, listener: ChannelListener): void;
}

/** If the native value hasn't moved for this long, trust it over the optimistic count. */
const NATIVE_STALE_MS = 1_000;

export class ChannelClosedError extends Error {
  override readonly name = "ChannelClosedError";
  constructor() {
    super("DataChannel closed");
  }
}

type Events = {
  ctl: Ctl;
  frame: Frame;
  open: void;
  close: void;
};

// Chrome closes a channel whose send buffer grows past ~16 MiB.
export const MAX_HIGH_WATER = 8 * 1024 * 1024;
export const MIN_HIGH_WATER = 256 * 1024;
// Some browsers fire `bufferedamountlow` unreliably, so waits are also re-checked on a timer.
const DRAIN_POLL_MS = 100;

export class DataChannelTransport {
  readonly events = new Emitter<Events>();
  private highWater: number;
  private waiters: Array<() => void> = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private blocked = false;
  /** Total bytes handed to the channel; the throughput estimator uses its rate. */
  bytesQueued = 0;
  private optimistic = 0;
  private lastNative = 0;
  private lastNativeChangeAt = Date.now();

  constructor(
    private readonly channel: DataChannelLike,
    highWater = 1024 * 1024,
  ) {
    this.highWater = clampHighWater(highWater);
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = Math.floor(this.highWater / 2);
    channel.addEventListener("message", this.onMessage);
    channel.addEventListener("bufferedamountlow", this.wake);
    channel.addEventListener("open", this.onOpen);
    channel.addEventListener("close", this.onClose);
    channel.addEventListener("error", this.onError);
    if (channel.readyState === "closed" || channel.readyState === "closing") this.closed = true;
  }

  get isOpen(): boolean {
    return !this.closed && this.channel.readyState === "open";
  }

  /** Bytes waiting in the send buffer: the native value, or more if it hasn't caught up yet. */
  get bufferedAmount(): number {
    const native = this.channel.bufferedAmount;
    const now = Date.now();
    if (native !== this.lastNative) {
      this.lastNative = native;
      this.lastNativeChangeAt = now;
      this.optimistic = native;
    } else if (now - this.lastNativeChangeAt > NATIVE_STALE_MS) {
      this.optimistic = native;
    }
    return Math.max(native, this.optimistic);
  }

  get currentHighWater(): number {
    return this.highWater;
  }

  setHighWater(bytes: number): void {
    this.highWater = clampHighWater(bytes);
    this.channel.bufferedAmountLowThreshold = Math.floor(this.highWater / 2);
    this.wake();
  }

  sendCtl(message: Ctl): boolean {
    if (!this.isOpen) return false;
    try {
      this.channel.send(JSON.stringify(message));
      return true;
    } catch (error) {
      logger.warn("datachannel", "control send failed", String(error));
      return false;
    }
  }

  /** True if a sender had to wait for buffer space since the last call (then resets). */
  takeBlocked(): boolean {
    const blocked = this.blocked;
    this.blocked = false;
    return blocked;
  }

  /** Waits until the send buffer is below the high-water mark. Rejects if the channel closes. */
  async waitForCapacity(): Promise<void> {
    while (this.bufferedAmount > this.highWater) {
      this.blocked = true;
      if (!this.isOpen) throw new ChannelClosedError();
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        this.ensurePoll();
      });
    }
    if (!this.isOpen) throw new ChannelClosedError();
  }

  /** Sends one binary frame, respecting backpressure. */
  async sendFrame(frame: ArrayBuffer): Promise<void> {
    await this.waitForCapacity();
    const before = this.bufferedAmount;
    try {
      this.channel.send(frame);
    } catch {
      throw new ChannelClosedError();
    }
    this.optimistic = before + frame.byteLength;
    this.bytesQueued += frame.byteLength;
  }

  close(): void {
    if (this.channel.readyState === "open") {
      this.sendCtl({ t: "bye" });
    }
    this.detach();
    try {
      this.channel.close();
    } catch {
      // already closed
    }
  }

  /** Stops using the channel. Senders and receivers on it see "close" and stop cleanly. */
  detach(): void {
    if (!this.closed) {
      this.closed = true;
      this.events.emit("close", undefined);
    }
    this.channel.removeEventListener("message", this.onMessage);
    this.channel.removeEventListener("bufferedamountlow", this.wake);
    this.channel.removeEventListener("open", this.onOpen);
    this.channel.removeEventListener("close", this.onClose);
    this.channel.removeEventListener("error", this.onError);
    this.wake();
    this.stopPoll();
  }

  private ensurePoll(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => {
      if (this.closed || this.bufferedAmount <= this.highWater) this.wake();
    }, DRAIN_POLL_MS);
  }

  private stopPoll(): void {
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private readonly wake = (): void => {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
    if (this.waiters.length === 0) this.stopPoll();
  };

  private readonly onMessage: ChannelListener = (event): void => {
    const data = event.data;
    if (typeof data === "string") {
      const ctl = parseCtl(data);
      if (ctl) this.events.emit("ctl", ctl);
      else logger.warn("datachannel", "dropped malformed control message");
      return;
    }
    if (data instanceof ArrayBuffer) {
      const frame = decodeFrame(data);
      if (frame) this.events.emit("frame", frame);
      else logger.warn("datachannel", "dropped malformed frame");
    }
  };

  private readonly onOpen = (): void => {
    this.events.emit("open", undefined);
  };

  private readonly onClose = (): void => {
    if (this.closed) return;
    this.closed = true;
    this.wake();
    this.stopPoll();
    this.events.emit("close", undefined);
  };

  private readonly onError: ChannelListener = (event): void => {
    logger.warn("datachannel", "channel error", event.error?.message ?? event.type ?? "error");
  };
}

function clampHighWater(bytes: number): number {
  return Math.min(MAX_HIGH_WATER, Math.max(MIN_HIGH_WATER, Math.floor(bytes)));
}
