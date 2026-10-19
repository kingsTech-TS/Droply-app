import type { DeviceInfoIn } from "@/types/device";
import type {
  NearbyRoom,
  RendezvousSession,
  RoomJoinRequest,
  RoomKind,
  RoomRef,
  RoomSession,
  RoomStatusView,
  RoomSettingsUpdate,
  RoomTheme,
  RoomView,
} from "@/types/room";
import { apiClient, type ApiClient } from "./client";
import { isApiError } from "./errors";

export function createRoom(
  device: DeviceInfoIn,
  client: ApiClient = apiClient,
  kind: RoomKind = "standard",
  theme: RoomTheme = "default",
): Promise<RoomSession> {
  if (theme === "default") return client.request<RoomSession>("POST", "/rooms", { body: { device, kind } });
  // A server that predates themes on create rejects the field (422): create without it.
  return client
    .request<RoomSession>("POST", "/rooms", { body: { device, kind, theme } })
    .catch((error: unknown) => {
      if (isApiError(error) && error.status === 422) {
        return client.request<RoomSession>("POST", "/rooms", { body: { device, kind } });
      }
      throw error;
    });
}

/**
 * Joins by code. Sending a still-valid token for the same room returns the same device;
 * the creator's `hostKey` makes this device host again.
 */
export function joinRoom(
  roomCode: string,
  device: DeviceInfoIn,
  token: string | null = null,
  client: ApiClient = apiClient,
  hostKey: string | null = null,
): Promise<RoomSession> {
  const body: RoomJoinRequest = hostKey ? { room_code: roomCode, device, host_key: hostKey } : { room_code: roomCode, device };
  return client.request<RoomSession>("POST", "/rooms/join", {
    body,
    token,
  });
}

export function getRoom(roomId: string, token: string, client: ApiClient = apiClient): Promise<RoomView> {
  return client.request<RoomView>("GET", `/rooms/${encodeURIComponent(roomId)}`, {
    token,
    retries: 2,
  });
}

/** Host only: ends the room for everyone. */
export function closeRoom(roomId: string, token: string, client: ApiClient = apiClient): Promise<void> {
  return client.request<void>("DELETE", `/rooms/${encodeURIComponent(roomId)}`, { token });
}

/** Host only: theme and nearby discoverability. Every device receives `room_updated`. */
export function updateRoomSettings(
  roomId: string,
  settings: RoomSettingsUpdate,
  token: string,
  client: ApiClient = apiClient,
): Promise<RoomView> {
  return client.request<RoomView>("PATCH", `/rooms/${encodeURIComponent(roomId)}`, {
    body: settings,
    token,
  });
}

/** Which of these rooms are still open (needs each room's id and code). */
export function getRoomStatus(rooms: readonly RoomRef[], client: ApiClient = apiClient): Promise<RoomStatusView[]> {
  return client.request<RoomStatusView[]>("POST", "/rooms/status", { body: { rooms } });
}

/** Discoverable rooms created from this device's network (same public IP). */
export function getNearbyRooms(client: ApiClient = apiClient): Promise<NearbyRoom[]> {
  return client.request<NearbyRoom[]>("GET", "/rooms/nearby");
}

/**
 * Joins the room shared by everyone holding `key` (paired devices, personal room links),
 * opening one if there is none. No room code needed.
 */
export function rendezvous(
  key: string,
  device: DeviceInfoIn,
  token: string | null = null,
  client: ApiClient = apiClient,
): Promise<RendezvousSession> {
  return client.request<RendezvousSession>("POST", "/rendezvous", { body: { key, device }, token });
}
