import type { TransferConfigView } from "@/types/transfer";
import { apiClient, type ApiClient } from "./client";

export function getTransferConfig(client: ApiClient = apiClient): Promise<TransferConfigView> {
  return client.request<TransferConfigView>("GET", "/config/transfer", { retries: 2 });
}
