// Speed and ETA from verified bytes only. Current speed is measured over the last 3 s;
// average speed covers active (not paused) time since this page started the leg.

const WINDOW_MS = 3000;
const MIN_ETA_DATA_MS = 2000;
const HISTORY_INTERVAL_MS = 1000;
/** Seconds of speed history kept for the live graph. */
export const SPEED_HISTORY_LENGTH = 30;

export class SpeedMeter {
  private samples: Array<{ t: number; bytes: number }> = [];
  private activeMs = 0;
  private activeSince: number | null = null;
  private baseBytes: number | null = null;
  private latestBytes = 0;
  private firstDataAt: number | null = null;
  private peakSpeed: number | null = null;
  private historyValues: number[] = [];
  private lastHistoryAt = 0;

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** Marks the leg as actively transferring (counts toward average speed). */
  setActive(active: boolean): void {
    const t = this.now();
    if (active && this.activeSince === null) {
      this.activeSince = t;
    } else if (!active && this.activeSince !== null) {
      this.activeMs += t - this.activeSince;
      this.activeSince = null;
      this.samples = [];
    }
  }

  update(verifiedBytes: number): void {
    const t = this.now();
    this.baseBytes ??= verifiedBytes;
    if (verifiedBytes > this.latestBytes && this.firstDataAt === null && verifiedBytes > this.baseBytes) {
      this.firstDataAt = t;
    }
    this.latestBytes = verifiedBytes;
    this.samples.push({ t, bytes: verifiedBytes });
    while (this.samples.length > 2 && this.samples[0]!.t < t - WINDOW_MS) this.samples.shift();
    const speed = this.current;
    if (speed !== null && t - this.lastHistoryAt >= HISTORY_INTERVAL_MS) {
      this.lastHistoryAt = t;
      this.historyValues = [...this.historyValues, speed].slice(-SPEED_HISTORY_LENGTH);
      // Peak over a full window only, so a single burst of acks can't fake a record.
      const first = this.samples[0];
      if (first && t - first.t >= WINDOW_MS * 0.9) this.peakSpeed = Math.max(this.peakSpeed ?? 0, speed);
    }
  }

  /** Highest current speed measured over a full window, or null. */
  get peak(): number | null {
    return this.peakSpeed;
  }

  /** About one sample per second of the current speed (bytes/s), oldest first. */
  get history(): readonly number[] {
    return this.historyValues;
  }

  /** Seconds spent actively transferring (excludes paused time). */
  get activeSeconds(): number {
    return (this.activeMs + (this.activeSince !== null ? this.now() - this.activeSince : 0)) / 1000;
  }

  /** Bytes per second over the last few seconds, or null without enough data. */
  get current(): number | null {
    if (this.activeSince === null) return null;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last || last.t - first.t < 250) return null;
    return Math.max(0, ((last.bytes - first.bytes) * 1000) / (last.t - first.t));
  }

  get average(): number | null {
    const active = this.activeMs + (this.activeSince !== null ? this.now() - this.activeSince : 0);
    if (active < 500 || this.baseBytes === null) return null;
    const bytes = this.latestBytes - this.baseBytes;
    return bytes > 0 ? (bytes * 1000) / active : null;
  }

  eta(totalBytes: number): number | null {
    const speed = this.current;
    if (speed === null || speed <= 0 || this.firstDataAt === null) return null;
    if (this.now() - this.firstDataAt < MIN_ETA_DATA_MS) return null;
    return Math.max(0, (totalBytes - this.latestBytes) / speed);
  }
}
