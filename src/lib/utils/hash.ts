// SHA-256 helpers on expo-crypto (native). Files are verified per chunk and then with a root
// digest over the ordered list of chunk digests — the same scheme as the website, so a phone
// and a browser compute identical digests.
import * as Crypto from "expo-crypto";

export function hasWebCrypto(): boolean {
  return typeof Crypto.digest === "function";
}

export function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(data: ArrayBuffer | ArrayBufferView): Promise<string> {
  const view = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  return toHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, view));
}

/** SHA-256 over the concatenated chunk digests (hex, in chunk order). */
export async function rootDigest(chunkDigests: readonly string[]): Promise<string> {
  return sha256Hex(new TextEncoder().encode(chunkDigests.join("")));
}

/** Fills `bytes` with cryptographically secure random values. */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  Crypto.getRandomValues(bytes);
  return bytes;
}
