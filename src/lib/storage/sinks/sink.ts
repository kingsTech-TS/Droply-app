// Where received chunks are written. Each chunk is written at its byte offset, so chunks can
// arrive in any order and a resumed transfer fills only the gaps.
import type { LocalFile } from "@/lib/files/local-file";

/**
 * - "sandbox": a `.part` file in the app's own storage (the website's OPFS tier).
 * - "fs-access": then copied into a folder the user picked (Android; the website's
 *   direct-to-disk tier).
 * - "memory": discarded bytes (speed tests).
 */
export type SinkKind = "fs-access" | "sandbox" | "memory";

export interface ChunkSink {
  readonly kind: SinkKind;
  /** Writes one verified chunk at `offset`. The caller must not reuse `data` afterwards. */
  write(index: number, offset: number, data: Uint8Array): Promise<void>;
  /**
   * Finishes the file. Returns the assembled file to save, or null if it is already in its
   * final place (a folder the user picked).
   */
  finalize(): Promise<LocalFile | null>;
  /** Releases handles but keeps the data (pause, app in background). */
  close(): Promise<void>;
  /** Deletes all temporary data. */
  discard(): Promise<void>;
}
