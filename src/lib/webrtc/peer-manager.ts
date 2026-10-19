// Owns one PeerLink per remote device and routes relayed signaling to it.
//
// Links are created lazily (when a transfer needs one, or when the peer sends an offer) and
// reference-counted: while any transfer holds a link it stays up; once released it is closed
// after IDLE_CLOSE_MS. Links to devices that leave the room are closed immediately.
import { Emitter, Store } from "@/lib/utils/emitter";
import type { RTCConfiguration, RTCPeerConnection } from "./rtc";
import type {
  ClientMessage,
  RelayedAnswer,
  RelayedIceCandidate,
  RelayedOffer,
} from "@/types/signaling";
import type { DataChannelTransport } from "./data-channel";
import type { IceServerProvider } from "./ice";
import { PeerLink, type LinkInfo } from "./peer-connection";

const IDLE_CLOSE_MS = 3 * 60 * 1000;

type Events = {
  transport: { peerId: string; transport: DataChannelTransport };
  transportLost: { peerId: string };
  failed: { peerId: string };
};

export interface PeerManagerOptions {
  selfId: string;
  send: (message: ClientMessage) => void;
  ice: IceServerProvider;
  localMaxFrame: number;
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
}

export class PeerManager {
  readonly events = new Emitter<Events>();
  /** Snapshot of every link's public state, keyed by peer id. */
  readonly links = new Store<Readonly<Record<string, LinkInfo>>>({});

  private readonly peers = new Map<string, PeerLink>();
  private readonly polite = new Map<string, boolean>();
  private readonly holds = new Map<string, number>();
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly unsubscribe = new Map<string, Array<() => void>>();
  private disposed = false;

  constructor(private readonly options: PeerManagerOptions) {}

  /** Records the perfect-negotiation role from room_state (or computes it). */
  setPolite(peerId: string, polite: boolean): void {
    this.polite.set(peerId, polite);
  }

  private isPolite(peerId: string): boolean {
    // The backend's rule: the device with the lexicographically greater id is polite.
    return this.polite.get(peerId) ?? this.options.selfId > peerId;
  }

  get(peerId: string): PeerLink | undefined {
    return this.peers.get(peerId);
  }

  transportFor(peerId: string): DataChannelTransport | null {
    const link = this.peers.get(peerId);
    return link?.isConnected ? link.transport : null;
  }

  /** Keeps a link to `peerId` up until the matching release(). Connects if needed. */
  acquire(peerId: string): PeerLink {
    this.retain(peerId);
    const link = this.link(peerId);
    if (link.info.getSnapshot().status === "failed") void link.retry();
    else void link.ensure();
    return link;
  }

  /**
   * Like acquire(), but never dials: the receiving side uses it so an idle timer cannot close
   * a link the sender is still using, without competing with the sender's offer.
   */
  retain(peerId: string): void {
    this.holds.set(peerId, (this.holds.get(peerId) ?? 0) + 1);
    this.cancelIdle(peerId);
  }

  frameSizeFor(peerId: string): number {
    return this.peers.get(peerId)?.frameSize ?? this.options.localMaxFrame;
  }

  /** Last RTT measured by getStats() for this link, or null. */
  rttFor(peerId: string): number | null {
    return this.peers.get(peerId)?.stats?.rttMs ?? null;
  }

  /** After the page was frozen in the background: retry links in use that failed meanwhile. */
  recoverInUse(): void {
    for (const [peerId, link] of this.peers) {
      if ((this.holds.get(peerId) ?? 0) > 0 && link.info.getSnapshot().status === "failed") void link.retry();
    }
  }

  /** Retries a link that gave up (e.g. the user pressed Retry). */
  retry(peerId: string, relayOnly = false): void {
    const link = this.link(peerId);
    void link.retry(relayOnly);
  }

  release(peerId: string): void {
    const count = (this.holds.get(peerId) ?? 0) - 1;
    if (count > 0) {
      this.holds.set(peerId, count);
      return;
    }
    this.holds.delete(peerId);
    this.scheduleIdle(peerId);
  }

  async handleOffer(message: RelayedOffer): Promise<void> {
    const link = this.link(message.sender_id);
    if (!this.holds.has(message.sender_id)) this.scheduleIdle(message.sender_id);
    await link.handleOffer(message);
  }

  async handleAnswer(message: RelayedAnswer): Promise<void> {
    await this.peers.get(message.sender_id)?.handleAnswer(message);
  }

  async handleCandidate(message: RelayedIceCandidate): Promise<void> {
    await this.peers.get(message.sender_id)?.handleCandidate(message);
  }

  /** The device left the room: drop its link. */
  remove(peerId: string): void {
    this.cancelIdle(peerId);
    this.holds.delete(peerId);
    const link = this.peers.get(peerId);
    if (!link) return;
    this.peers.delete(peerId);
    for (const off of this.unsubscribe.get(peerId) ?? []) off();
    this.unsubscribe.delete(peerId);
    link.close();
    this.links.update((current) => {
      const next = { ...current };
      delete next[peerId];
      return next;
    });
  }

  /** Polls stats for every connected link. */
  async refreshStats(stalledPeers: ReadonlySet<string> = new Set()): Promise<void> {
    await Promise.all([...this.peers.values()].map((link) => link.refreshStats(stalledPeers.has(link.peerId))));
  }

  dispose(): void {
    this.disposed = true;
    for (const peerId of [...this.peers.keys()]) this.remove(peerId);
    this.events.clear();
  }

  private link(peerId: string): PeerLink {
    let link = this.peers.get(peerId);
    if (link && link.info.getSnapshot().status !== "closed") return link;
    if (link) this.remove(peerId);
    link = new PeerLink({
      selfId: this.options.selfId,
      peerId,
      polite: this.isPolite(peerId),
      send: this.options.send,
      ice: this.options.ice,
      localMaxFrame: this.options.localMaxFrame,
      createPeerConnection: this.options.createPeerConnection,
    });
    this.peers.set(peerId, link);
    const created = link;
    const offs = [
      link.info.subscribe(() => {
        if (this.peers.get(peerId) !== created) return;
        this.links.update((current) => ({ ...current, [peerId]: created.info.getSnapshot() }));
      }),
      link.events.on("transport", (transport) => this.events.emit("transport", { peerId, transport })),
      link.events.on("transportLost", () => this.events.emit("transportLost", { peerId })),
      link.events.on("failed", () => this.events.emit("failed", { peerId })),
      link.events.on("closedByPeer", () => {
        if (this.peers.get(peerId) !== created || this.disposed) return;
        this.peers.delete(peerId);
        this.events.emit("transportLost", { peerId });
        // Reconnect later if a transfer still needs this peer.
        if (this.holds.has(peerId)) setTimeout(() => !this.disposed && void this.link(peerId).ensure(), 1000);
      }),
    ];
    this.unsubscribe.set(peerId, offs);
    this.links.update((current) => ({ ...current, [peerId]: created.info.getSnapshot() }));
    return link;
  }

  private scheduleIdle(peerId: string): void {
    this.cancelIdle(peerId);
    this.idleTimers.set(
      peerId,
      setTimeout(() => {
        this.idleTimers.delete(peerId);
        if (!this.holds.has(peerId)) this.remove(peerId);
      }, IDLE_CLOSE_MS),
    );
  }

  private cancelIdle(peerId: string): void {
    const timer = this.idleTimers.get(peerId);
    if (timer) clearTimeout(timer);
    this.idleTimers.delete(peerId);
  }
}
