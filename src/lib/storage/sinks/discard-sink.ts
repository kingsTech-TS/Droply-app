import type { ChunkSink } from "./sink";

/** Accepts verified chunks and drops them. Used for speed tests and benchmarks. */
export class DiscardSink implements ChunkSink {
  readonly kind = "memory" as const;
  bytes = 0;

  async write(_index: number, _offset: number, data: Uint8Array): Promise<void> {
    this.bytes += data.byteLength;
  }

  async finalize(): Promise<null> {
    return null;
  }

  async close(): Promise<void> {}

  async discard(): Promise<void> {}
}
