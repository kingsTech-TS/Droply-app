import { buildZip, crc32Update, type ZipOutput, type ZipSource } from "@/lib/storage/zip";

function memSource(bytes: Uint8Array): ZipSource {
  return { size: bytes.byteLength, read: async (start, end) => bytes.slice(start, end).buffer };
}

function memOutput(): ZipOutput & { bytes: () => Uint8Array; largestWrite: number } {
  const parts: Uint8Array[] = [];
  const out = {
    largestWrite: 0,
    async write(bytes: Uint8Array) {
      out.largestWrite = Math.max(out.largestWrite, bytes.byteLength);
      parts.push(bytes.slice());
    },
    bytes() {
      const total = parts.reduce((s, p) => s + p.byteLength, 0);
      const joined = new Uint8Array(total);
      let offset = 0;
      for (const p of parts) {
        joined.set(p, offset);
        offset += p.byteLength;
      }
      return joined;
    },
  };
  return out;
}

/** A small independent ZIP reader (central directory → local header → data). */
function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
  expect(eocd).toBeGreaterThanOrEqual(0);
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(ptr, true)).toBe(0x02014b50);
    const crc = view.getUint32(ptr + 16, true);
    const size = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    const localName = view.getUint16(localOffset + 26, true);
    const localExtra = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localName + localExtra;
    const data = bytes.subarray(start, start + size);
    expect(crc32Update(0, data)).toBe(crc);
    out.set(name, data);
    ptr += 46 + nameLen + extraLen;
  }
  return out;
}

describe("buildZip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32Update(0, new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("stores files with their folder paths and exact contents", async () => {
    const a = new Uint8Array(100_000).map((_, i) => i % 251);
    const b = new TextEncoder().encode("hello droply");
    const output = memOutput();
    await buildZip(
      [
        { path: "photos/2026/a.bin", file: memSource(a) },
        { path: "notes ✓.txt", file: memSource(b) },
      ],
      output,
    );
    const files = readZip(output.bytes());
    expect([...files.keys()]).toEqual(["photos/2026/a.bin", "notes ✓.txt"]);
    expect(Array.from(files.get("photos/2026/a.bin")!)).toEqual(Array.from(a));
    expect(new TextDecoder().decode(files.get("notes ✓.txt"))).toBe("hello droply");
  });

  it("streams the archive in bounded writes and reports its exact size", async () => {
    const big = new Uint8Array(20_000_000);
    const output = memOutput();
    const size = await buildZip([{ path: "big.bin", file: memSource(big) }], output);
    expect(size).toBe(big.byteLength + 30 + 7 + 46 + 7 + 22);
    expect(output.bytes().byteLength).toBe(size);
    // Never more than one 8 MiB read in flight: the file is never held whole.
    expect(output.largestWrite).toBeLessThanOrEqual(8 * 1024 * 1024);
  });

  it("writes readable ZIP64 records when asked", async () => {
    const data = new TextEncoder().encode("zip64");
    const output = memOutput();
    await buildZip([{ path: "z.txt", file: memSource(data) }], output, undefined, { forceZip64: true });
    const bytes = output.bytes();
    const view = new DataView(bytes.buffer);
    let found = false;
    for (let i = 0; i + 4 <= bytes.length; i += 1) if (view.getUint32(i, true) === 0x06064b50) found = true;
    expect(found).toBe(true);
  });
});
