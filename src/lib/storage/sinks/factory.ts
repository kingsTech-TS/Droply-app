// Picks where an incoming file is stored: a folder the user chose (Android), otherwise the
// app sandbox. The website's tiers below these (IndexedDB, memory) exist because browsers may
// lack OPFS; the app sandbox is always available.
import { estimateStorage } from "../quota";
import { FsAccessSink, type DirectoryHandleLike } from "./fs-access-sink";
import { SandboxSink } from "./sandbox-sink";
import type { ChunkSink, SinkKind } from "./sink";

export interface SinkRequest {
  transferId: string;
  fileName: string;
  size: number;
  totalChunks: number;
  /** A folder the user picked for saving, if any. */
  directory?: DirectoryHandleLike | null;
  /** Reopen this tier (resume after a restart). */
  preferredKind?: SinkKind | null;
  /** Sanitized folder path inside a sent folder. */
  folderPath?: string | null;
}

export class NoStorageError extends Error {
  override readonly name = "NoStorageError";
}

export interface SinkFactory {
  create(request: SinkRequest): Promise<ChunkSink>;
  /** Whether `bytes` fit in free storage (null = unknown). */
  fits(bytes: number): Promise<boolean | null>;
}

export const nativeSinkFactory: SinkFactory = {
  async create(request) {
    const { transferId, fileName, size, directory, folderPath } = request;
    const { available } = await estimateStorage();
    const alreadyStored = SandboxSink.existingBytes(transferId);
    if (available !== null && available < size - alreadyStored) {
      throw new NoStorageError("Not enough free space on this device.");
    }
    if (directory) return new FsAccessSink(directory, transferId, fileName, folderPath ?? null);
    return new SandboxSink(transferId, fileName, folderPath ?? null);
  },
  async fits(bytes) {
    const { available } = await estimateStorage();
    return available === null ? null : available > bytes * 1.05;
  },
};
