// Sends one file to one recipient over a DataChannel.
//
//   file_open ─► file_ready{have} ─► for each missing chunk:
//       read one chunk (File.slice) ─► SHA-256 ─► frames (backpressure) ─► chunk_end
//       ◄─ chunk_ack (returns one credit) / chunk_nack (resend)
//   all acknowledged ─► file_end{root} ─► ◄─ file_done{ok}
//
// Progress is reported from acknowledged chunks only (verified and stored by the receiver),
// never from bytes merely handed to the channel.
import { rootDigest, sha256Hex } from "@/lib/utils/hash";
import { logger } from "@/lib/utils/logger";
import { countInRanges, missingRanges, normalizeRanges } from "@/lib/utils/ranges";
import type { ChunkRange } from "@/types/transfer";
import { chunkBounds, readLimiter, type ByteSource, type Limiter } from "./chunk-manager";
import { ChannelClosedError, type DataChannelTransport } from "./data-channel";
import { encodeFrame, FRAME_HEADER_BYTES, type CloseReason, type Ctl } from "./protocol";

export type SenderResult =
  | { kind: "done" }
  | { kind: "paused" }
  | { kind: "cancelled" }
  | { kind: "interrupted" }
  | { kind: "failed"; reason: "integrity" | "rejected" | "timeout" | "read_error" };

export interface SenderOptions {
  transport: DataChannelTransport;
  slot: number;
  transferId: string;
  source: ByteSource;
  chunkSize: number;
  totalChunks: number;
  frameSize: number;
  window: number;
  /** Folder path inside a sent folder, told to the receiver. */
  path?: string | null;
  /** Synthetic speed-test data: the receiver discards it. */
  test?: boolean;
  /** Digests saved earlier (resume after reload), by chunk index. */
  knownDigests?: ReadonlyMap<number, string>;
  limiter?: Limiter;
  onDigest?: (index: number, sha256: string) => void;
  /** Called with verified bytes/chunks after every acknowledgement. */
  onProgress?: (ackedBytes: number, ackedChunks: number) => void;
  /** Called once when the first frame of this run is sent. */
  onStart?: () => void;
  readyTimeoutMs?: number;
}

const MAX_NACKS_PER_CHUNK = 3;

export class FileSender {
  private readonly digests = new Map<number, string>();
  private readonly inflight = new Set<number>();
  private readonly retryQueue: number[] = [];
  private readonly nacks = new Map<number, number>();
  private acked: ChunkRange[] = [];
  private ackedBytes = 0;
  private result: SenderResult | null = null;
  private wakeup: (() => void) | null = null;
  private readyHave: ChunkRange[] | null = null;
  private window: number;
  private doneOk: boolean | null = null;
  private started = false;
  private readonly unsubscribe: Array<() => void> = [];

  constructor(private readonly options: SenderOptions) {
    for (const [index, digest] of options.knownDigests ?? []) this.digests.set(index, digest);
    this.window = options.window;
  }

  get verifiedBytes(): number {
    return this.ackedBytes;
  }

  /** Runs the transfer until it finishes, pauses, is cancelled or the channel drops. */
  async run(): Promise<SenderResult> {
    const { transport, slot, transferId, source, chunkSize, totalChunks } = this.options;
    this.unsubscribe.push(
      transport.events.on("close", () => this.finish({ kind: "interrupted" })),
    );
    try {
      const open: Extract<Ctl, { t: "file_open" }> = { t: "file_open", slot, transferId, size: source.size, chunkSize, totalChunks };
      if (this.options.path) open.path = this.options.path;
      if (this.options.test) open.test = true;
      if (!transport.sendCtl(open)) {
        return this.finish({ kind: "interrupted" });
      }
      const have = await this.waitFor(() => this.readyHave, this.options.readyTimeoutMs ?? 20_000);
      if (this.result) return this.result;
      if (!have) return this.finish({ kind: "failed", reason: "timeout" });
      this.setAcked(have);

      const pending = this.pendingIndexes(have);
      // The next chunk is read while the current one is being sent.
      let prefetch = this.startRead(pending);

      while (!this.result) {
        while (this.inflight.size >= this.window && !this.result) await this.waitForSignal();
        if (this.result) break;

        let job: ReadJob | null;
        const retry = this.retryQueue.shift();
        if (retry !== undefined) {
          job = { index: retry, read: this.readChunk(retry) };
        } else {
          job = prefetch;
          prefetch = job ? this.startRead(pending) : null;
        }
        if (!job) {
          if (this.inflight.size === 0 && this.retryQueue.length === 0) break;
          await this.waitForSignal();
          continue;
        }
        const chunk = await job.read;
        if (this.result) break;
        if (!chunk) return this.finish({ kind: "failed", reason: "read_error" });
        await this.sendChunk(chunk.index, chunk.data, chunk.digest);
      }
      if (this.result) return this.result;

      const root = await this.computeRoot();
      if (!root) return this.finish({ kind: "failed", reason: "read_error" });
      transport.sendCtl({ t: "file_end", slot, root });
      const ok = await this.waitFor(() => this.doneOk, 60_000);
      if (this.result) return this.result;
      if (ok === null) return this.finish({ kind: "failed", reason: "timeout" });
      return this.finish(ok ? { kind: "done" } : { kind: "failed", reason: "integrity" });
    } catch (error) {
      if (error instanceof ChannelClosedError) return this.finish({ kind: "interrupted" });
      logger.error("sender", "unexpected error", String(error));
      return this.finish({ kind: "failed", reason: "read_error" });
    }
  }

