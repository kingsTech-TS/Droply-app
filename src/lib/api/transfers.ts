import type {
  CheckpointRequest,
  TransferActionRequest,
  TransferCreate,
  TransferView,
} from "@/types/transfer";
import { apiClient, type ApiClient } from "./client";

export type TransferAction =
  | "accept"
  | "reject"
  | "connect"
  | "start"
  | "pause"
  | "resume"
  | "complete"
  | "fail"
  | "retry"
  | "cancel";

export function createTransfer(
  body: TransferCreate,
  token: string,
  client: ApiClient = apiClient,
): Promise<TransferView> {
  return client.request<TransferView>("POST", "/transfers", { body, token });
}

export function getTransfer(
  transferId: string,
  token: string,
  client: ApiClient = apiClient,
): Promise<TransferView> {
  return client.request<TransferView>("GET", `/transfers/${encodeURIComponent(transferId)}`, {
    token,
    retries: 2,
  });
}

export function transferAction(
  transferId: string,
  action: TransferAction,
  token: string,
  body: TransferActionRequest = {},
  client: ApiClient = apiClient,
): Promise<TransferView> {
  return client.request<TransferView>(
    "POST",
    `/transfers/${encodeURIComponent(transferId)}/${action}`,
    { body, token },
  );
}

type ActionFn = (
  transferId: string,
  token: string,
  body?: TransferActionRequest,
  client?: ApiClient,
) => Promise<TransferView>;

const bind =
  (action: TransferAction): ActionFn =>
  (transferId, token, body, client) =>
    transferAction(transferId, action, token, body, client);

export const acceptTransfer = bind("accept");
export const rejectTransfer = bind("reject");
export const connectTransfer = bind("connect");
export const startTransfer = bind("start");
export const pauseTransfer = bind("pause");
export const resumeTransfer = bind("resume");
export const completeTransfer = bind("complete");
export const failTransfer = bind("fail");
export const retryTransfer = bind("retry");
export const cancelTransfer = bind("cancel");

export function checkpointTransfer(
  transferId: string,
  body: CheckpointRequest,
  token: string,
  client: ApiClient = apiClient,
): Promise<TransferView> {
  return client.request<TransferView>(
    "POST",
    `/transfers/${encodeURIComponent(transferId)}/checkpoint`,
    { body, token },
  );
}
