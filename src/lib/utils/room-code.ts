// Room codes are 6 characters from the backend's alphabet (no O/0/I/1/L).
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

const allowed = new Set(ROOM_CODE_ALPHABET);

/** Uppercases and keeps only allowed characters, so pasted "k7x-9pq" becomes "K7X9PQ". */
export function normalizeRoomCode(input: string): string {
  return Array.from(input.toUpperCase())
    .filter((ch) => allowed.has(ch))
    .join("")
    .slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && Array.from(code).every((ch) => allowed.has(ch));
}
