// End-to-end transfer flows: real TransferManagers on both sides, real FileSender/FileReceiver
// and protocol over simulated DataChannels, against an in-memory backend that follows the
// server's state machine and event fan-out.
import type { LocalFile } from "@/lib/files/local-file";
import { MemorySink } from "../mocks/memory-sink";
import { memFile, readMem } from "../mocks/native";
import type { SinkFactory } from "@/lib/storage/sinks/factory";
import { sha256Hex } from "@/lib/utils/hash";
import { MemoryResumeStore } from "@/lib/webrtc/resume-manager";
import { TransferManager, type Notice, type TransferSnapshot } from "@/lib/webrtc/transfer-manager";
import { FakeBackend, TEST_CONFIG } from "../mocks/fake-backend";
import { FakeNetwork } from "../mocks/fake-peers";
import type { FakeChannelOptions } from "../mocks/rtc";

const KiB = 1024;

function inFolder(file: LocalFile, relativePath: string): LocalFile {
  // Like the browser's webkitRelativePath: the folder part travels, the name is the file's.
  return { ...file, relativePath: relativePath.split("/").slice(0, -1).join("/") || null };
}

function makeFile(name: string, size: number, seed = 1): LocalFile {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + seed * 7 + (i >> 9)) & 0xff;
  return memFile(name, bytes);
}

const memorySinks: SinkFactory = {
  create: async (request) => new MemorySink(request.totalChunks),
  fits: async () => true,
};

interface Device {
  id: string;
  manager: TransferManager;
  notices: Notice[];
}

const managers: TransferManager[] = [];

interface WorldOptions {
  channel?: FakeChannelOptions;
  backendLimit?: number;
  maxActive?: number;
  /** Device ids that auto-accept everything ("My devices" rooms). */
  trustAll?: string[];
  maxRecipients?: number;
  /** Delay before a receiver's "complete" reaches the server (ms). */
  slowComplete?: number;
  sinks?: SinkFactory;
}

function world(ids: string[], options: WorldOptions = {}) {
  const backend = new FakeBackend(options.backendLimit ?? 20);
  const network = new FakeNetwork(options.channel ?? {});
  const devices = new Map<string, Device>();
  for (const id of ids) {
    const notices: Notice[] = [];
    const manager = new TransferManager({
      selfId: id,
      roomId: "rm_test",
      config: options.maxRecipients ? { ...TEST_CONFIG, max_recipients: options.maxRecipients } : TEST_CONFIG,
      api: options.slowComplete ? slowCompleteApi(backend.apiFor(id), options.slowComplete) : backend.apiFor(id),
      peers: network.node(id),
      send: backend.wsFor(id),
      resume: new MemoryResumeStore(),
      sinks: options.sinks ?? memorySinks,
      mobile: false,
      deviceName: (d) => d,
      maxActiveTransfers: options.maxActive,
      trustAll: options.trustAll?.includes(id) ?? false,
    });
    manager.notices.on("notice", (n) => notices.push(n));
    backend.connect(id, (event) => manager.handleEvent(event));
    managers.push(manager);
    devices.set(id, { id, manager, notices });
  }
  const get = (id: string) => devices.get(id)!;
  return { backend, network, get };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function slowCompleteApi(api: ReturnType<FakeBackend["apiFor"]>, delayMs: number): ReturnType<FakeBackend["apiFor"]> {
  return {
    ...api,
    act: async (id, action, body) => {
      if (action === "complete") await sleep(delayMs);
      return api.act(id, action, body);
    },
  };
}

async function until(condition: () => boolean, timeoutMs = 8000, label = "condition"): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(5);
  }
}

const items = (d: Device): TransferSnapshot[] => d.manager.store.getSnapshot().items;
const incoming = (d: Device) => items(d).filter((i) => i.direction === "incoming");
const outgoing = (d: Device) => items(d).filter((i) => i.direction === "outgoing");
const requests = (d: Device) => d.manager.store.getSnapshot().requests;

async function acceptAll(d: Device): Promise<void> {
  await until(() => requests(d).length > 0, 8000, `request on ${d.id}`);
  for (const request of requests(d)) await d.manager.accept(request.key);
}

async function savedBytesOf(d: Device, fileName: string): Promise<string> {
  const manager = d.manager as unknown as { incoming: Map<string, { fileName: string; finalFile: LocalFile | null }> };
  const record = [...manager.incoming.values()].find((r) => r.fileName === fileName);
  if (!record?.finalFile) throw new Error(`no final file for ${fileName}`);
  return sha256Hex(readMem(record.finalFile.uri));
}

