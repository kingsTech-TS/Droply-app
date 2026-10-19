// EXPO_PUBLIC_* values are inlined at build time, so each one must be read with a literal
// `process.env.EXPO_PUBLIC_...` expression. Same settings as the website's NEXT_PUBLIC_* ones.
//
// A phone can't reach `localhost` on your computer: in development, use the computer's LAN
// address (e.g. http://192.168.1.20:8000/api/v1) and run uvicorn with --host 0.0.0.0.

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function flag(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const apiUrl = process.env.EXPO_PUBLIC_API_URL;
const wsUrl = process.env.EXPO_PUBLIC_WS_URL;

export const env = {
  apiUrl: stripTrailingSlash(apiUrl || "http://localhost:8000/api/v1"),
  wsUrl: stripTrailingSlash(wsUrl || "ws://localhost:8000/ws/v1"),
  /** The website's origin, for personal room links (`<web>/r/<key>`). Falls back to the join_url origin. */
  webUrl: process.env.EXPO_PUBLIC_WEB_URL ? stripTrailingSlash(process.env.EXPO_PUBLIC_WEB_URL) : null,
  /** False when the API/WS URLs were not configured for this build (Settings → Diagnostics shows it). */
  configured: Boolean(apiUrl && wsUrl),
  debug: flag(process.env.EXPO_PUBLIC_DEBUG),
  benchmarkEnabled: flag(process.env.EXPO_PUBLIC_ENABLE_BENCHMARK),
  // The backend refuses more than 20 unfinished transfers per device.
  maxActiveTransfers: Math.min(positiveInt(process.env.EXPO_PUBLIC_MAX_ACTIVE_TRANSFERS, 16), 20),
  /**
   * Sent as the WebSocket `Origin` header. The backend checks it against WS_ALLOWED_ORIGINS,
   * so this value must be on that list (see README → Backend configuration).
   */
  wsOrigin: process.env.EXPO_PUBLIC_WS_ORIGIN || "droply-app://mobile",
} as const;
