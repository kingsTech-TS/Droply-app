import { useEffect } from "react";
import { applyRoomTheme } from "@/lib/fun/themes";
import type { RoomTheme } from "@/types/room";

/** Themes the whole app while mounted (headers, sheets and toasts included). */
export function useRoomTheme(theme: RoomTheme | null): void {
  useEffect(() => {
    applyRoomTheme(theme);
    return () => applyRoomTheme(null);
  }, [theme]);
}
