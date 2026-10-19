/**
 * The link other devices open to join (encoded in the QR code). The app has no page origin of
 * its own, so this is the backend's `join_url` (built from PUBLIC_FRONTEND_URL), which opens
 * the website — or this app, where universal/app links are configured.
 */
export function joinUrlFor(_roomCode: string, backendJoinUrl: string): string {
  return backendJoinUrl;
}

/** Website origin derived from a backend join URL ("https://droply.app/join/K7X9PQ" → "https://droply.app"). */
export function frontendOrigin(joinUrl: string): string | null {
  const match = /^(https?:\/\/[^/?#]+)/i.exec(joinUrl);
  return match ? match[1]! : null;
}

export type ParsedLink = { kind: "join"; code: string } | { kind: "room-link"; key: string };

/**
 * Parses what a QR code, deep link or pasted text points at: a join link
 * (`https://host/join/CODE`, `droply://join/CODE`), a personal room link
 * (`https://host/r/KEY`, `droply://r/KEY`), or a bare room code.
 */
export function parseDroplyLink(raw: string): ParsedLink | null {
  const text = raw.trim();
  const join = /(?:^|\/)join\/([A-Za-z0-9 -]{4,32})(?:[/?#]|$)/.exec(text);
  if (join) return { kind: "join", code: decodeURIComponent(join[1]!) };
  const link = /(?:^|\/)r\/([A-Za-z0-9_-]{22,128})(?:[/?#]|$)/.exec(text);
  if (link) return { kind: "room-link", key: link[1]! };
  if (/^[A-Za-z0-9 -]{6,12}$/.test(text)) return { kind: "join", code: text };
  return null;
}
