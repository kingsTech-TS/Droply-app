import type { IceConfig } from "@/types/room";
import { apiClient, type ApiClient } from "./client";

/** STUN plus short-lived TURN credentials. Long-lived TURN secrets never reach the browser. */
export function getTurnCredentials(token: string, client: ApiClient = apiClient): Promise<IceConfig> {
  return client.request<IceConfig>("POST", "/turn/credentials", { token, retries: 1 });
}
