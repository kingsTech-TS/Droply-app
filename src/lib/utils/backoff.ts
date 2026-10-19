export interface BackoffOptions {
  initialMs: number;
  maxMs: number;
  maxAttempts: number;
  /** Random spread as a fraction of the delay, e.g. 0.2 = ±20%. */
  jitter: number;
}

export const SIGNALING_BACKOFF: BackoffOptions = {
  initialMs: 500,
  maxMs: 16_000,
  maxAttempts: 8,
  jitter: 0.2,
};

/** Exponential backoff with jitter. Returns null when attempts are exhausted. */
export class Backoff {
  private attempt = 0;

  constructor(
    private readonly options: BackoffOptions,
    private readonly random: () => number = Math.random,
  ) {}

  get attempts(): number {
    return this.attempt;
  }

  next(): number | null {
    if (this.attempt >= this.options.maxAttempts) return null;
    const base = Math.min(this.options.maxMs, this.options.initialMs * 2 ** this.attempt);
    this.attempt += 1;
    const spread = base * this.options.jitter;
    return Math.round(base - spread + this.random() * spread * 2);
  }

  reset(): void {
    this.attempt = 0;
  }
}
