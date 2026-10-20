import type { ErrorCode } from "@/types/api";
import { ERROR_CODES } from "@/types/api";

export type ClientErrorCode = ErrorCode | "NETWORK_ERROR" | "UNKNOWN_ERROR";

const KNOWN: ReadonlySet<string> = new Set(ERROR_CODES);

export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
    readonly requestId: string | null = null,
    /** Seconds to wait before retrying, from the Retry-After header. */
    readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function toErrorCode(code: unknown, status: number): ClientErrorCode {
  if (typeof code === "string" && KNOWN.has(code)) return code as ErrorCode;
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "INTERNAL_ERROR";
  return "UNKNOWN_ERROR";
}

/** Friendly copy for each error code. Technical details stay in the developer logs. */
const MESSAGES: Partial<Record<ClientErrorCode, string>> = {
  ROOM_NOT_FOUND: "This room doesn't exist anymore.",
  ROOM_EXPIRED: "This room has expired. Create a new room to continue.",
  ROOM_FULL: "This room is full.",
  ROOM_TIME_UP: "Time's up for this room. Files already on their way will finish, but nothing new can be sent.",
  ROOM_TIME_LOCKED: "The room's time can't be changed again.",
  INVALID_ROOM_CODE: "That room code didn't work. Check it and try again.",
  DEVICE_NOT_FOUND: "That device has left the room.",
  TRANSFER_NOT_FOUND: "This transfer no longer exists.",
  TRANSFER_EXPIRED: "This transfer has expired.",
  TRANSFER_REJECTED: "The transfer was declined.",
  TRANSFER_LIMIT_REACHED: "Too many transfers at once. The rest will start shortly.",
  INVALID_STATE: "That action isn't possible right now.",
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  UNAUTHORIZED: "Your session for this room has ended.",
  FORBIDDEN: "You can't do that in this room.",
  VALIDATION_ERROR: "Something about that request wasn't right.",
  TURN_UNAVAILABLE: "Relay servers are unavailable right now.",
  NETWORK_ERROR: "Can't reach the server. Check your connection.",
  INTERNAL_ERROR: "Something went wrong on our side. Please try again.",
};

export function userMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.code === "RATE_LIMITED" && error.retryAfter) {
      return `Too many attempts. Try again in ${error.retryAfter} s.`;
    }
    return MESSAGES[error.code] ?? "Something went wrong. Please try again.";
  }
  return "Something went wrong. Please try again.";
}
