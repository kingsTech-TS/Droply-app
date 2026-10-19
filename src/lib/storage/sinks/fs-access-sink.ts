// "Save into a folder" (Android): the website writes straight into a folder picked with the
// File System Access API. Android's Storage Access Framework can't write at random offsets,
// so chunks go to the sandbox `.part` file first and the finished file is copied into the
// picked folder, then the sandbox copy is removed.
import type { Directory } from "expo-file-system";
import { Platform } from "react-native";
import type { LocalFile } from "@/lib/files/local-file";
import { copyToFolder, pickSaveFolder } from "@/lib/storage/save";
import { deleteQuietly } from "@/lib/files/local-file";
import { SandboxSink } from "./sandbox-sink";
import type { ChunkSink } from "./sink";

/** A folder the user picked (Android SAF directory). */
export type DirectoryHandleLike = Directory;

export function canSaveDirectlyToDisk(): boolean {
  return Platform.OS === "android";
}

export async function pickDirectory(): Promise<DirectoryHandleLike | null> {
  return pickSaveFolder();
}

export class FsAccessSink implements ChunkSink {
  readonly kind = "fs-access" as const;
  private readonly inner: SandboxSink;

  constructor(
    private readonly directory: DirectoryHandleLike,
    transferId: string,
    private readonly fileName: string,
    private readonly folderPath: string | null,
  ) {
    this.inner = new SandboxSink(transferId, fileName);
  }

  write(index: number, offset: number, data: Uint8Array): Promise<void> {
    return this.inner.write(index, offset, data);
  }

  async finalize(): Promise<LocalFile | null> {
    const file = await this.inner.finalize();
    await copyToFolder(file, this.directory, this.fileName, this.folderPath);
    deleteQuietly(file.uri);
    return null;
  }

  close(): Promise<void> {
    return this.inner.close();
  }

  discard(): Promise<void> {
    return this.inner.discard();
  }
}
