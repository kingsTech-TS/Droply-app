// The open room. On the website a RoomSession lives as long as the room page; in the app it
// survives moving between tabs (Home, Transfers, History, Settings) so transfers keep going,
// and is disposed when the user leaves, the room ends, or another room is opened. Disposing
// (rather than leaving) keeps this device in the room for the server's reconnect window.
import { Store } from "@/lib/utils/emitter";
import { RoomSession } from "./room-session";
import { loadSession } from "./session-store";

export const activeSession = new Store<RoomSession | null>(null);

/** Opens (or returns) the session for a room this device has a stored token for. */
export function openSession(roomId: string): RoomSession | null {
  const current = activeSession.getSnapshot();
  if (current && current.session.roomId === roomId && current.room.getSnapshot().status !== "ended") return current;
  const stored = loadSession(roomId);
  if (!stored) return null;
  current?.dispose();
  const session = new RoomSession(stored, undefined);
  session.start();
  activeSession.set(session);
  return session;
}

/** Stops the session without leaving (the device keeps its place for a few minutes). */
export function closeSession(): void {
  activeSession.getSnapshot()?.dispose();
  activeSession.set(null);
}

/** Leaves the room for good (token revoked). */
export function leaveSession(): void {
  activeSession.getSnapshot()?.leave();
  activeSession.set(null);
}