afterEach(() => {
  for (const manager of managers.splice(0)) manager.dispose();
});

describe("TransferManager end to end", () => {
  it("assembles a file once even when the receiver's 'complete' is slow to reach the server", async () => {
    // Regression (web → app): the sender started the finished file again while the leg was
    // still "transferring" on the server, and the app assembled it a second time. Like the
    // app's real storage (the first assembly moves the file), a second finalize fails here.
    let finalized = 0;
    const strictSinks: SinkFactory = {
      create: async (request) => {
        const sink = new MemorySink(request.totalChunks);
        const finalize = sink.finalize.bind(sink);
        sink.finalize = async () => {
          finalized += 1;
          if (finalized > 1) throw new Error("already moved to its final place");
          return finalize();
        };
        return sink;
      },
      fits: async () => true,
    };
    const { get } = world(["dv_aaaaaaaaaaaaaaaaaaaa", "dv_bbbbbbbbbbbbbbbbbbbb"], { slowComplete: 600, sinks: strictSinks });
    const a = get("dv_aaaaaaaaaaaaaaaaaaaa");
    const b = get("dv_bbbbbbbbbbbbbbbbbbbb");
    const file = makeFile("photo.jpg", 200 * KiB + 3);
    a.manager.send([file], [b.id]);
    await acceptAll(b);
    await until(() => outgoing(a)[0]?.legs[0]?.status === "completed", 8000, "sender completed");
    await until(() => incoming(b)[0]?.save === "ready", 8000, "receiver ready");
    await sleep(800); // room for a duplicate run to show up

    expect(finalized).toBe(1);
    expect(b.notices.some((n) => n.message.includes("Couldn't assemble"))).toBe(false);
    expect(incoming(b)[0]?.verification).toBe("verified");
    expect(await savedBytesOf(b, "photo.jpg")).toBe(await sha256Hex(readMem(file.uri)));
  });

  it("sends one file: request → accept → P2P → verified → complete on both sides", async () => {
    const { get } = world(["dv_aaaaaaaaaaaaaaaaaaaa", "dv_bbbbbbbbbbbbbbbbbbbb"]);
    const a = get("dv_aaaaaaaaaaaaaaaaaaaa");
    const b = get("dv_bbbbbbbbbbbbbbbbbbbb");
    const file = makeFile("report.pdf", 300 * KiB + 17);
    expect(a.manager.send([file], [b.id])).toBe(1);

    await acceptAll(b);
    await until(() => incoming(b)[0]?.save === "ready", 8000, "receiver ready");
    await until(() => outgoing(a)[0]?.legs[0]?.status === "completed", 8000, "sender completed");

    const received = incoming(b)[0]!;
    expect(received.verification).toBe("verified");
    expect(received.legs[0]?.status).toBe("completed");
    expect(received.legs[0]?.verifiedBytes).toBe(file.size);
    expect(await savedBytesOf(b, "report.pdf")).toBe(await sha256Hex(readMem(file.uri)));
    expect(a.notices.some((n) => n.kind === "success")).toBe(true);
    expect(b.notices.some((n) => n.kind === "success" && n.message.includes("report.pdf"))).toBe(true);
  });

  it("groups several files from one sender into one request and receives them all", async () => {
    const { get } = world(["dv_aaaaaaaaaaaaaaaaaaaa", "dv_bbbbbbbbbbbbbbbbbbbb"]);
    const a = get("dv_aaaaaaaaaaaaaaaaaaaa");
    const b = get("dv_bbbbbbbbbbbbbbbbbbbb");
    const files = [makeFile("a.bin", 100 * KiB, 1), makeFile("b.bin", 70 * KiB, 2), makeFile("c.bin", 1, 3)];
    a.manager.send(files, [b.id]);
    await until(() => requests(b)[0]?.transferIds.length === 3, 8000, "grouped request");
    expect(requests(b)).toHaveLength(1);
    expect(requests(b)[0]?.totalBytes).toBe(files.reduce((s, f) => s + f.size, 0));
    await b.manager.accept(requests(b)[0]!.key);
    await until(() => incoming(b).filter((i) => i.save === "ready").length === 3, 8000, "all received");
    for (const file of files) {
      expect(await savedBytesOf(b, file.name)).toBe(await sha256Hex(readMem(file.uri)));
    }
    // One batch-level notification, not one per file.
    expect(b.notices.filter((n) => n.kind === "success")).toHaveLength(1);
  });

  it("delivers to multiple recipients independently (one declines)", async () => {
    const { get } = world(["dv_aaaaaaaaaaaaaaaaaaaa", "dv_bbbbbbbbbbbbbbbbbbbb", "dv_cccccccccccccccccccc"]);
    const a = get("dv_aaaaaaaaaaaaaaaaaaaa");
    const b = get("dv_bbbbbbbbbbbbbbbbbbbb");
    const c = get("dv_cccccccccccccccccccc");
    const file = makeFile("video.mp4", 200 * KiB);
    a.manager.send([file], [b.id, c.id]);
    await acceptAll(b);
    await until(() => requests(c).length > 0);
    await c.manager.decline(requests(c)[0]!.key);
    await until(() => incoming(b)[0]?.save === "ready", 8000, "b received");
    await until(() => {
      const legs = outgoing(a)[0]?.legs ?? [];
      return legs.find((l) => l.deviceId === b.id)?.status === "completed" && legs.find((l) => l.deviceId === c.id)?.status === "rejected";
    }, 8000, "leg statuses");
    expect(await savedBytesOf(b, "video.mp4")).toBe(await sha256Hex(readMem(file.uri)));
  });

  it("stays under the server's per-device transfer limit when sending many files", async () => {
    const { get, backend } = world(["dv_aaaaaaaaaaaaaaaaaaaa", "dv_bbbbbbbbbbbbbbbbbbbb"], { backendLimit: 3, maxActive: 2 });
    const a = get("dv_aaaaaaaaaaaaaaaaaaaa");
    const b = get("dv_bbbbbbbbbbbbbbbbbbbb");
    b.manager.setTrusted(a.id, true); // auto-accept, so groups flow without clicks
    const files = Array.from({ length: 7 }, (_, i) => makeFile(`f${i}.bin`, 20 * KiB, i));
    a.manager.send(files, [b.id]);
    await until(() => incoming(b).filter((i) => i.save === "ready").length === 7, 15000, "all 7 received");
    // The sender marks a leg completed when the final acknowledgement arrives, which can be
    // just after the receiver has finished saving.
    await until(() => outgoing(a).every((i) => i.legs[0]?.status === "completed"), 5000, "sender legs completed");
    expect(backend.maxUnfinishedSeen).toBeLessThanOrEqual(2);
  });

  it("runs a speed test with synthetic data that is verified and discarded", async () => {
    const { get } = world(["dv_aaaaaaaaaaaaaaaaaaaa", "dv_bbbbbbbbbbbbbbbbbbbb"]);
    const a = get("dv_aaaaaaaaaaaaaaaaaaaa");
    const b = get("dv_bbbbbbbbbbbbbbbbbbbb");
    const progress: number[] = [];
    const result = await a.manager.runSpeedTest(b.id, 9 * 1024 * KiB, (bytes) => progress.push(bytes));
    expect(result.ok).toBe(true);
    expect(result.bytes).toBe(9 * 1024 * KiB);
    expect(progress.at(-1)).toBe(9 * 1024 * KiB);
    // No transfer, no request, nothing saved on either side.
    expect(items(a)).toHaveLength(0);
    expect(items(b)).toHaveLength(0);
    expect(requests(b)).toHaveLength(0);
    // The measured speed feeds the send-time estimate.
    expect(a.manager.estimateSeconds(1024 * KiB, [b.id])).toBeGreaterThan(0);
  });

  it("keeps folder structure, sanitizes paths and auto-accepts between paired devices", async () => {
    const { get } = world(["dv_aaaaaaaaaaaaaaaaaaaa", "dv_bbbbbbbbbbbbbbbbbbbb"], { trustAll: ["dv_bbbbbbbbbbbbbbbbbbbb"] });
    const a = get("dv_aaaaaaaaaaaaaaaaaaaa");
    const b = get("dv_bbbbbbbbbbbbbbbbbbbb");
    const nested = inFolder(makeFile("beach.jpg", 40 * KiB), "Holiday/2026/beach.jpg");
    const hostile = inFolder(makeFile("x.bin", 10 * KiB, 2), "../../etc/x.bin");
    a.manager.send([nested, hostile], [b.id]);
    // No accept click: b trusts everyone in this room.
    await until(() => incoming(b).filter((i) => i.save === "ready").length === 2, 8000, "both received");
    expect(requests(b)).toHaveLength(0);
    const byName = new Map(incoming(b).map((i) => [i.fileName, i]));
    expect(byName.get("beach.jpg")?.relativePath).toBe("Holiday/2026");
    expect(byName.get("x.bin")?.relativePath).toBe("etc");
  });

  it("records reactions on both sides", async () => {
    const { get } = world(["dv_aaaaaaaaaaaaaaaaaaaa", "dv_bbbbbbbbbbbbbbbbbbbb", "dv_cccccccccccccccccccc"]);
    const a = get("dv_aaaaaaaaaaaaaaaaaaaa");
    const b = get("dv_bbbbbbbbbbbbbbbbbbbb");
    const c = get("dv_cccccccccccccccccccc");
    a.manager.send([makeFile("song.mp3", 30 * KiB)], [b.id]);
    await acceptAll(b);
    await until(() => incoming(b)[0]?.save === "ready", 8000, "received");
    const transferId = incoming(b)[0]!.transferId!;
    expect(b.manager.markReacted(transferId, "🔥")).toBe(a.id);
    expect(incoming(b)[0]!.reactions).toEqual(["🔥"]);
    a.manager.addReaction(transferId, b.id, "🔥");
    // A device that wasn't a recipient can't react.
    a.manager.addReaction(transferId, c.id, "😂");
    expect(outgoing(a)[0]!.reactions).toEqual(["🔥"]);
  });

  it("splits large audiences into transfers of at most max_recipients", async () => {
    const ids = ["dv_aaaaaaaaaaaaaaaaaaaa", "dv_bbbbbbbbbbbbbbbbbbbb", "dv_cccccccccccccccccccc", "dv_dddddddddddddddddddd"];
    const { get } = world(ids, { maxRecipients: 2, trustAll: ids.slice(1) });
    const a = get(ids[0]!);
    expect(a.manager.send([makeFile("poster.png", 20 * KiB)], ids.slice(1))).toBe(1);
    const groups = outgoing(a);
    expect(groups.map((g) => g.legs.length).sort()).toEqual([1, 2]);
    expect(new Set(groups.map((g) => g.batchId)).size).toBe(1);
    for (const id of ids.slice(1)) {
      await until(() => incoming(get(id))[0]?.save === "ready", 8000, `${id} received`);
    }
  });

  it("files sent together are one request even when they arrive slowly, and later ones follow the answer", async () => {
    const { get, backend } = world(["dv_aaaaaaaaaaaaaaaaaaaa", "dv_bbbbbbbbbbbbbbbbbbbb"], { backendLimit: 2 });
    const a = get("dv_aaaaaaaaaaaaaaaaaaaa");
    const b = get("dv_bbbbbbbbbbbbbbbbbbbb");
    // With a limit of 2 unfinished transfers, the sender creates the 5 files in rounds.
    a.manager.send(
      Array.from({ length: 5 }, (_, i) => makeFile(`p${i}.jpg`, 20 * KiB, i)),
      [b.id],
    );
    await until(() => requests(b).length > 0, 8000, "first request");
    await sleep(2500); // longer than the timing fallback
    expect(requests(b)).toHaveLength(1);
    await b.manager.accept(requests(b)[0]!.key);
    // The rest arrive after accepting and are accepted without another card.
    await until(() => incoming(b).filter((i) => i.save === "ready").length === 5, 15000, "all 5 received");
    expect(requests(b)).toHaveLength(0);
    expect(backend.maxUnfinishedSeen).toBeLessThanOrEqual(2);
  });

  it("still works with servers that reject batch_id", async () => {
    const { get, backend } = world(["dv_aaaaaaaaaaaaaaaaaaaa", "dv_bbbbbbbbbbbbbbbbbbbb"]);
    backend.rejectBatchIds = true;
    const a = get("dv_aaaaaaaaaaaaaaaaaaaa");
    const b = get("dv_bbbbbbbbbbbbbbbbbbbb");
    a.manager.send([makeFile("x.bin", 10 * KiB), makeFile("y.bin", 10 * KiB, 2)], [b.id]);
    await until(() => requests(b)[0]?.transferIds.length === 2, 8000, "both files in one request");
    expect(requests(b)).toHaveLength(1);
    await acceptAll(b);
    await until(() => incoming(b).filter((i) => i.save === "ready").length === 2, 8000, "received");
  });

  it("pauses and resumes from the receiver's gaps without restarting", async () => {
    const { get } = world(["dv_aaaaaaaaaaaaaaaaaaaa", "dv_bbbbbbbbbbbbbbbbbbbb"], { channel: { bytesPerTick: 32 * KiB, tickMs: 1 } });
    const a = get("dv_aaaaaaaaaaaaaaaaaaaa");
    const b = get("dv_bbbbbbbbbbbbbbbbbbbb");
    const file = makeFile("big.iso", 2 * 1024 * KiB);
    a.manager.send([file], [b.id]);
    await acceptAll(b);
    await until(() => (incoming(b)[0]?.legs[0]?.verifiedBytes ?? 0) > 256 * KiB, 8000, "some progress");
    await a.manager.pause(outgoing(a)[0]!.localId);
    await until(() => incoming(b)[0]?.legs[0]?.status === "paused", 8000, "receiver paused");
    const atPause = incoming(b)[0]!.legs[0]!.verifiedBytes;
    expect(atPause).toBeLessThan(file.size);
    await sleep(50);
    // Paused means paused: nothing more arrives.
    expect(incoming(b)[0]!.legs[0]!.verifiedBytes).toBe(atPause);

    await a.manager.resume(outgoing(a)[0]!.localId);
    await until(() => incoming(b)[0]?.save === "ready", 15000, "completed after resume");
    expect(await savedBytesOf(b, "big.iso")).toBe(await sha256Hex(readMem(file.uri)));
  });

  it("recovers from a dropped connection: auto-pause, then auto-resume when the link is back", async () => {
    const { get, network } = world(["dv_aaaaaaaaaaaaaaaaaaaa", "dv_bbbbbbbbbbbbbbbbbbbb"], { channel: { bytesPerTick: 32 * KiB, tickMs: 1 } });
    const a = get("dv_aaaaaaaaaaaaaaaaaaaa");
    const b = get("dv_bbbbbbbbbbbbbbbbbbbb");
    const file = makeFile("photos.zip", 2 * 1024 * KiB, 5);
    a.manager.send([file], [b.id]);
    await acceptAll(b);
    await until(() => (incoming(b)[0]?.legs[0]?.verifiedBytes ?? 0) > 256 * KiB, 8000, "some progress");

    network.drop(a.id, b.id);
    await until(() => outgoing(a)[0]?.legs[0]?.status === "paused", 8000, "auto-paused");
    expect(outgoing(a)[0]?.legs[0]?.autoResume).toBe(true);

    network.restore(a.id, b.id);
    await until(() => incoming(b)[0]?.save === "ready", 15000, "completed after reconnect");
    expect(await savedBytesOf(b, "photos.zip")).toBe(await sha256Hex(readMem(file.uri)));
  });

  it("cancels from the receiver side and stops the sender", async () => {
    const { get } = world(["dv_aaaaaaaaaaaaaaaaaaaa", "dv_bbbbbbbbbbbbbbbbbbbb"], { channel: { bytesPerTick: 16 * KiB, tickMs: 1 } });
    const a = get("dv_aaaaaaaaaaaaaaaaaaaa");
    const b = get("dv_bbbbbbbbbbbbbbbbbbbb");
    a.manager.send([makeFile("movie.mkv", 2 * 1024 * KiB)], [b.id]);
    await acceptAll(b);
    await until(() => (incoming(b)[0]?.legs[0]?.verifiedBytes ?? 0) > 64 * KiB, 8000, "some progress");
    await b.manager.cancel(incoming(b)[0]!.localId);
    await until(() => outgoing(a)[0]?.legs[0]?.status === "cancelled", 8000, "sender sees cancel");
    expect(incoming(b)[0]?.legs[0]?.status).toBe("cancelled");
  });

  it("lets the sender cancel a queued file before it reaches the server", async () => {
    const { get } = world(["dv_aaaaaaaaaaaaaaaaaaaa", "dv_bbbbbbbbbbbbbbbbbbbb"], { backendLimit: 1, maxActive: 1 });
    const a = get("dv_aaaaaaaaaaaaaaaaaaaa");
    const b = get("dv_bbbbbbbbbbbbbbbbbbbb");
    a.manager.send([makeFile("one.bin", 10 * KiB), makeFile("two.bin", 10 * KiB)], [b.id]);
    await until(() => outgoing(a).some((i) => i.legs[0]?.status === "queued"), 8000, "a queued file");
    const queued = outgoing(a).find((i) => i.legs[0]?.status === "queued")!;
    await a.manager.cancel(queued.localId);
    expect(outgoing(a).find((i) => i.localId === queued.localId)?.legs[0]?.status).toBe("cancelled");
    expect(queued.transferId).toBeNull();
  });

  it("skips empty files with a warning", () => {
    const { get } = world(["dv_aaaaaaaaaaaaaaaaaaaa", "dv_bbbbbbbbbbbbbbbbbbbb"]);
    const a = get("dv_aaaaaaaaaaaaaaaaaaaa");
    expect(a.manager.send([memFile("empty.txt", new Uint8Array(0))], ["dv_bbbbbbbbbbbbbbbbbbbb"])).toBe(0);
    expect(a.notices.some((n) => n.kind === "warning")).toBe(true);
  });
});
