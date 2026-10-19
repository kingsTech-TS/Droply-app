// The app's stand-in for the browser `File`: a file on this device, addressed by URI (a
// sandbox `file://` path, or an Android `content://` / iOS picker URI). Bytes are only ever
// read in bounded ranges through a native FileHandle, never loaded whole.
import { File as FsFile, FileMode, type FileHandle } from "expo-file-system";

export interface LocalFile {
  readonly uri: string;
  readonly name: string;
  readonly size: number;
  /** MIME type as reported by the picker/OS (display only, never trusted). */
  readonly type: string;
  readonly lastModified: number;
  /** Folder path inside a picked folder ("photos/2026"), like the browser's webkitRelativePath. */
  readonly relativePath?: string | null;
}

export function localFile(fields: {
  uri: string;
  name: string;
  size: number;
  type?: string | null;
  lastModified?: number | null;
  relativePath?: string | null;
}): LocalFile {
  return {
    uri: fields.uri,
    name: fields.name,
    size: fields.size,
    type: fields.type || "application/octet-stream",
    lastModified: fields.lastModified ?? Date.now(),
    relativePath: fields.relativePath ?? null,
  };
}

/** Wraps a file already on disk (sandbox), reading its size and name from the file system. */
export function localFileFromUri(uri: string, name?: string, type?: string): LocalFile {
  const file = new FsFile(uri);
  return localFile({
    uri: file.uri,
    name: name ?? file.name,
    size: file.size ?? 0,
    type: type ?? file.type,
    lastModified: file.modificationTime ?? Date.now(),
  });
}

/**
 * Sequential/random reader over one file. Keeps a single FileHandle open between reads (each
 * open costs a native round trip) and closes it when done. Calls are serialized because
 * operations on one handle are not guaranteed to run in call order.
 */
export class FileReader {
  private handle: FileHandle | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  /** The handle is closed after `idleMs` without reads and reopened on demand. */
  constructor(
    private readonly uri: string,
    private readonly idleMs = 5_000,
  ) {}

  read(start: number, end: number): Promise<ArrayBuffer> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    // Queued behind pending reads, so a handle is never closed mid-read.
    this.idleTimer = setTimeout(() => {
      this.queue = this.queue.then(() => this.close());
    }, this.idleMs);
    const run = this.queue.then(async () => {
      const length = Math.max(0, end - start);
      if (length === 0) return new ArrayBuffer(0);
      this.handle ??= new FsFile(this.uri).open(FileMode.ReadOnly);
      this.handle.offset = start;
      const bytes = await this.handle.readBytes(length);
      // Hand out an exactly-sized buffer (the native buffer may be larger than the view).
      return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.slice().buffer;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  close(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    try {
      this.handle?.close();
    } catch {
      // already closed
    }
    this.handle = null;
  }
}

/** Reads `[start, end)` of a file with a short-lived handle. */
export async function readRange(file: LocalFile, start: number, end: number): Promise<ArrayBuffer> {
  const reader = new FileReader(file.uri);
  try {
    return await reader.read(start, Math.min(end, file.size));
  } finally {
    reader.close();
  }
}

/** Deletes a file, ignoring "already gone". */
export function deleteQuietly(uri: string): void {
  try {
    const file = new FsFile(uri);
    if (file.exists) file.delete();
  } catch {
    // ignore
  }
}
