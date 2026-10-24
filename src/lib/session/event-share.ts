// Event rooms, guest side. The host (on the website) shares files into the room's catalog
// (metadata on the server); this device picks what to download. It asks the host's device for
// a file over the peer-to-peer channel; the host's device sends it as a normal transfer tagged
// with this device's request id, which is accepted without asking. Previews come the same way:
// small JPEGs the host's device makes on demand.
//
// The app can't host events (the website does). If the host role ever passes to this device
// (the host left and this device is next in line), requests are answered as unavailable.
import { Store } from "@/lib/utils/emitter";
import { randomId } from "@/lib/utils/id";
import type { PeerMessenger } from "@/lib/webrtc/messaging";
import { MAX_THUMB_REQUEST, type AppMessage } from "@/lib/webrtc/protocol";
import type { Notice } from "@/lib/webrtc/transfer-manager";
import type { CatalogItem } from "@/types/room";

/** A guest's request for one shared file. */
export interface EventRequest {
  requestId: string;
  at: number;
  /** The host said the file is gone (e.g. it reloaded the page). */
  unavailable: boolean;
}

export interface EventShareDeps {
  selfId: string;
  hostId: () => string | null;
  messenger: PeerMessenger;
  notify: (notice: Notice) => void;
}

export class EventShare {
  /** What the host shares (from the server; same on every device). */
  readonly catalog = new Store<CatalogItem[]>([]);
  /** Previews received from the host, by item id (data URLs). */
  readonly thumbs = new Store<Readonly<Record<string, string>>>({});
  /** Files this device asked for, by item id. */
  readonly requests = new Store<Readonly<Record<string, EventRequest>>>({});

  private readonly thumbsAsked = new Set<string>();
  private readonly requestIds = new Set<string>();

  constructor(private readonly deps: EventShareDeps) {}

  get isHost(): boolean {
    return this.deps.hostId() === this.deps.selfId;
  }

  setCatalog(items: readonly CatalogItem[]): void {
    this.catalog.set([...items]);
  }

  /** Asks the host's device for these files. Returns how many requests went out. */
  async download(itemIds: readonly string[]): Promise<number> {
    const host = this.deps.hostId();
    if (!host || this.isHost) return 0;
    const pending = itemIds.map((itemId) => ({ itemId, requestId: randomId("ev") }));
    for (const { requestId } of pending) this.requestIds.add(requestId);
    this.requests.update((all) => {
      const next = { ...all };
      for (const { itemId, requestId } of pending) next[itemId] = { requestId, at: Date.now(), unavailable: false };
      return next;
    });
    // All at once: they share one connection to the host, opened by the first.
    const results = await Promise.all(
      pending.map(({ itemId, requestId }) => this.deps.messenger.send(host, { kind: "event_get", itemId, requestId })),
    );
    const failed = pending.filter((_, i) => !results[i]);
    if (failed.length > 0) {
      for (const { requestId } of failed) this.requestIds.delete(requestId);
      this.requests.update((all) => {
        const next = { ...all };
        for (const { itemId, requestId } of failed) if (next[itemId]?.requestId === requestId) delete next[itemId];
        return next;
      });
      this.deps.notify({ kind: "warning", message: "Couldn't reach the host. Try again in a moment." });
    }
    return pending.length - failed.length;
  }

  /** Asks the host for previews of these items (each one once). */
  requestThumbs(itemIds: readonly string[]): void {
    const host = this.deps.hostId();
    if (!host || this.isHost) return;
    const wanted = itemIds.filter((id) => !this.thumbsAsked.has(id));
    if (wanted.length === 0) return;
    for (const id of wanted) this.thumbsAsked.add(id);
    for (let i = 0; i < wanted.length; i += MAX_THUMB_REQUEST) {
      const batch = wanted.slice(i, i + MAX_THUMB_REQUEST);
      void this.deps.messenger.send(host, { kind: "event_thumbs", itemIds: batch }).then((ok) => {
        // Not reachable now: allow asking again later.
        if (!ok) for (const id of batch) this.thumbsAsked.delete(id);
      });
    }
  }

  /** For the transfer manager: accept the host's transfers this device asked for. */
  isRequested(senderId: string, batchId: string): boolean {
    return senderId === this.deps.hostId() && this.requestIds.has(batchId);
  }

  /** Handles event messages; returns false for anything else. */
  handle(peerId: string, message: AppMessage): boolean {
    switch (message.kind) {
      case "event_get":
        // This device has no shared files to send.
        if (this.isHost) void this.deps.messenger.send(peerId, { kind: "event_unavailable", itemId: message.itemId });
        return true;
      case "event_thumbs":
        return true;
      case "event_thumb":
        if (peerId === this.deps.hostId()) this.thumbs.update((all) => ({ ...all, [message.itemId]: message.data }));
        return true;
      case "event_unavailable":
        if (peerId === this.deps.hostId()) {
          this.requests.update((all) => {
            const request = all[message.itemId];
            return request ? { ...all, [message.itemId]: { ...request, unavailable: true } } : all;
          });
        }
        return true;
      default:
        return false;
    }
  }
}