  /** Stops sending new chunks and tells the receiver why. */
  stop(reason: Extract<CloseReason, "paused" | "cancelled">): void {
    if (this.result) return;
    this.options.transport.sendCtl({ t: "file_close", slot: this.options.slot, role: "sender", reason });
    this.finish({ kind: reason });
  }

  /** Control messages for this slot, routed here by the peer session. */
  handleCtl(ctl: Ctl): void {
    switch (ctl.t) {
      case "file_ready":
        this.readyHave = normalizeRanges(ctl.have);
        this.window = Math.max(1, Math.min(this.options.window, ctl.window));
        break;
      case "chunk_ack":
        if (this.inflight.delete(ctl.index)) {
          this.setAcked([...this.acked, [ctl.index, ctl.index]]);
        }
        break;
      case "chunk_nack": {
        if (!this.inflight.delete(ctl.index)) break;
        const count = (this.nacks.get(ctl.index) ?? 0) + 1;
        this.nacks.set(ctl.index, count);
        // A different digest each time means the source itself is changing under us.
        this.digests.delete(ctl.index);
        if (count > MAX_NACKS_PER_CHUNK) this.finish({ kind: "failed", reason: "integrity" });
        else this.retryQueue.push(ctl.index);
        break;
      }
      case "file_done":
        this.doneOk = ctl.ok;
        break;
      case "file_close":
        if (ctl.role === "receiver") {
          this.finish(
            ctl.reason === "paused"
              ? { kind: "paused" }
              : ctl.reason === "cancelled"
                ? { kind: "cancelled" }
                : { kind: "failed", reason: "rejected" },
          );
        }
        break;
      default:
        break;
    }
    this.signal();
  }

  private setAcked(ranges: ChunkRange[]): void {
    const { source, chunkSize, totalChunks } = this.options;
    this.acked = normalizeRanges(ranges.map(([a, b]): ChunkRange => [a, Math.min(b, totalChunks - 1)]));
    let bytes = countInRanges(this.acked) * chunkSize;
    // The last chunk is usually shorter than chunkSize.
    const last = this.acked[this.acked.length - 1];
    if (last && last[1] === totalChunks - 1) bytes -= totalChunks * chunkSize - source.size;
    this.ackedBytes = Math.max(0, Math.min(bytes, source.size));
    this.options.onProgress?.(this.ackedBytes, countInRanges(this.acked));
  }

  private *pendingIndexes(have: ChunkRange[]): Generator<number> {
    for (const [a, b] of missingRanges(have, this.options.totalChunks)) {
      for (let i = a; i <= b; i += 1) yield i;
    }
  }

  private startRead(pending: Generator<number>): ReadJob | null {
    const next = pending.next();
    if (next.done) return null;
    return { index: next.value, read: this.readChunk(next.value) };
  }

  private async readChunk(index: number): Promise<ChunkData | null> {
    const { source, chunkSize, limiter = readLimiter } = this.options;
    const [start, end] = chunkBounds(index, source.size, chunkSize);
    try {
      return await limiter.run(async () => {
        const data = await source.read(start, end);
        const digest = await sha256Hex(data);
        return { index, data, digest };
      });
    } catch (error) {
      logger.warn("sender", `reading chunk ${index} failed`, String(error));
      return null;
    }
  }

  private async sendChunk(index: number, data: ArrayBuffer, digest: string): Promise<void> {
    const { transport, slot, frameSize } = this.options;
    const payloadSize = Math.max(1, frameSize - FRAME_HEADER_BYTES);
    const bytes = new Uint8Array(data);
    this.digests.set(index, digest);
    this.options.onDigest?.(index, digest);
    this.inflight.add(index);
    for (let offset = 0; offset < bytes.byteLength; offset += payloadSize) {
      if (this.result) return;
      const payload = bytes.subarray(offset, Math.min(offset + payloadSize, bytes.byteLength));
      await transport.sendFrame(encodeFrame(slot, index, offset, payload));
      if (!this.started) {
        this.started = true;
        this.options.onStart?.();
      }
    }
    if (this.result) return;
    transport.sendCtl({ t: "chunk_end", slot, index, sha256: digest });
  }

  /** Root digest over every chunk. Chunks skipped on resume without a saved digest are re-hashed. */
  private async computeRoot(): Promise<string | null> {
    const list: string[] = [];
    for (let i = 0; i < this.options.totalChunks; i += 1) {
      let digest = this.digests.get(i);
      if (!digest) {
        const chunk = await this.readChunk(i);
        if (!chunk) return null;
        digest = chunk.digest;
        this.digests.set(i, digest);
        this.options.onDigest?.(i, digest);
      }
      list.push(digest);
    }
    return rootDigest(list);
  }

  private finish(result: SenderResult): SenderResult {
    if (!this.result) {
      this.result = result;
      for (const off of this.unsubscribe.splice(0)) off();
      this.signal();
    }
    return this.result;
  }

  private signal(): void {
    const wake = this.wakeup;
    this.wakeup = null;
    wake?.();
  }

  private waitForSignal(): Promise<void> {
    return new Promise((resolve) => {
      this.wakeup = resolve;
    });
  }

  private async waitFor<T>(get: () => T | null, timeoutMs: number): Promise<T | null> {
    const deadline = Date.now() + timeoutMs;
    while (!this.result) {
      const value = get();
      if (value !== null) return value;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      await Promise.race([this.waitForSignal(), sleep(Math.min(remaining, 1000))]);
    }
    return null;
  }
}

interface ChunkData {
  index: number;
  data: ArrayBuffer;
  digest: string;
}

interface ReadJob {
  index: number;
  /** Never rejects: read errors resolve to null. */
  read: Promise<ChunkData | null>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
