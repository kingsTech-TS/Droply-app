// Builds the RTCConfiguration from the backend: STUN servers from room_state plus
// short-lived TURN credentials from POST /turn/credentials. Nothing is hard-coded.
import { getTurnCredentials } from "@/lib/api/turn";
import { isApiError } from "@/lib/api/errors";
import { logger } from "@/lib/utils/logger";
import type { IceConfig, IceServer } from "@/types/room";
import type { RTCConfiguration, RTCIceServer } from "./rtc";

const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const FAILURE_BACKOFF_MS = 60 * 1000;

export function toRtcIceServers(servers: readonly IceServer[]): RTCIceServer[] {
  return servers
    .filter((s) => s.urls.length > 0)
    .map((s) => {
      const server: RTCIceServer = { urls: s.urls };
      if (s.username) server.username = s.username;
      if (s.credential) server.credential = s.credential;
      return server;
    });
}

export class IceServerProvider {
  private turn: IceConfig | null = null;
  private turnExpiresAt = 0;
  private lastFailureAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private stun: IceServer[],
    private readonly token: string,
    private readonly fetchTurn: (token: string) => Promise<IceConfig> = getTurnCredentials,
  ) {}

  setStun(servers: IceServer[]): void {
    this.stun = servers;
  }

  /** True once TURN relay servers are known to be configured. */
  get hasTurn(): boolean {
    return (this.turn?.ice_servers ?? []).some((s) => s.urls.some((u) => /^turns?:/i.test(u)));
  }

  async getConfiguration(): Promise<RTCConfiguration> {
    await this.refreshTurn();
    const merged = [...this.stun, ...(this.turn?.ice_servers ?? [])];
    // Deduplicate identical STUN entries (the TURN response usually repeats them).
    const seen = new Set<string>();
    const servers = merged.filter((s) => {
      const key = `${s.urls.join(",")}|${s.username ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { iceServers: toRtcIceServers(servers), iceCandidatePoolSize: 2 };
  }

  private async refreshTurn(): Promise<void> {
    const now = Date.now();
    if (this.turn && now < this.turnExpiresAt - REFRESH_MARGIN_MS) return;
    if (now - this.lastFailureAt < FAILURE_BACKOFF_MS) return;
    this.inflight ??= (async () => {
      try {
        const config = await this.fetchTurn(this.token);
        this.turn = config;
        this.turnExpiresAt = config.expires_at
          ? Date.parse(config.expires_at)
          : now + (config.ttl_seconds ?? 3600) * 1000;
      } catch (error) {
        this.lastFailureAt = Date.now();
        // TURN_UNAVAILABLE or a network error: continue with STUN only.
        logger.warn("ice", "TURN credentials unavailable", isApiError(error) ? error.code : String(error));
      } finally {
        this.inflight = null;
      }
    })();
    await this.inflight;
  }
}
