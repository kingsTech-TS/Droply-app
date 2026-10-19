import type { LocalFile } from "@/lib/files/local-file";
import { MemorySink } from "../mocks/memory-sink";
import { readMem } from "../mocks/native";
import type { ChunkSink } from "@/lib/storage/sinks/sink";
import { sha256Hex } from "@/lib/utils/hash";
import { SyntheticSource, totalChunks, type ByteSource } from "@/lib/webrtc/chunk-manager";
import { DataChannelTransport } from "@/lib/webrtc/data-channel";
import { FileReceiver } from "@/lib/webrtc/file-receiver";
import { FileSender } from "@/lib/webrtc/file-sender";
import type { Ctl } from "@/lib/webrtc/protocol";
import type { ChunkRange } from "@/types/transfer";
import { createChannelPair, type FakeChannelOptions } from "../mocks/rtc";

const KiB = 1024;

interface Harness {
  sender: FileSender;
  receiver: FileReceiver;
  sink: ChunkSink;
  progress: number[];
  senderChannel: ReturnType<typeof createChannelPair>[0];
}

function connect(
  source: ByteSource,
  opts: {
    chunkSize: number;
    window?: number;
    frameSize?: number;
    highWater?: number;
    channel?: FakeChannelOptions;
    receiverDigests?: Map<number, string>;
    sink?: ChunkSink;
  },
): Harness {
  const [a, b] = createChannelPair(opts.channel ?? {});
  const tx = new DataChannelTransport(a, opts.highWater ?? 256 * KiB);
  const rx = new DataChannelTransport(b, 256 * KiB);
  const total = totalChunks(source.size, opts.chunkSize);
  const sink = opts.sink ?? new MemorySink(total);
  const progress: number[] = [];
  const sender = new FileSender({
    transport: tx,
    slot: 1,
    transferId: "tr_test",
    source,
    chunkSize: opts.chunkSize,
    totalChunks: total,
    frameSize: opts.frameSize ?? 16 * KiB,
    window: opts.window ?? 4,
    onProgress: (bytes) => progress.push(bytes),
  });
  const receiver = new FileReceiver({
    transport: rx,
    slot: 1,
    transferId: "tr_test",
    size: source.size,
    chunkSize: opts.chunkSize,
    totalChunks: total,
    window: opts.window ?? 4,
    sink,
    digests: opts.receiverDigests ?? new Map(),
    persistDigest: async () => {},
  });
  // Route control messages by direction, as the peer session does.
  tx.events.on("ctl", (ctl: Ctl) => sender.handleCtl(ctl));
  rx.events.on("ctl", (ctl: Ctl) => {
    if (ctl.t === "file_open") void receiver.start();
    else receiver.handleCtl(ctl);
  });
  rx.events.on("frame", (frame) => receiver.handleFrame(frame));
  return { sender, receiver, sink, progress, senderChannel: a };
}

async function digestOf(file: LocalFile | null): Promise<string> {
  return sha256Hex(readMem(file!.uri));
}

