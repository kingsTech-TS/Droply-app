// Turns RTCPeerConnection.getStats() into honest connection facts. Nothing here is
// estimated: if the browser doesn't report a value, the value is null.
import type { ConnectionPath } from "@/types/signaling";
import type { RTCStatsReport } from "./rtc";

export type ConnectionQuality = "excellent" | "good" | "weak";

export interface LinkStats {
  path: ConnectionPath;
  localCandidateType: string | null;
  remoteCandidateType: string | null;
  rttMs: number | null;
  availableOutgoingBitrate: number | null;
  bytesSent: number | null;
  bytesReceived: number | null;
  /** Not exposed for SCTP data channels by current browsers; kept null rather than guessed. */
  packetsLost: number | null;
  timestamp: number;
}

type StatsEntry = Record<string, unknown> & { id: string; type: string };

const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

function isPrivateAddress(address: unknown): boolean {
  if (typeof address !== "string") return false;
  if (address.endsWith(".local")) return true; // mDNS-obfuscated host candidate
  return PRIVATE_V4.test(address) || /^f[cd][0-9a-f]{2}:/i.test(address) || /^fe80:/i.test(address);
}

function candidateType(entry: StatsEntry | undefined): string | null {
  return typeof entry?.candidateType === "string" ? entry.candidateType : null;
}

/** relay if either side relays; lan if both ends are on the local network; else direct. */
export function classifyPath(local: StatsEntry | undefined, remote: StatsEntry | undefined): ConnectionPath {
  const l = candidateType(local);
  const r = candidateType(remote);
  if (!l || !r) return "unknown";
  if (l === "relay" || r === "relay") return "relay";
  const localLan = l === "host" || (l === "prflx" && isPrivateAddress(local?.address ?? local?.ip));
  const remoteLan = r === "host" || (r === "prflx" && isPrivateAddress(remote?.address ?? remote?.ip));
  return localLan && remoteLan ? "lan" : "direct";
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function parseStats(report: RTCStatsReport, now = Date.now()): LinkStats {
  const entries = new Map<string, StatsEntry>();
  report.forEach((value: unknown) => {
    const entry = value as StatsEntry;
    if (entry && typeof entry.id === "string") entries.set(entry.id, entry);
  });

  let pair: StatsEntry | undefined;
  for (const entry of entries.values()) {
    if (entry.type === "transport" && typeof entry.selectedCandidatePairId === "string") {
      pair = entries.get(entry.selectedCandidatePairId);
      if (pair) break;
    }
  }
  if (!pair) {
    // Firefox marks the pair as `selected`; others: nominated + succeeded.
    for (const entry of entries.values()) {
      if (entry.type !== "candidate-pair") continue;
      if (entry.selected === true || (entry.nominated === true && entry.state === "succeeded")) {
        pair = entry;
        break;
      }
    }
  }

  const local = typeof pair?.localCandidateId === "string" ? entries.get(pair.localCandidateId) : undefined;
  const remote = typeof pair?.remoteCandidateId === "string" ? entries.get(pair.remoteCandidateId) : undefined;
  const rtt = num(pair?.currentRoundTripTime);

  return {
    path: pair ? classifyPath(local, remote) : "unknown",
    localCandidateType: candidateType(local),
    remoteCandidateType: candidateType(remote),
    rttMs: rtt === null ? null : Math.round(rtt * 1000),
    availableOutgoingBitrate: num(pair?.availableOutgoingBitrate),
    bytesSent: num(pair?.bytesSent),
    bytesReceived: num(pair?.bytesReceived),
    packetsLost: null,
    timestamp: now,
  };
}

export function qualityFromStats(rttMs: number | null, stalled: boolean): ConnectionQuality | null {
  if (stalled) return "weak";
  if (rttMs === null) return null;
  if (rttMs < 50) return "excellent";
  if (rttMs < 150) return "good";
  return "weak";
}
