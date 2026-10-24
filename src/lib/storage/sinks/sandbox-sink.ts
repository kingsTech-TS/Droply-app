// Default storage tier: a `.part` file in the app sandbox, written at chunk offsets through
// one native FileHandle (random access, so a resumed transfer fills only the gaps). The
// website's equivalent is OPFS. On completion the file is moved into Droply/ (Documents) under
// a sanitized, de-duplicated name.
import { Directory, File as FsFile, FileMode, Paths, type FileHandle } from "expo-file-system";
import { localFileFromUri, type LocalFile } from "@/lib/files/local-file";
import { logger } from "@/lib/utils/logger";
import { dedupeFileName, sanitizeFileName, sanitizeFolderPath } from "@/lib/utils/sanitize-filename";
import type { ChunkSink } from "./sink";

export const INCOMING_DIR = "droply-incoming";
/** Finished files. On iOS this is the Droply folder people see in the Files app. */
export const RECEIVED_DIR = "Droply";

export function incomingDirectory(): Directory {
  return new Directory(Paths.cache, INCOMING_DIR);
}

export function receivedDirectory(): Directory {
  return new Directory(Paths.document, RECEIVED_DIR);
}

function partFile(transferId: string): FsFile {
  // Transfer ids are server-issued ([A-Za-z0-9_-]); strip anything else anyway.
  return new FsFile(incomingDirectory(), `${transferId.replace(/[^A-Za-z0-9_-]/g, "_")}.part`);
}

function ensureDirectory(dir: Directory): void {
  dir.create({ intermediates: true, idempotent: true });
}

export class SandboxSink implements ChunkSink {
  readonly kind = "sandbox" as const;
  private handle: FileHandle | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly file: FsFile;

  constructor(
    private readonly transferId: string,
    private readonly fileName: string,
    private readonly folderPath: string | null = null,
  ) {
    this.file = partFile(transferId);
  }

  /** Bytes already on disk for this transfer (0 if there is no part file). */
  static existingBytes(transferId: string): number {
    const file = partFile(transferId);
    return file.exists ? (file.size ?? 0) : 0;
  }

  private serial<T>(task: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private open(): FileHandle {
    if (this.handle) return this.handle;
    ensureDirectory(incomingDirectory());
    if (!this.file.exists) this.file.create({ intermediates: true });
    this.handle = this.file.open(FileMode.ReadWrite);
    return this.handle;
  }

  write(_index: number, offset: number, data: Uint8Array): Promise<void> {
    return this.serial(async () => {
      const handle = this.open();
      handle.offset = offset;
      await handle.writeBytes(data);
    });
  }

  finalize(): Promise<LocalFile> {
    return this.serial(() => {
      this.closeHandle();
      const base = receivedDirectory();
      ensureDirectory(base);
      let dir = base;
      const folder = sanitizeFolderPath(this.folderPath);
      if (folder) {
        dir = new Directory(base, ...folder.split("/"));
        ensureDirectory(dir);
      }
      const taken = new Set(dir.list().map((entry) => entry.name));
      const name = dedupeFileName(sanitizeFileName(this.fileName), taken);
      const destination = new FsFile(dir, name);
      this.file.move(destination);
      return localFileFromUri(destination.uri, name);
    });
  }

  close(): Promise<void> {
    return this.serial(() => this.closeHandle());
  }

  discard(): Promise<void> {
    return this.serial(() => {
      this.closeHandle();
      try {
        if (this.file.exists) this.file.delete();
      } catch (error) {
        logger.warn("sink", "discard failed", String(error));
      }
    });
  }

  private closeHandle(): void {
    try {
      this.handle?.close();
    } catch {
      // already closed
    }
    this.handle = null;
  }

  toString(): string {
    return `SandboxSink(${this.transferId})`;
  }
}

/** Deletes `.part` files of transfers that are no longer resumable. */
export async function cleanOrphanedSandboxFiles(keepTransferIds: ReadonlySet<string>): Promise<void> {
  try {
    const dir = incomingDirectory();
    if (!dir.exists) return;
    for (const entry of dir.list()) {
      if (!(entry instanceof FsFile) || !entry.name.endsWith(".part")) continue;
      const id = entry.name.slice(0, -".part".length);
      if (!keepTransferIds.has(id)) entry.delete();
    }
  } catch (error) {
    logger.warn("sink", "cleanup failed", String(error));
  }
}

/** Bytes held in unfinished `.part` files. */
export function sandboxTemporaryBytes(): number {
  try {
    const dir = incomingDirectory();
    if (!dir.exists) return 0;
    return dir.list().reduce((sum, entry) => sum + (entry instanceof FsFile ? (entry.size ?? 0) : 0), 0);
  } catch {
    return 0;
  }
}
