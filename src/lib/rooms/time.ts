// Timed rooms: whether the host can still add time (website: room-time.tsx).
import { ROOM_MAX_MINUTES } from "@/types/room";

export interface RoomTimeInfo {
  createdAt: number | null;
  durationSeconds: number | null;
  timeExtended: boolean;
}

/** Why the host can't add time, or null if they can. */
export function addTimeBlocked({ durationSeconds, timeExtended }: RoomTimeInfo): string | null {
  if (durationSeconds === null) return "This room has no time limit.";
  if (timeExtended) return "You already changed the time once.";
  if (durationSeconds >= ROOM_MAX_MINUTES * 60) return `The room already has the maximum ${ROOM_MAX_MINUTES} minutes.`;
  return null;
}
