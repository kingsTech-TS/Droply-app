
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { EventRequest } from "@/lib/session/event-share";
import type { InboxMessage, PairRequest, RoomSession, RoomSnapshot } from "@/lib/session/room-session";
import type { CatalogItem } from "@/types/room";
import type { LinkInfo } from "@/lib/webrtc/peer-connection";
import type { TransfersSnapshot } from "@/lib/webrtc/transfer-manager";

const RoomSessionContext = createContext<RoomSession | null>(null);

export function RoomSessionProvider({ session, children }: { session: RoomSession; children: ReactNode }) {
  return <RoomSessionContext.Provider value={session}>{children}</RoomSessionContext.Provider>;
}

export function useRoomSession(): RoomSession {
  const session = useContext(RoomSessionContext);
  if (!session) throw new Error("useRoomSession must be used inside RoomSessionProvider");
  return session;
}

/** Room, devices and connection status. */
export function useRoom(): RoomSnapshot {
  const { room } = useRoomSession();
  return useSyncExternalStore(room.subscribe, room.getSnapshot, room.getSnapshot);
}

/** Transfers and incoming requests (progress updates at most 5 times a second). */
export function useTransfers(): TransfersSnapshot {
  const { transfers } = useRoomSession();
  const store = transfers.store;
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Public WebRTC state of every peer link. */
export function usePeerLinks(): Readonly<Record<string, LinkInfo>> {
  const { peers } = useRoomSession();
  const store = peers.links;
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Text drops and chat messages for this room (in memory only). */
export function useInbox(): InboxMessage[] {
  const { inbox } = useRoomSession();
  return useSyncExternalStore(inbox.subscribe, inbox.getSnapshot, inbox.getSnapshot);
}

/** Event rooms: the host's shared files. */
export function useEventCatalog(): CatalogItem[] {
  const { event } = useRoomSession();
  return useSyncExternalStore(event.catalog.subscribe, event.catalog.getSnapshot, event.catalog.getSnapshot);
}

/** Event guests: previews received from the host (data URLs by item id). */
export function useEventThumbs(): Readonly<Record<string, string>> {
  const { event } = useRoomSession();
  return useSyncExternalStore(event.thumbs.subscribe, event.thumbs.getSnapshot, event.thumbs.getSnapshot);
}

/** Event guests: the files this device asked for. */
export function useEventRequests(): Readonly<Record<string, EventRequest>> {
  const { event } = useRoomSession();
  return useSyncExternalStore(event.requests.subscribe, event.requests.getSnapshot, event.requests.getSnapshot);
}

export function useUnreadChat(): number {
  const { unreadChat } = useRoomSession();
  return useSyncExternalStore(unreadChat.subscribe, unreadChat.getSnapshot, unreadChat.getSnapshot);
}

export function usePairRequests(): PairRequest[] {
  const { pairRequests } = useRoomSession();
  return useSyncExternalStore(pairRequests.subscribe, pairRequests.getSnapshot, pairRequests.getSnapshot);
}
