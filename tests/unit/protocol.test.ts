import { chunkLength, decodeFrame, encodeFrame, FRAME_HEADER_BYTES, parseCtl } from "@/lib/webrtc/protocol";

describe("binary frame protocol", () => {
  it("round-trips a frame with a compact 16-byte header", () => {
    const payload = new Uint8Array([1, 2, 3, 250, 255]);
    const buffer = encodeFrame(7, 123_456, 65_536, payload);
    expect(buffer.byteLength).toBe(FRAME_HEADER_BYTES + payload.byteLength);
    const frame = decodeFrame(buffer);
    expect(frame).not.toBeNull();
    expect(frame!.slot).toBe(7);
    expect(frame!.chunkIndex).toBe(123_456);
    expect(frame!.offset).toBe(65_536);
    expect(Array.from(frame!.payload)).toEqual([1, 2, 3, 250, 255]);
  });

  it("rejects malformed frames", () => {
    expect(decodeFrame(new ArrayBuffer(4))).toBeNull();
    const bad = encodeFrame(1, 0, 0, new Uint8Array(4));
    new DataView(bad).setUint8(0, 0x00); // wrong magic
    expect(decodeFrame(bad)).toBeNull();
    const truncated = encodeFrame(1, 0, 0, new Uint8Array(8)).slice(0, FRAME_HEADER_BYTES + 4);
    expect(decodeFrame(truncated)).toBeNull(); // length field does not match
  });

  it("parses valid control messages and rejects anything else", () => {
    expect(parseCtl(JSON.stringify({ t: "chunk_ack", slot: 1, index: 4 }))).toEqual({ t: "chunk_ack", slot: 1, index: 4 });
    expect(parseCtl(JSON.stringify({ t: "file_ready", slot: 1, have: [[0, 3]], window: 4 }))).toEqual({
      t: "file_ready",
      slot: 1,
      have: [[0, 3]],
      window: 4,
    });
    expect(parseCtl("not json")).toBeNull();
    expect(parseCtl(JSON.stringify({ t: "chunk_ack", slot: -1, index: 0 }))).toBeNull();
    expect(parseCtl(JSON.stringify({ t: "chunk_end", slot: 1, index: 0, sha256: "zz" }))).toBeNull();
    expect(parseCtl(JSON.stringify({ t: "unknown" }))).toBeNull();
    expect(parseCtl(JSON.stringify({ t: "file_ready", slot: 1, have: [[5, 2]], window: 4 }))).toBeNull();
  });

  it("validates file_open chunk arithmetic", () => {
    const ok = { t: "file_open", slot: 1, transferId: "tr_x", size: 10, chunkSize: 4, totalChunks: 3 };
    expect(parseCtl(JSON.stringify(ok))).not.toBeNull();
    expect(parseCtl(JSON.stringify({ ...ok, totalChunks: 2 }))).toBeNull();
  });

  it("computes the length of the last, shorter chunk", () => {
    expect(chunkLength(0, 10, 4)).toBe(4);
    expect(chunkLength(2, 10, 4)).toBe(2);
    expect(chunkLength(3, 10, 4)).toBe(0);
  });
});
