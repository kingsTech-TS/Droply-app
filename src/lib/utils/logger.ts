// Detailed logs for development and diagnostics only. Users see friendly copy instead.
import { env } from "@/config/env";

const SECRET_KEYS = new Set(["token", "device_token", "sdp", "candidate", "credential", "username"]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = SECRET_KEYS.has(key) ? "[redacted]" : redact(inner, depth + 1);
  }
  return out;
}

const enabled = env.debug || process.env.NODE_ENV !== "production";

export const logger = {
  debug(scope: string, message: string, data?: unknown): void {
    if (enabled) console.debug(`[${scope}] ${message}`, data === undefined ? "" : redact(data));
  },
  warn(scope: string, message: string, data?: unknown): void {
    if (enabled) console.warn(`[${scope}] ${message}`, data === undefined ? "" : redact(data));
  },
  error(scope: string, message: string, data?: unknown): void {
    console.error(`[${scope}] ${message}`, data === undefined ? "" : redact(data));
  },
};
