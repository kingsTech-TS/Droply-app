import type { DeviceInfoIn } from "@/types/device";
import type {
  CatalogItemIn,
  CatalogView,
  NearbyRoom,
  RendezvousSession,
  RoomJoinRequest,
  RoomCreateRequest,
  RoomKind,
  RoomRef,
  RoomSession,
  RoomStatusView,
  RoomSettingsUpdate,
  RoomTheme,
  RoomView,
} from "@/types/room";
import { withClientInfo } from "@/lib/device/client";
import { apiClient, type ApiClient } from "./client";
import { isApiError } from "./errors";

/**
 * Sends `device` with the app kind and install id (anonymous usage counts). A server that
 * predates those fields rejects them (422): the request is sent again without them.
 */
async function withDevice<T>(device: DeviceInfoIn, send: (device: DeviceInfoIn) => Promise<T>): Promise<T> {
  const full = withClientInfo(device);
  try {
    return await send(full);
  } catch (error) {
    if (isApiError(error) && error.status === 422 && (full.client || full.install_id)) return send(device);
    throw error;
  }
}

export function createRoom(
  rawDevice: DeviceInfoIn,
  client: ApiClient = apiClient,
  kind: RoomKind = "standard",
  theme: RoomTheme = "default",
): Promise<RoomSession> {
  return withDevice(rawDevice, (device) => createRoomWith(device, client, kind, theme));
}

function createRoomWith(
  device: DeviceInfoIn,
  client: ApiClient,
  kind: RoomKind,
  theme: RoomTheme,
): Promise<RoomSession> {
  const body: RoomCreateRequest = { device, kind };
  if (theme !== "default") body.theme = theme;
  if (!body.theme) return client.request<RoomSession>("POST", "/rooms", { body });
  // A server that predates themes rejects the field (422): create without it.
  return client.request<RoomSession>("POST", "/rooms", { body }).catch((error: unknown) => {
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
  return withDevice(device, (info) => {
    const body: RoomJoinRequest = hostKey ? { room_code: roomCode, device: info, host_key: hostKey } : { room_code: roomCode, device: info };
    return client.request<RoomSession>("POST", "/rooms/join", { body, token });
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

/** Event rooms: the files the host shares. */
export function getCatalog(roomId: string, token: string, client: ApiClient = apiClient): Promise<CatalogView> {
  return client.request<CatalogView>("GET", `/rooms/${encodeURIComponent(roomId)}/catalog`, { token, retries: 2 });
}

/** Event host only: shares files with everyone (metadata; at most 100 per call). */
export function addToCatalog(roomId: string, items: CatalogItemIn[], token: string, client: ApiClient = apiClient): Promise<CatalogView> {
  return client.request<CatalogView>("POST", `/rooms/${encodeURIComponent(roomId)}/catalog`, { body: { items }, token });
}

/** Event host only: stops sharing a file. */
export function removeFromCatalog(roomId: string, itemId: string, token: string, client: ApiClient = apiClient): Promise<CatalogView> {
  return client.request<CatalogView>("DELETE", `/rooms/${encodeURIComponent(roomId)}/catalog/${encodeURIComponent(itemId)}`, { token });
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
  return withDevice(device, (info) => client.request<RendezvousSession>("POST", "/rendezvous", { body: { key, device: info }, token }));
}
