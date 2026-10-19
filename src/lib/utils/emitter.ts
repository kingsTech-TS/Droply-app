// Small typed event emitter and external store used by the services, so React can
// subscribe with useSyncExternalStore without the services importing React.

export type Listener<T> = (value: T) => void;

export class Emitter<Events extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => set.delete(listener as Listener<never>);
  }

  emit<K extends keyof Events>(event: K, value: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) (listener as Listener<Events[K]>)(value);
  }

  clear(): void {
    this.listeners.clear();
  }
}

/** Holds an immutable snapshot; `set` replaces it and notifies subscribers. */
export class Store<T> {
  private readonly listeners = new Set<() => void>();

  constructor(private value: T) {}

  getSnapshot = (): T => this.value;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const listener of [...this.listeners]) listener();
  }

  update(fn: (current: T) => T): void {
    this.set(fn(this.value));
  }
}
