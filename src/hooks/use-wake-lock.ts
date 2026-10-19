import { useEffect } from "react";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

const TAG = "droply-transfer";

/**
 * Keeps the screen awake while `active`: the OS suspends apps in the background, which stops
 * WebRTC (same reason the website holds a Screen Wake Lock).
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    void activateKeepAwakeAsync(TAG).catch(() => undefined);
    return () => {
      void deactivateKeepAwake(TAG).catch(() => undefined);
    };
  }, [active]);
}
