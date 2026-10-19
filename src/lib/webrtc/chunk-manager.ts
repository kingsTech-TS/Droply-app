// Reading chunks from a source without loading the whole file. Each read is one native
// FileHandle read of one chunk, and a global limiter bounds how many chunk buffers exist at
// once across all legs.
import { FileReader, type LocalFile } from "@/lib/files/local-file";
import { chunkLength } from "./protocol";

/** Anything that can hand out byte ranges: a local file, or synthetic bytes for tests/benchmarks. */
export interface ByteSource {
  readonly size: number;
  read(start: number, end: number): Promise<ArrayBuffer>;
  /** Releases native handles once the sender is done with this source. */
  close?(): void;
}

export class FileSource implements ByteSource {
  private readonly reader: FileReader;

  constructor(readonly file: LocalFile) {
    this.reader = new FileReader(file.uri);
  }

  get size(): number {
    return this.file.size;
  }

  read(start: number, end: number): Promise<ArrayBuffer> {
    return this.reader.read(start, Math.min(end, this.file.size));
  }

  close(): void {
    this.reader.close();
  }
}

/** Deterministic pseudo-random bytes; nothing is allocated beyond the requested range. */
export class SyntheticSource implements ByteSource {
  constructor(
    readonly size: number,
    private readonly seed = 1,
  ) {}

  async read(start: number, end: number): Promise<ArrayBuffer> {
    const length = Math.max(0, Math.min(end, this.size) - start);
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      const n = start + i;
      // Cheap position-dependent pattern, so a misplaced byte changes the digest.
      bytes[i] = (n * 2654435761 + this.seed * 97 + (n >>> 8) * 31) & 0xff;
    }
    return bytes.buffer;
  }
}

export function totalChunks(size: number, chunkSize: number): number {
  return Math.ceil(size / chunkSize);
}

export function chunkBounds(index: number, size: number, chunkSize: number): [number, number] {
  const start = index * chunkSize;
  return [start, start + chunkLength(index, size, chunkSize)];
}

/** Counting semaphore for concurrent chunk reads (bounds RAM across all legs). */
export class Limiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      // The releasing task hands its slot straight to us, so `active` is unchanged.
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await task();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}

export const readLimiter = new Limiter(4);
