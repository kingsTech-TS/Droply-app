import { env } from "@/config/env";
import { logger } from "@/lib/utils/logger";
import { ApiError, toErrorCode } from "./errors";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface RequestOptions {
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
  /** Retries for network errors, 5xx and 429. Only used for idempotent calls. */
  retries?: number;
}

type Fetch = typeof fetch;

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function toApiError(response: Response): Promise<ApiError> {
  let code: unknown;
  let message = response.statusText || "Request failed";
  let requestId: string | null = null;
  try {
    const data: unknown = await response.json();
    if (typeof data === "object" && data !== null && "error" in data) {
      const error = (data as { error: unknown }).error;
      if (typeof error === "object" && error !== null) {
        const body = error as Record<string, unknown>;
        code = body.code;
        if (typeof body.message === "string") message = body.message;
        if (typeof body.request_id === "string") requestId = body.request_id;
      }
    }
  } catch {
    // Not JSON (e.g. a proxy error page); keep the status-based code.
  }
  return new ApiError(
    response.status,
    toErrorCode(code, response.status),
    message,
    requestId,
    parseRetryAfter(response.headers.get("Retry-After")),
  );
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string = env.apiUrl,
    private readonly fetchImpl: Fetch = (...args) => fetch(...args),
  ) {}

  async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const { body, token, signal, retries = 0 } = options;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;

    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        if (attempt < retries) {
          await sleep(500 * 2 ** attempt, signal);
          continue;
        }
        logger.warn("api", `${method} ${path} network error`, String(error));
        throw new ApiError(0, "NETWORK_ERROR", "Network request failed");
      }

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
      }

      const error = await toApiError(response);
      const retryable = error.status >= 500 || error.status === 429;
      if (retryable && attempt < retries) {
        const waitMs = error.retryAfter !== null ? error.retryAfter * 1000 : 500 * 2 ** attempt;
        if (waitMs <= 10_000) {
          await sleep(waitMs, signal);
          continue;
        }
      }
      logger.warn("api", `${method} ${path} → ${error.status} ${error.code}`, {
        requestId: error.requestId,
      });
      throw error;
    }
  }
}

export const apiClient = new ApiClient();
