import type { DeviceView } from "@/types/device";
import { apiClient, type ApiClient } from "./client";

export function getDevices(roomId: string, token: string, client: ApiClient = apiClient): Promise<DeviceView[]> {
  return client.request<DeviceView[]>("GET", `/rooms/${encodeURIComponent(roomId)}/devices`, {
    token,
    retries: 2,
  });
}

/** Removes a device. A device may remove itself (leave); the host may remove anyone. */
export function leaveRoom(
  roomId: string,
  deviceId: string,
  token: string,
  client: ApiClient = apiClient,
): Promise<void> {
  return client.request<void>(
    "DELETE",
    `/rooms/${encodeURIComponent(roomId)}/devices/${encodeURIComponent(deviceId)}`,
    { token },
  );
}
