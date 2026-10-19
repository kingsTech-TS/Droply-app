// Tunes the send buffer from measurements only: throughput (bytes drained from the
// channel's buffer) and RTT (from getStats). It never grows without evidence that the
// sender was starving the link, and it is hard-capped to protect browser memory.
import { MAX_HIGH_WATER, MIN_HIGH_WATER } from "./data-channel";

export interface TransferTuning {
  /** Starting send-buffer ceiling in bytes. */
  initialHighWater: number;
  /** Bytes per binary frame, header included. */
  frameSize: number;
  /** Unacknowledged chunks allowed per leg (receive-side backpressure). */
  window: number;
  /** Ceiling for the send buffer (lower on phones, which close tabs that use too much). */
  maxHighWater?: number;
}

export interface Sample {
  /** Total bytes handed to the channel so far. */
  bytesQueued: number;
  bufferedAmount: number;
  /** Whether a sender was waiting for buffer space since the last sample. */
  senderBlocked: boolean;
  now: number;
}

const GROWTH_PER_SECOND = 1.5;
const SAFE_FRAME = 16 * 1024;
const DEFAULT_FRAME = 64 * 1024;
const MAX_FRAME = 256 * 1024;

export function defaultTuning(maxMessageSize: number | null, mobile: boolean, maxHighWater = MAX_HIGH_WATER): TransferTuning {
  // Unknown max message size (older Safari): stay with the interop-safe 16 KiB.
  const frameSize =
    maxMessageSize && maxMessageSize > 0
      ? Math.min(DEFAULT_FRAME, maxMessageSize, MAX_FRAME)
      : SAFE_FRAME;
  return {
    initialHighWater: Math.min(1024 * 1024, maxHighWater),
    frameSize: Math.max(1024, frameSize),
    window: mobile ? 3 : 6,
    maxHighWater: Math.max(MIN_HIGH_WATER, Math.min(MAX_HIGH_WATER, maxHighWater)),
  };
}

/** Picks a chunk size for a new transfer from the last throughput measured to that peer. */
export function chooseChunkSize(
  throughputBytesPerSecond: number | null,
  bounds: { recommended: number; min: number; max: number },
): number {
  const MiB = 1024 * 1024;
  let size = bounds.recommended;
  if (throughputBytesPerSecond !== null) {
    if (throughputBytesPerSecond < 5_000_000) size = MiB;
    else if (throughputBytesPerSecond < 50_000_000) size = 4 * MiB;
    else size = 8 * MiB;
  }
  return Math.min(bounds.max, Math.max(bounds.min, size));
}

export class AdaptiveController {
  private highWater: number;
  private lastSample: Sample | null = null;
  private throughputEwma: number | null = null;
  private previousThroughput: number | null = null;
  private stalledSinceMs: number | null = null;
  private rttMs: number | null = null;

  constructor(readonly tuning: TransferTuning) {
    this.highWater = tuning.initialHighWater;
  }

  get currentHighWater(): number {
    return this.highWater;
  }

  /** Bytes per second drained from the send buffer (smoothed). */
  get throughput(): number | null {
    return this.throughputEwma;
  }

  setRtt(rttMs: number | null): void {
    if (rttMs !== null && Number.isFinite(rttMs) && rttMs >= 0) this.rttMs = rttMs;
  }

  /** Feed one sample (about every 250-1000 ms). Returns the new high-water mark. */
  sample(next: Sample): number {
    const prev = this.lastSample;
    this.lastSample = next;
    if (!prev) return this.highWater;
    const dtSeconds = (next.now - prev.now) / 1000;
    if (dtSeconds <= 0.05) return this.highWater;

    // Bytes that actually left the buffer during the interval.
    const drained = next.bytesQueued - prev.bytesQueued - (next.bufferedAmount - prev.bufferedAmount);
    const rate = Math.max(0, drained / dtSeconds);
    this.throughputEwma = this.throughputEwma === null ? rate : this.throughputEwma * 0.7 + rate * 0.3;

    // Stall: data waiting but nothing draining for a while. Back off.
    if (next.bufferedAmount > 0 && drained <= 0) {
      this.stalledSinceMs ??= next.now;
      if (next.now - this.stalledSinceMs >= 3000) {
        this.highWater = Math.max(MIN_HIGH_WATER, Math.floor(this.highWater / 2));
        this.stalledSinceMs = next.now;
      }
      return this.highWater;
    }
    this.stalledSinceMs = null;

    // Grow only when the sender was blocked on the buffer (so the buffer was the limit)
    // and throughput is still rising. Target ~2× the bandwidth-delay product.
    const improving =
      this.previousThroughput === null || this.throughputEwma > this.previousThroughput * 1.05;
    if (next.senderBlocked && improving && this.rttMs !== null) {
      const bdp = this.throughputEwma * (this.rttMs / 1000);
      const target = Math.max(MIN_HIGH_WATER, 2 * bdp);
      const limit = this.highWater * GROWTH_PER_SECOND ** Math.min(1, dtSeconds);
      if (target > this.highWater) {
        this.highWater = Math.min(this.tuning.maxHighWater ?? MAX_HIGH_WATER, target, limit);
      }
    }
    this.previousThroughput = this.throughputEwma;
    return this.highWater;
  }
}
