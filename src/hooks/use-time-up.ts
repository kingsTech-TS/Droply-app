
import { useEffect, useState } from "react";

/**
 * Whether a timed room's time has run out: as soon as the clock passes `expiresAt` (before
 * the server's sweep says so), or when the server reports the room is wrapping up. Adding
 * time moves `expiresAt`, which resets it.
 */
export function useTimeUp(expiresAt: number | null, timed: boolean, wrappingUp: boolean): boolean {
  const [passed, setPassed] = useState<number | null>(null);
  useEffect(() => {
    if (!timed || expiresAt === null) return;
    const timer = setTimeout(() => setPassed(expiresAt), Math.min(Math.max(0, expiresAt - Date.now()), 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [expiresAt, timed]);
  return wrappingUp || (timed && expiresAt !== null && passed === expiresAt);
}
