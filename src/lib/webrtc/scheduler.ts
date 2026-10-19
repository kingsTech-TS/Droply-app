// Concurrency rules for outgoing legs. Pure functions, so they are easy to test.

export interface SchedulerLimits {
  /** Legs sending at once across all peers. */
  global: number;
  /** Legs sending at once to one peer. */
  perPeer: number;
}

export function schedulerLimits(mobile: boolean, maxActive = Number.POSITIVE_INFINITY): SchedulerLimits {
  const limits = mobile ? { global: 2, perPeer: 1 } : { global: 4, perPeer: 2 };
  const global = Math.max(1, Math.min(limits.global, maxActive));
  return { global, perPeer: Math.min(limits.perPeer, global) };
}

export interface Candidate {
  key: string;
  peerId: string;
  /** Lower runs first (creation order). */
  order: number;
}

/**
 * Picks which waiting legs may start now, given the legs already running. Oldest first,
 * never more than the global or per-peer limits.
 */
export function pickStartable(
  waiting: readonly Candidate[],
  running: readonly { peerId: string }[],
  limits: SchedulerLimits,
): Candidate[] {
  const perPeer = new Map<string, number>();
  for (const leg of running) perPeer.set(leg.peerId, (perPeer.get(leg.peerId) ?? 0) + 1);
  let total = running.length;
  const out: Candidate[] = [];
  for (const candidate of [...waiting].sort((a, b) => a.order - b.order)) {
    if (total >= limits.global) break;
    const count = perPeer.get(candidate.peerId) ?? 0;
    if (count >= limits.perPeer) continue;
    out.push(candidate);
    perPeer.set(candidate.peerId, count + 1);
    total += 1;
  }
  return out;
}

/** How many more transfers may be created on the server right now. */
export function creationSlots(unfinishedOnServer: number, maxActive: number): number {
  return Math.max(0, maxActive - unfinishedOnServer);
}
