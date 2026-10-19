// Receives one file from one sender over a DataChannel.
//
// Frames are assembled into chunk buffers (at most `window + 1` at once). On `chunk_end`
// the chunk's SHA-256 is checked before anything is written; only verified, stored chunks
// are acknowledged and counted as progress. On `file_end` the root digest over all chunk
// digests is compared before the transfer may be reported complete.
import { rootDigest, sha256Hex } from "@/lib/utils/hash";
import { logger } from "@/lib/utils/logger";
import { countInRanges, normalizeRanges, rangesFromIndexes } from "@/lib/utils/ranges";
import type { ChunkSink } from "@/lib/storage/sinks/sink";
import type { ChunkRange } from "@/types/transfer";
import type { DataChannelTransport } from "./data-channel";
import { chunkLength, type CloseReason, type Ctl, type Frame } from "./protocol";

export type ReceiverResult =
  | { kind: "done" }
  | { kind: "paused" }
  | { kind: "cancelled" }
  | { kind: "interrupted" }
  | { kind: "failed"; reason: "integrity" | "protocol" | "storage" };

export interface ReceiverOptions {
  transport: DataChannelTransport;
  slot: number;
  transferId: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  /** Chunks the sender may have in flight; told to the sender in `file_ready`. */
  window: number;
  sink: ChunkSink;
  /** Digests of chunks already verified and stored (resume). */
  digests: ReadonlyMap<number, string>;
  /** Persists a digest after its chunk is stored. Must resolve before the ack is sent. */
  persistDigest: (index: number, sha256: string) => Promise<void>;
  onProgress?: (verifiedBytes: number, ranges: ChunkRange[]) => void;
  /** Called when the file is complete and its root digest matched. */
  onVerified?: () => void;
  /** Synthetic speed-test data (discarded). */
  isSpeedTest?: boolean;
}

interface Assembly {
  buffer: Uint8Array<ArrayBuffer>;
  received: number;
}

const MAX_CHUNK_FAILURES = 3;

export class FileReceiver {
  private readonly digests: Map<number, string>;
  private readonly assembling = new Map<number, Assembly>();
  private readonly failures = new Map<number, number>();
  private queue: Promise<void> = Promise.resolve();
  private result: ReceiverResult | null = null;
  private resolveDone: ((result: ReceiverResult) => void) | null = null;
  private readonly done: Promise<ReceiverResult>;
  private readonly unsubscribe: Array<() => void> = [];

  constructor(private readonly options: ReceiverOptions) {
    this.digests = new Map(options.digests);
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }

  get isSpeedTest(): boolean {
    return this.options.isSpeedTest === true;
  }

  get ranges(): ChunkRange[] {
    return rangesFromIndexes(this.digests.keys());
  }

  get verifiedBytes(): number {
    const { size, chunkSize, totalChunks } = this.options;
    let bytes = this.digests.size * chunkSize;
    if (this.digests.has(totalChunks - 1)) bytes -= totalChunks * chunkSize - size;
    return Math.max(0, Math.min(size, bytes));
  }

  /** Tells the sender which chunks we already hold. Resolves when this slot finishes. */
  start(): Promise<ReceiverResult> {
    const { transport, slot } = this.options;
    this.unsubscribe.push(transport.events.on("close", () => this.finish({ kind: "interrupted" })));
    const have = normalizeRanges(this.ranges);
    if (!transport.sendCtl({ t: "file_ready", slot, have, window: this.options.window })) {
      this.finish({ kind: "interrupted" });
    }
    this.report();
    return this.done;
  }

  stop(reason: Extract<CloseReason, "paused" | "cancelled">): void {
    if (this.result) return;
    this.options.transport.sendCtl({ t: "file_close", slot: this.options.slot, role: "receiver", reason });
    this.finish({ kind: reason });
  }

