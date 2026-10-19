// Mirrors app/core/exceptions.py in the backend.

export const ERROR_CODES = [
  "ROOM_NOT_FOUND",
  "ROOM_EXPIRED",
  "ROOM_FULL",
  "INVALID_ROOM_CODE",
  "DEVICE_NOT_FOUND",
  "TRANSFER_NOT_FOUND",
  "TRANSFER_EXPIRED",
  "TRANSFER_REJECTED",
  "TRANSFER_LIMIT_REACHED",
  "INVALID_STATE",
  "RATE_LIMITED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "VALIDATION_ERROR",
  "INVALID_MESSAGE",
  "ORIGIN_NOT_ALLOWED",
  "PAYLOAD_TOO_LARGE",
  "TARGET_NOT_IN_ROOM",
  "TARGET_NOT_CONNECTED",
  "TURN_UNAVAILABLE",
  "CLOUD_FALLBACK_DISABLED",
  "STORAGE_ERROR",
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "CONFLICT",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorBody {
  code: string;
  message: string;
  request_id: string | null;
  details?: unknown;
}

export interface ErrorResponse {
  success: false;
  error: ErrorBody;
}
