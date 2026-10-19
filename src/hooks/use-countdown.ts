
import { useSyncExternalStore } from "react";

// One shared 1 s clock for every countdown on the page.
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => now;
const getServerSnapshot = () => null;

/** Milliseconds until `target` (ms since epoch), updated every second. Null if unknown. */
export function useCountdown(target: number | null): number | null {
  const current = useSyncExternalStore<number | null>(subscribe, getSnapshot, getServerSnapshot);
  if (target === null || current === null) return null;
  return Math.max(0, target - current);
}
