// Large synthetic transfers through the real sender/receiver/protocol, measuring how much
// binary memory is alive at once (with forced GC, so garbage doesn't count). Payloads are
// generated on demand (no fixture files) and discarded on receipt.
import type { ChunkSink } from "@/lib/storage/sinks/sink";
import { SyntheticSource, totalChunks } from "@/lib/webrtc/chunk-manager";
import { DataChannelTransport } from "@/lib/webrtc/data-channel";
import { FileReceiver } from "@/lib/webrtc/file-receiver";
import { FileSender } from "@/lib/webrtc/file-sender";
import { createChannelPair } from "../mocks/rtc";

class CountingSink implements ChunkSink {
  readonly kind = "memory" as const;
  bytes = 0;
  async write(_index: number, _offset: number, data: Uint8Array): Promise<void> {
    this.bytes += data.byteLength;
  }
  async finalize(): Promise<null> {
    return null;
  }
  async close(): Promise<void> {}
  async discard(): Promise<void> {}
}

const MiB = 1024 * 1024;
const gc = (globalThis as { gc?: () => void }).gc;

/** Sends `size` bytes and returns the peak live ArrayBuffer memory. */
async function transfer(size: number): Promise<number> {
  const chunkSize = 4 * MiB;
  const source = new SyntheticSource(size, 11);
  const [a, b] = createChannelPair({ bytesPerTick: 8 * MiB, tickMs: 1 });
  const tx = new DataChannelTransport(a, 4 * MiB);
  const rx = new DataChannelTransport(b);
  const sink = new CountingSink();
  const total = totalChunks(size, chunkSize);
  const sender = new FileSender({ transport: tx, slot: 1, transferId: "tr_big", source, chunkSize, totalChunks: total, frameSize: 64 * 1024, window: 6 });
  const receiver = new FileReceiver({
    transport: rx,
    slot: 1,
    transferId: "tr_big",
    size,
    chunkSize,
    totalChunks: total,
    window: 6,
    sink,
    digests: new Map(),
    persistDigest: async () => {},
  });
  tx.events.on("ctl", (ctl) => sender.handleCtl(ctl));
  rx.events.on("ctl", (ctl) => (ctl.t === "file_open" ? void receiver.start() : receiver.handleCtl(ctl)));
  rx.events.on("frame", (frame) => receiver.handleFrame(frame));

  gc?.();
  const baseline = process.memoryUsage().arrayBuffers;
  let peak = 0;
  const sampler = setInterval(() => {
    gc?.();
    peak = Math.max(peak, process.memoryUsage().arrayBuffers - baseline);
  }, 50);
  const result = await sender.run();
  clearInterval(sampler);
  expect(result).toEqual({ kind: "done" });
  expect(sink.bytes).toBe(size);
  return peak;
}

describe("large transfer", () => {
  // Needs forced GC to measure live memory: run with `npm run test:memory` (node --expose-gc).
  const maybe = typeof gc === "function" ? it : it.skip;
  maybe("keeps live memory bounded and independent of file size", async () => {
    const small = await transfer(64 * MiB);
    const large = await transfer(512 * MiB + 12_345);
    console.log(
      `[large-transfer] peak live ArrayBuffers: ${(small / MiB).toFixed(0)} MiB for 64 MiB, ${(large / MiB).toFixed(0)} MiB for 512 MiB`,
    );
    // Window (6 × 4 MiB) + read prefetch + send buffer + in-flight copies.
    expect(large).toBeLessThan(96 * MiB);
    // 8× the data must not mean 8× the memory.
    expect(large).toBeLessThan(small * 2 + 16 * MiB);
  }, 240_000);
});
