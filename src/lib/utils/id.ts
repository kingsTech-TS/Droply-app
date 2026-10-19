import { randomBytes } from "./hash";

export function randomId(prefix = ""): string {
  const bytes = randomBytes(9);
  let out = "";
  for (const byte of bytes) out += byte.toString(36).padStart(2, "0");
  return prefix + out;
}
