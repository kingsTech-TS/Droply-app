// Tests for the app-only platform code (not in the website): the optimistic buffered amount
// for react-native-webrtc, SDP max-message-size, the sandbox sink, and secure key storage.
import { secureKv } from "@/lib/platform/kv";
import { readRange } from "@/lib/files/local-file";
import { SandboxSink, cleanOrphanedSandboxFiles } from "@/lib/storage/sinks/sandbox-sink";
import { DataChannelTransport, type DataChannelLike } from "@/lib/webrtc/data-channel";
import { maxMessageSizeFromSdp } from "@/lib/webrtc/rtc";
import { memFile, memFs, readMem } from "../mocks/native";

/** A channel like react-native-webrtc's: bufferedAmount only changes when "native" says so. */
class LaggingChannel implements DataChannelLike {
  readyState = "open";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  binaryType = "arraybuffer";
  sent = 0;
  send(data: string | ArrayBuffer): void {
    if (typeof data !== "string") this.sent += data.byteLength;
  }
  close(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

describe("DataChannelTransport on react-native-webrtc", () => {
  it("counts bytes it handed to the channel until the native value catches up", async () => {
    const channel = new LaggingChannel();
    const transport = new DataChannelTransport(channel, 256 * 1024);
    await transport.sendFrame(new ArrayBuffer(100 * 1024));
    await transport.sendFrame(new ArrayBuffer(100 * 1024));
    // Native still reports 0, but 200 KiB are queued: backpressure must see them.
    expect(transport.bufferedAmount).toBe(200 * 1024);
    // A native update replaces the estimate.
    channel.bufferedAmount = 50 * 1024;
    expect(transport.bufferedAmount).toBe(50 * 1024);
  });

  it("waits for capacity instead of flooding when native lags", async () => {
    const channel = new LaggingChannel();
    const transport = new DataChannelTransport(channel, 256 * 1024);
    for (let i = 0; i < 5; i += 1) await transport.sendFrame(new ArrayBuffer(64 * 1024));
    let sent = false;
    const pending = transport.sendFrame(new ArrayBuffer(64 * 1024)).then(() => {
      sent = true;
    });
    await new Promise((r) => setTimeout(r, 250));
    expect(sent).toBe(false); // 320 KiB "in flight" is above the 256 KiB high-water mark
    channel.bufferedAmount = 0; // native drained
    await new Promise((r) => setTimeout(r, 250));
    await pending;
    expect(sent).toBe(true);
  });
});

describe("maxMessageSizeFromSdp", () => {
  const m = "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
  it("reads the remote's limit, defaults to 64 KiB, treats 0 as unlimited", () => {
    expect(maxMessageSizeFromSdp(`${m}a=max-message-size:262144\r\n`)).toBe(262144);
    expect(maxMessageSizeFromSdp(m)).toBe(64 * 1024);
    expect(maxMessageSizeFromSdp(`${m}a=max-message-size:0\r\n`)).toBe(256 * 1024);
    expect(maxMessageSizeFromSdp("v=0\r\n")).toBeNull();
    expect(maxMessageSizeFromSdp(null)).toBeNull();
  });
});

describe("SandboxSink", () => {
  beforeEach(() => memFs.clear());

  it("writes chunks at their offsets in any order and moves the file to Received/", async () => {
    const sink = new SandboxSink("tr_abc", "report.pdf");
    await sink.write(1, 4, new Uint8Array([5, 6, 7, 8]));
    await sink.write(0, 0, new Uint8Array([1, 2, 3, 4]));
    expect(SandboxSink.existingBytes("tr_abc")).toBe(8);
    const file = await sink.finalize();
    expect(file.name).toBe("report.pdf");
    expect(file.uri).toContain("/Received/");
    expect(Array.from(readMem(file.uri))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(SandboxSink.existingBytes("tr_abc")).toBe(0);
  });

  it("sanitizes and de-duplicates names, and never escapes Received/", async () => {
    const a = new SandboxSink("tr_1", "../../evil.sh");
    await a.write(0, 0, new Uint8Array([1]));
    const first = await a.finalize();
    const b = new SandboxSink("tr_2", "../../evil.sh");
    await b.write(0, 0, new Uint8Array([2]));
    const second = await b.finalize();
    expect(first.uri).toMatch(/\/Received\/[^/]+$/);
    expect(first.name).not.toContain("..");
    expect(second.name).not.toBe(first.name);
  });

  it("cleans up only orphaned part files", async () => {
    const keep = new SandboxSink("tr_keep", "a");
    const drop = new SandboxSink("tr_drop", "b");
    await keep.write(0, 0, new Uint8Array([1]));
    await drop.write(0, 0, new Uint8Array([1]));
    await cleanOrphanedSandboxFiles(new Set(["tr_keep"]));
    expect(SandboxSink.existingBytes("tr_keep")).toBe(1);
    expect(SandboxSink.existingBytes("tr_drop")).toBe(0);
  });
});

describe("local files", () => {
  it("reads bounded ranges", async () => {
    const file = memFile("x.bin", new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(Array.from(new Uint8Array(await readRange(file, 3, 6)))).toEqual([3, 4, 5]);
    expect(Array.from(new Uint8Array(await readRange(file, 8, 100)))).toEqual([8, 9]);
  });
});

describe("secureKv", () => {
  it("stores secrets and can list them (SecureStore can't enumerate on its own)", () => {
    secureKv.setItem("droply:session:rm_1", "a");
    secureKv.setItem("droply:session:rm_2", "b");
    expect(secureKv.getItem("droply:session:rm_1")).toBe("a");
    expect(secureKv.keys()).toEqual(expect.arrayContaining(["droply:session:rm_1", "droply:session:rm_2"]));
    secureKv.removeItem("droply:session:rm_1");
    expect(secureKv.keys()).not.toContain("droply:session:rm_1");
  });
});
