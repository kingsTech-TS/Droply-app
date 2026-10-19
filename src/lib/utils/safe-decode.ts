/** decodeURIComponent that never throws (malformed input is returned as-is). */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
