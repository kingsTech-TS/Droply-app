// A typed value persisted on the device (the SQLite key-value store that replaces the
// website's localStorage) that React can subscribe to. Reads and writes never throw: on a
// storage error the value lives only in memory.
import { localKv, type KeyValueStore } from "@/lib/platform/kv";

export class LocalStore<T> {
  private cache: T | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly key: string,
    private readonly fallback: T,
    private readonly validate: (raw: unknown) => T | null,
    private readonly storage: KeyValueStore = localKv,
  ) {}

  get = (): T => {
    if (this.cache !== undefined) return this.cache;
    let value = this.fallback;
    try {
      const raw = this.storage.getItem(this.key);
      if (raw !== null) value = this.validate(JSON.parse(raw)) ?? this.fallback;
    } catch {
      // keep the fallback
    }
    this.cache = value;
    return value;
  };

  /** Server rendering and hydration use the fallback. */
  getServer = (): T => this.fallback;

  set(value: T): void {
    this.cache = value;
    try {
      this.storage.setItem(this.key, JSON.stringify(value));
    } catch {
      // memory only
    }
    this.emit();
  }

  update(fn: (current: T) => T): void {
    this.set(fn(this.get()));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
