// Small peer-to-peer app messages (text drops, chat, reactions, pairing) over the same
// encrypted DataChannel that carries files. The server never sees their contents.
import { Emitter } from "@/lib/utils/emitter";
import { logger } from "@/lib/utils/logger";
import type { DataChannelTransport } from "./data-channel";
import type { AppMessage } from "./protocol";

export interface MessengerPeers {
  acquire(peerId: string): unknown;
  release(peerId: string): void;
  transportFor(peerId: string): DataChannelTransport | null;
  events: Emitter<{
    transport: { peerId: string; transport: DataChannelTransport };
    transportLost: { peerId: string };
    failed: { peerId: string };
  }>;
}

type Events = { message: { peerId: string; message: AppMessage } };

const CONNECT_TIMEOUT_MS = 20_000;

export class PeerMessenger {
  readonly events = new Emitter<Events>();
  private readonly subscribed = new WeakSet<DataChannelTransport>();
  private readonly offs: Array<() => void> = [];

  constructor(private readonly peers: MessengerPeers) {
    this.offs.push(peers.events.on("transport", ({ peerId, transport }) => this.attach(peerId, transport)));
  }

  /** Listens on transports that already exist (e.g. created before the messenger). */
  attach(peerId: string, transport: DataChannelTransport): void {
    if (this.subscribed.has(transport)) return;
    this.subscribed.add(transport);
    transport.events.on("ctl", (ctl) => {
      if (ctl.t === "app") this.events.emit("message", { peerId, message: ctl.m });
    });
  }

  /** Sends one message, connecting to the peer first if needed. Resolves false on failure. */
  async send(peerId: string, message: AppMessage): Promise<boolean> {
    this.peers.acquire(peerId);
    try {
      const transport = await this.waitForTransport(peerId);
      return transport ? transport.sendCtl({ t: "app", m: message }) : false;
    } catch (error) {
      logger.warn("messaging", "send failed", String(error));
      return false;
    } finally {
      this.peers.release(peerId);
    }
  }

  /** Sends to several peers in parallel; returns the ids that received it. */
  async broadcast(peerIds: readonly string[], message: AppMessage): Promise<string[]> {
    const results = await Promise.all(peerIds.map(async (id) => ((await this.send(id, message)) ? id : null)));
    return results.filter((id): id is string => id !== null);
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.events.clear();
  }

  private waitForTransport(peerId: string): Promise<DataChannelTransport | null> {
    const ready = this.peers.transportFor(peerId);
    if (ready) {
      this.attach(peerId, ready);
      return Promise.resolve(ready);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(null), CONNECT_TIMEOUT_MS);
      const offTransport = this.peers.events.on("transport", ({ peerId: id, transport }) => {
        if (id === peerId) finish(transport);
      });
      const offFailed = this.peers.events.on("failed", ({ peerId: id }) => {
        if (id === peerId) finish(null);
      });
      const finish = (transport: DataChannelTransport | null) => {
        clearTimeout(timer);
        offTransport();
        offFailed();
        if (transport) this.attach(peerId, transport);
        resolve(transport);
      };
    });
  }
}
