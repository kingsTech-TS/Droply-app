// A short code both people can compare to confirm nobody is in the middle of the
// connection. It is derived from the DTLS certificate fingerprints in both SDPs: each side
// sees the same pair (local + remote), so the codes match unless a third party substituted
// its own certificate (which would change one fingerprint on one side only).
import { sha256Hex } from "@/lib/utils/hash";

const EMOJI = [
  "🐙", "🚀", "🍕", "🌵", "🦊", "🎸", "🌈", "🍉", "🐢", "⚽", "🎲", "🍩", "🦄", "🌻", "🐝", "🍔",
  "🎈", "🐳", "🍓", "🌙", "🦉", "🎧", "🍀", "🐼", "🧊", "🔑", "🍪", "🦋", "🎯", "🐧", "🍋", "🌊",
  "🦁", "🎨", "🍒", "⭐", "🐸", "🎻", "🥑", "🌋", "🐨", "🧩", "🍇", "🔥", "🦖", "🎺", "🍌", "🌍",
  "🐬", "🎮", "🥨", "⚡", "🦀", "📷", "🍄", "🌺", "🐞", "🛸", "🥕", "❄", "🦒", "🎁", "🍍", "🌞",
] as const;

/** Extracts `a=fingerprint:<alg> <hex>` values from an SDP, lower-cased. */
export function fingerprintsOf(sdp: string): string[] {
  const out: string[] = [];
  for (const line of sdp.split(/\r?\n/)) {
    const match = /^a=fingerprint:(\S+)\s+([0-9A-Fa-f:]+)\s*$/.exec(line.trim());
    if (match) out.push(`${match[1]!.toLowerCase()} ${match[2]!.toLowerCase()}`);
  }
  return out;
}

/** Four emoji, identical on both peers for the same pair of certificates. */
export async function securityCode(localSdp: string, remoteSdp: string): Promise<string | null> {
  const local = fingerprintsOf(localSdp);
  const remote = fingerprintsOf(remoteSdp);
  if (local.length === 0 || remote.length === 0) return null;
  const material = [...local, ...remote].sort().join("|");
  const hex = await sha256Hex(new TextEncoder().encode(material));
  const symbols: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    symbols.push(EMOJI[byte % EMOJI.length]!);
  }
  return symbols.join(" ");
}