  handleFrame(frame: Frame): void {
    if (this.result) return;
    const { size, chunkSize, totalChunks, window } = this.options;
    const { chunkIndex: index, offset, payload } = frame;
    if (index >= totalChunks) return this.protocolError(`chunk ${index} out of range`);
    if (this.digests.has(index)) return; // Already stored (duplicate after a resume race).
    const length = chunkLength(index, size, chunkSize);
    let assembly = this.assembling.get(index);
    if (!assembly) {
      // The sender may only have `window` chunks in flight; anything more is misbehaving.
      if (this.assembling.size > window) return this.protocolError("too many chunks in flight");
      assembly = { buffer: new Uint8Array(length), received: 0 };
      this.assembling.set(index, assembly);
    }
    if (offset + payload.byteLength > length || assembly.received + payload.byteLength > length) {
      return this.protocolError(`frame overflows chunk ${index}`);
    }
    assembly.buffer.set(payload, offset);
    assembly.received += payload.byteLength;
  }

  handleCtl(ctl: Ctl): void {
    if (this.result) return;
    switch (ctl.t) {
      case "chunk_end":
        this.enqueue(() => this.completeChunk(ctl.index, ctl.sha256));
        break;
      case "file_end":
        this.enqueue(() => this.completeFile(ctl.root));
        break;
      case "file_close":
        if (ctl.role === "sender") {
          this.finish(
            ctl.reason === "paused"
              ? { kind: "paused" }
              : ctl.reason === "cancelled"
                ? { kind: "cancelled" }
                : { kind: "interrupted" },
          );
        }
        break;
      default:
        break;
    }
  }

  private enqueue(task: () => Promise<void>): void {
    // Chunks are verified and written strictly in arrival order.
    this.queue = this.queue.then(task).catch((error: unknown) => {
      logger.error("receiver", "unexpected error", String(error));
      this.finish({ kind: "failed", reason: "storage" });
    });
  }

  private async completeChunk(index: number, expected: string): Promise<void> {
    if (this.result) return;
    const { transport, slot, size, chunkSize, sink } = this.options;
    if (this.digests.has(index)) {
      transport.sendCtl({ t: "chunk_ack", slot, index });
      return;
    }
    const assembly = this.assembling.get(index);
    this.assembling.delete(index);
    const length = chunkLength(index, size, chunkSize);
    const actual = assembly && assembly.received === length ? await sha256Hex(assembly.buffer) : null;
    if (!assembly || actual !== expected) {
      const count = (this.failures.get(index) ?? 0) + 1;
      this.failures.set(index, count);
      logger.warn("receiver", `chunk ${index} failed verification (${count})`);
      if (count > MAX_CHUNK_FAILURES) {
        this.finish({ kind: "failed", reason: "integrity" });
        return;
      }
      transport.sendCtl({ t: "chunk_nack", slot, index });
      return;
    }
    try {
      await sink.write(index, index * chunkSize, assembly.buffer);
      await this.options.persistDigest(index, expected);
    } catch (error) {
      logger.error("receiver", `storing chunk ${index} failed`, String(error));
      this.finish({ kind: "failed", reason: "storage" });
      return;
    }
    this.digests.set(index, expected);
    transport.sendCtl({ t: "chunk_ack", slot, index });
    this.report();
  }

  private async completeFile(root: string): Promise<void> {
    if (this.result) return;
    const { transport, slot, totalChunks } = this.options;
    const ordered: string[] = [];
    for (let i = 0; i < totalChunks; i += 1) {
      const digest = this.digests.get(i);
      if (!digest) {
        transport.sendCtl({ t: "file_done", slot, ok: false });
        this.finish({ kind: "failed", reason: "integrity" });
        return;
      }
      ordered.push(digest);
    }
    const ok = (await rootDigest(ordered)) === root;
    transport.sendCtl({ t: "file_done", slot, ok });
    if (!ok) {
      this.finish({ kind: "failed", reason: "integrity" });
      return;
    }
    this.options.onVerified?.();
    this.finish({ kind: "done" });
  }

  private report(): void {
    const ranges = this.ranges;
    this.options.onProgress?.(this.verifiedBytes, ranges);
  }

  private protocolError(message: string): void {
    logger.warn("receiver", message);
    this.options.transport.sendCtl({ t: "file_close", slot: this.options.slot, role: "receiver", reason: "error" });
    this.finish({ kind: "failed", reason: "protocol" });
  }

  private finish(result: ReceiverResult): void {
    if (this.result) return;
    this.result = result;
    this.assembling.clear();
    for (const off of this.unsubscribe.splice(0)) off();
    this.resolveDone?.(result);
  }

  /** Number of chunks verified so far. */
  get verifiedChunks(): number {
    return countInRanges(this.ranges);
  }
}
