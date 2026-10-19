// A fake peer network for TransferManager tests: connected DataChannelTransport pairs
// between devices, with controls to drop and restore a link.
import { Emitter } from "@/lib/utils/emitter";
import { DataChannelTransport } from "@/lib/webrtc/data-channel";
import type { PeerAccess } from "@/lib/webrtc/transfer-manager";
import { createChannelPair, type FakeChannelOptions } from "./rtc";

type Events = PeerAccess["events"] extends Emitter<infer E> ? E : never;

export class FakeNetwork {
  readonly nodes = new Map<string, FakePeers>();
  private readonly links = new Map<string, { a: DataChannelTransport; b: DataChannelTransport }>();
  private readonly down = new Set<string>();

  constructor(private readonly channel: FakeChannelOptions = {}) {}

  node(deviceId: string): FakePeers {
    const peers = new FakePeers(deviceId, this);
    this.nodes.set(deviceId, peers);
    return peers;
  }

  key(x: string, y: string): string {
    return [x, y].sort().join("|");
  }

  transport(self: string, peer: string): DataChannelTransport | null {
    const link = this.links.get(this.key(self, peer));
    if (!link) return null;
    const [first] = [self, peer].sort();
    const transport = self === first ? link.a : link.b;
    return transport.isOpen ? transport : null;
  }

  /** Connects two devices if they aren't already (and the link isn't "down"). */
  ensure(x: string, y: string): void {
    const key = this.key(x, y);
    if (this.down.has(key) || this.transport(x, y)) return;
    const [first, second] = [x, y].sort() as [string, string];
    const [ca, cb] = createChannelPair(this.channel, this.channel);
    const link = { a: new DataChannelTransport(ca, 512 * 1024), b: new DataChannelTransport(cb, 512 * 1024) };
    this.links.set(key, link);
    setTimeout(() => {
      this.nodes.get(first)?.events.emit("transport", { peerId: second, transport: link.a });
      this.nodes.get(second)?.events.emit("transport", { peerId: first, transport: link.b });
    }, 1);
  }

  /** Drops the link (both channels close) and keeps it down until restore(). */
  drop(x: string, y: string): void {
    const key = this.key(x, y);
    this.down.add(key);
    const link = this.links.get(key);
    this.links.delete(key);
    link?.a.close();
    for (const id of [x, y]) {
      const other = id === x ? y : x;
      this.nodes.get(id)?.events.emit("transportLost", { peerId: other });
    }
  }

  restore(x: string, y: string): void {
    this.down.delete(this.key(x, y));
    const held = this.nodes.get(x)?.holds.has(y) || this.nodes.get(y)?.holds.has(x);
    if (held) this.ensure(x, y);
  }
}

export class FakePeers implements PeerAccess {
  readonly events = new Emitter<Events>();
  readonly holds = new Map<string, number>();

  constructor(
    readonly selfId: string,
    private readonly network: FakeNetwork,
  ) {}

  acquire(peerId: string): void {
    this.retain(peerId);
    this.network.ensure(this.selfId, peerId);
  }

  retain(peerId: string): void {
    this.holds.set(peerId, (this.holds.get(peerId) ?? 0) + 1);
  }

  release(peerId: string): void {
    const count = (this.holds.get(peerId) ?? 0) - 1;
    if (count > 0) this.holds.set(peerId, count);
    else this.holds.delete(peerId);
  }

  transportFor(peerId: string): DataChannelTransport | null {
    return this.network.transport(this.selfId, peerId);
  }

  frameSizeFor(): number {
    return 16 * 1024;
  }

  rttFor(): number | null {
    return 5;
  }
}