describe("file transfer pipeline", () => {
  it("transfers a multi-chunk file and reconstructs it exactly", async () => {
    const source = new SyntheticSource(1_000_003, 7);
    const h = connect(source, { chunkSize: 64 * KiB });
    const result = await h.sender.run();
    expect(result).toEqual({ kind: "done" });
    const file = await h.sink.finalize();
    expect(file!.size).toBe(source.size);
    expect(await digestOf(file!)).toBe(await sha256Hex(await source.read(0, source.size)));
    // Progress only moves forward and ends at the full size.
    expect(h.progress.at(-1)).toBe(source.size);
    expect([...h.progress].sort((x, y) => x - y)).toEqual(h.progress);
  });

  it("never lets bufferedAmount exceed the high-water mark by more than one frame", async () => {
    const source = new SyntheticSource(2 * 1024 * KiB);
    const highWater = 256 * KiB;
    const frameSize = 16 * KiB;
    const h = connect(source, {
      chunkSize: 256 * KiB,
      frameSize,
      highWater,
      channel: { bytesPerTick: 64 * KiB, tickMs: 1 },
    });
    expect(await h.sender.run()).toEqual({ kind: "done" });
    expect(h.senderChannel.maxBufferedAmount).toBeLessThanOrEqual(highWater + frameSize + 1024);
  });

  it("re-sends a corrupted chunk and still verifies the file", async () => {
    const source = new SyntheticSource(300 * KiB, 3);
    const h = connect(source, {
      chunkSize: 64 * KiB,
      channel: { corruptBinaryMessage: 2 },
    });
    expect(await h.sender.run()).toEqual({ kind: "done" });
    const file = await h.sink.finalize();
    expect(await digestOf(file!)).toBe(await sha256Hex(await source.read(0, source.size)));
  });

  it("resumes by sending only the chunks the receiver is missing", async () => {
    const chunkSize = 64 * KiB;
    const source = new SyntheticSource(10 * chunkSize, 9);
    const total = 10;
    // The receiver already holds chunks 0-5 from an earlier, interrupted run.
    const sink = new MemorySink(total);
    const digests = new Map<number, string>();
    for (let i = 0; i < 6; i += 1) {
      const data = await source.read(i * chunkSize, (i + 1) * chunkSize);
      await sink.write(i, i * chunkSize, new Uint8Array(data));
      digests.set(i, await sha256Hex(data));
    }
    const h = connect(source, { chunkSize, frameSize: 16 * KiB, receiverDigests: digests, sink });
    expect(await h.sender.run()).toEqual({ kind: "done" });
    // Only the 4 missing chunks are sent. Each frame also carries a 16-byte header.
    const framesPerChunk = Math.ceil(chunkSize / (16 * KiB - 16));
    expect(h.senderChannel.sentBinary).toBe(4 * framesPerChunk);
    expect(h.progress[0]).toBe(6 * chunkSize);
    const file = await sink.finalize();
    expect(await digestOf(file)).toBe(await sha256Hex(await source.read(0, source.size)));
  });

  it("reports interrupted when the channel closes mid-transfer", async () => {
    const source = new SyntheticSource(4 * 1024 * KiB);
    const h = connect(source, {
      chunkSize: 256 * KiB,
      channel: { bytesPerTick: 32 * KiB, tickMs: 1 },
    });
    const run = h.sender.run();
    setTimeout(() => h.senderChannel.close(), 20);
    expect(await run).toEqual({ kind: "interrupted" });
  });

  it("stops when paused and keeps verified progress", async () => {
    const source = new SyntheticSource(4 * 1024 * KiB);
    const h = connect(source, {
      chunkSize: 128 * KiB,
      channel: { bytesPerTick: 64 * KiB, tickMs: 1 },
    });
    const run = h.sender.run();
    await new Promise((r) => setTimeout(r, 30));
    h.sender.stop("paused");
    expect(await run).toEqual({ kind: "paused" });
    expect(h.sender.verifiedBytes).toBeLessThan(source.size);
    const ranges: ChunkRange[] = h.receiver.ranges;
    expect(ranges.every(([a, b]) => a <= b)).toBe(true);
  });

  it("respects the credit window (unacked chunks never exceed it)", async () => {
    const source = new SyntheticSource(20 * 16 * KiB);
    const window = 2;
    const [a, b] = createChannelPair();
    const tx = new DataChannelTransport(a, 8 * 1024 * KiB);
    const rx = new DataChannelTransport(b);
    let maxInFlight = 0;
    const sent = new Set<number>();
    const acked = new Set<number>();
    const sender = new FileSender({
      transport: tx,
      slot: 2,
      transferId: "tr_x",
      source,
      chunkSize: 16 * KiB,
      totalChunks: 20,
      frameSize: 16 * KiB,
      window,
    });
    tx.events.on("ctl", (ctl) => sender.handleCtl(ctl));
    // A slow receiver: acks each chunk 5 ms after its chunk_end.
    rx.events.on("ctl", (ctl) => {
      if (ctl.t === "file_open") rx.sendCtl({ t: "file_ready", slot: 2, have: [], window: 8 });
      if (ctl.t === "chunk_end") {
        sent.add(ctl.index);
        maxInFlight = Math.max(maxInFlight, sent.size - acked.size);
        setTimeout(() => {
          acked.add(ctl.index);
          rx.sendCtl({ t: "chunk_ack", slot: 2, index: ctl.index });
        }, 5);
      }
      if (ctl.t === "file_end") rx.sendCtl({ t: "file_done", slot: 2, ok: true });
    });
    expect(await sender.run()).toEqual({ kind: "done" });
    expect(maxInFlight).toBeLessThanOrEqual(window);
  });
});
