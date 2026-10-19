import { useSyncExternalStore } from "react";
import type { LocalStore } from "@/lib/utils/local-store";

/** Subscribes to a LocalStore (a typed value persisted on the device). */
export function useLocalStore<T>(store: LocalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
