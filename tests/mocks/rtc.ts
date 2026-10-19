// A connected pair of fake RTCDataChannels with a simulated send buffer: `send` adds to
// `bufferedAmount`, a timer drains it at `bytesPerTick`, and messages are delivered to the
// other side in order once drained. `bufferedamountlow` fires on crossing the threshold.
import type { DataChannelLike } from "@/lib/webrtc/data-channel";

export interface FakeChannelOptions {
  /** Bytes drained per tick (default effectively unlimited). */
  bytesPerTick?: number;
  tickMs?: number;
  /** Corrupts the n-th binary message (1-based) by flipping its last byte. */
  corruptBinaryMessage?: number;
}

type Item = { data: string | ArrayBuffer; size: number };

export class FakeDataChannel extends EventTarget implements DataChannelLike {
  readyState: RTCDataChannelState = "connecting";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  binaryType: BinaryType = "arraybuffer";
  peer: FakeDataChannel | null = null;
  /** Highest bufferedAmount ever observed right after a send. */
  maxBufferedAmount = 0;
  sentBinary = 0;
  private queue: Item[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: FakeChannelOptions = {}) {
    super();
  }

  open(): void {
    this.readyState = "open";
    this.dispatchEvent(new Event("open"));
  }

  send(data: string | ArrayBuffer): void {
    if (this.readyState !== "open") throw new DOMException("not open", "InvalidStateError");
    let payload = data;
    if (typeof data !== "string") {
      this.sentBinary += 1;
      if (this.options.corruptBinaryMessage === this.sentBinary) {
        const copy = data.slice(0);
        const bytes = new Uint8Array(copy);
        bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
        payload = copy;
      } else {
        payload = data.slice(0); // Like a real channel, the receiver gets its own copy.
      }
    }
    const size = typeof data === "string" ? data.length : data.byteLength;
    this.queue.push({ data: payload, size });
    this.bufferedAmount += size;
    this.maxBufferedAmount = Math.max(this.maxBufferedAmount, this.bufferedAmount);
    this.ensureTimer();
  }

  close(): void {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.stopTimer();
    this.queue = [];
    this.bufferedAmount = 0;
    this.dispatchEvent(new Event("close"));
    const peer = this.peer;
    this.peer = null;
    if (peer && peer.readyState !== "closed") peer.close();
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.drain(), this.options.tickMs ?? 1);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private drain(): void {
    let budget = this.options.bytesPerTick ?? Number.POSITIVE_INFINITY;
    // Each tick delivers messages until the byte budget is spent (always at least one).
    while (this.queue.length > 0 && budget > 0) {
      const item = this.queue.shift()!;
      budget -= item.size;
      const before = this.bufferedAmount;
      this.bufferedAmount -= item.size;
      this.peer?.dispatchEvent(new MessageEvent("message", { data: item.data }));
      if (before > this.bufferedAmountLowThreshold && this.bufferedAmount <= this.bufferedAmountLowThreshold) {
        this.dispatchEvent(new Event("bufferedamountlow"));
      }
    }
    if (this.queue.length === 0) this.stopTimer();
  }
}

export function createChannelPair(
  a: FakeChannelOptions = {},
  b: FakeChannelOptions = {},
): [FakeDataChannel, FakeDataChannel] {
  const left = new FakeDataChannel(a);
  const right = new FakeDataChannel(b);
  left.peer = right;
  right.peer = left;
  left.open();
  right.open();
  return [left, right];
}
