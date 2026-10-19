// Builds a .zip of received files without loading them into memory: headers are small
// buffers, file contents are copied in bounded chunks straight into the output. Each file is
// read once to compute its CRC-32 and once to copy it. Entries are stored (no compression:
// most large files are already compressed), with ZIP64 records when sizes or offsets need
// them. Same archive layout as the website's zip.ts.

/** Random-access bytes (a local file, or memory in tests). */
export interface ZipSource {
  readonly size: number;
  read(start: number, end: number): Promise<ArrayBuffer>;
}

/** Sequential output (a file handle, or memory in tests). */
export interface ZipOutput {
  write(bytes: Uint8Array): Promise<void>;
}

export interface ZipEntry {
  /** Path inside the archive ("photos/2026/a.jpg"); already sanitized. */
  path: string;
  file: ZipSource;
  lastModified?: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32Update(crc: number, bytes: Uint8Array): number {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const READ_CHUNK = 8 * 1024 * 1024;

export async function crc32OfSource(source: ZipSource, onProgress?: (bytes: number) => void): Promise<number> {
  let crc = 0;
  for (let offset = 0; offset < source.size; offset += READ_CHUNK) {
    const bytes = new Uint8Array(await source.read(offset, Math.min(source.size, offset + READ_CHUNK)));
    crc = crc32Update(crc, bytes);
    onProgress?.(Math.min(source.size, offset + READ_CHUNK));
  }
  return crc;
}

async function copySource(source: ZipSource, output: ZipOutput): Promise<void> {
  for (let offset = 0; offset < source.size; offset += READ_CHUNK) {
    await output.write(new Uint8Array(await source.read(offset, Math.min(source.size, offset + READ_CHUNK))));
  }
}

function dosDateTime(ms: number): { date: number; time: number } {
  const d = new Date(ms);
  const year = Math.max(1980, d.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  };
}

const LIMIT = 0xfffffffe;
const UTF8_FLAG = 0x0800;

class Writer {
  private readonly view: DataView;
  private offset = 0;
  readonly bytes: Uint8Array<ArrayBuffer>;
  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }
  u16(v: number): this {
    this.view.setUint16(this.offset, v, true);
    this.offset += 2;
    return this;
  }
  u32(v: number): this {
    this.view.setUint32(this.offset, v >>> 0, true);
    this.offset += 4;
    return this;
  }
  u64(v: number): this {
    this.view.setBigUint64(this.offset, BigInt(v), true);
    this.offset += 8;
    return this;
  }
  raw(b: Uint8Array): this {
    this.bytes.set(b, this.offset);
    this.offset += b.length;
    return this;
  }
}

/**
 * Writes the archive to `output` and returns its size. Progress counts every byte read
 * (CRC pass + copy pass), so `total` is twice the content size.
 */
export async function buildZip(
  entries: readonly ZipEntry[],
  output: ZipOutput,
  onProgress?: (done: number, total: number) => void,
  /** Tests only: write ZIP64 records even for small files. */
  options: { forceZip64?: boolean } = {},
): Promise<number> {
  const encoder = new TextEncoder();
  const central: Uint8Array<ArrayBuffer>[] = [];
  const total = entries.reduce((s, e) => s + e.file.size, 0) * 2;
  let offset = 0;
  let done = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const size = entry.file.size;
    const crc = await crc32OfSource(entry.file, (bytes) => onProgress?.(done + bytes, total));
    done += size;
    const { date, time } = dosDateTime(entry.lastModified ?? Date.now());
    const zip64 = options.forceZip64 === true || size > LIMIT || offset > LIMIT;

    // Local header (ZIP64 extra field carries the real sizes).
    const localExtra = zip64 ? 20 : 0;
    const local = new Writer(30 + name.length + localExtra);
    local.u32(0x04034b50).u16(zip64 ? 45 : 20).u16(UTF8_FLAG).u16(0).u16(time).u16(date).u32(crc);
    local.u32(zip64 ? 0xffffffff : size).u32(zip64 ? 0xffffffff : size).u16(name.length).u16(localExtra).raw(name);
    if (zip64) local.u16(0x0001).u16(16).u64(size).u64(size);
    await output.write(local.bytes);
    await copySource(entry.file, output);
    done += size;
    onProgress?.(done, total);

    // Central directory record.
    const centralExtra = zip64 ? 28 : 0;
    const record = new Writer(46 + name.length + centralExtra);
    record.u32(0x02014b50).u16(zip64 ? 45 : 20).u16(zip64 ? 45 : 20).u16(UTF8_FLAG).u16(0).u16(time).u16(date).u32(crc);
    record.u32(zip64 ? 0xffffffff : size).u32(zip64 ? 0xffffffff : size).u16(name.length).u16(centralExtra);
    record.u16(0).u16(0).u16(0).u32(0).u32(zip64 ? 0xffffffff : offset).raw(name);
    if (zip64) record.u16(0x0001).u16(24).u64(size).u64(size).u64(offset);
    central.push(record.bytes);

    offset += local.bytes.length + size;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const centralOffset = offset;
  for (const record of central) await output.write(record);
  let written = centralOffset + centralSize;

  const needs64 = options.forceZip64 === true || entries.length >= 0xffff || centralOffset > LIMIT || centralSize > LIMIT;
  if (needs64) {
    const eocd64 = new Writer(56);
    eocd64.u32(0x06064b50).u64(44).u16(45).u16(45).u32(0).u32(0);
    eocd64.u64(entries.length).u64(entries.length).u64(centralSize).u64(centralOffset);
    const locator = new Writer(20);
    locator.u32(0x07064b50).u32(0).u64(centralOffset + centralSize).u32(1);
    await output.write(eocd64.bytes);
    await output.write(locator.bytes);
    written += eocd64.bytes.length + locator.bytes.length;
  }
  const end = new Writer(22);
  end.u32(0x06054b50).u16(0).u16(0);
  end.u16(needs64 ? 0xffff : entries.length).u16(needs64 ? 0xffff : entries.length);
  end.u32(needs64 ? 0xffffffff : centralSize).u32(needs64 ? 0xffffffff : centralOffset).u16(0);
  await output.write(end.bytes);
  return written + end.bytes.length;
}
