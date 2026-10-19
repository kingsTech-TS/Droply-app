// Test-only sink (the website ships a MemorySink tier; the app always has its sandbox). Chunks
// are written at their offsets into the in-memory file system, and finalize() returns a
// LocalFile whose bytes can be read with readMem().
import type { LocalFile } from "@/lib/files/local-file";
import type { ChunkSink } from "@/lib/storage/sinks/sink";
import { memFs } from "./native";

let next = 1;

export class MemorySink implements ChunkSink {
  readonly kind = "sandbox" as const;
  private readonly uri = `file:///memory-sink/${next++}`;
  private size = 0;

  constructor(_totalChunks: number) {
    memFs.set(this.uri, new Uint8Array(0));
  }

  async write(_index: number, offset: number, data: Uint8Array): Promise<void> {
    const current = memFs.get(this.uri) ?? new Uint8Array(0);
    const end = offset + data.byteLength;
    const grown = end > current.byteLength ? new Uint8Array(end) : current;
    if (grown !== current) grown.set(current);
    grown.set(data, offset);
    memFs.set(this.uri, grown);
    this.size = Math.max(this.size, end);
  }

  async finalize(): Promise<LocalFile> {
    return { uri: this.uri, name: "received", size: this.size, type: "application/octet-stream", lastModified: Date.now(), relativePath: null };
  }

  async close(): Promise<void> {}

  async discard(): Promise<void> {
    memFs.delete(this.uri);
  }
}
