// File names come from another device and are untrusted. They are only ever rendered as
// React text and used as a download name; this makes them safe for every OS.

const RESERVED_WINDOWS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
// Control characters, bidi overrides/isolates and characters illegal on Windows.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/g;
const MAX_BYTES = 255;

function truncateUtf8(name: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(name).length <= maxBytes) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : "";
  let base = ext ? name.slice(0, dot) : name;
  const budget = maxBytes - encoder.encode(ext).length;
  while (base && encoder.encode(base).length > budget) {
    base = Array.from(base).slice(0, -1).join("");
  }
  return base + ext;
}

export function sanitizeFileName(raw: string, fallback = "download"): string {
  const lastComponent = raw.replace(/\\/g, "/").split("/").pop() ?? "";
  let name = lastComponent.normalize("NFC").replace(UNSAFE, "_");
  name = name.replace(/\s+/g, " ").trim();
  name = name.replace(/[. ]+$/, "");
  name = name.replace(/^\.+/, "");
  if (!name) return fallback;
  if (RESERVED_WINDOWS.test(name)) name = `_${name}`;
  return truncateUtf8(name, MAX_BYTES) || fallback;
}

const MAX_FOLDER_DEPTH = 16;

/**
 * Cleans a folder path from another device ("photos/2026/../x"), keeping only safe
 * segments. `..`, `.` and empty segments are dropped, so it can never point outside the
 * folder the user picked. Returns null when nothing usable remains.
 */
export function sanitizeFolderPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const segments = raw
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s !== "" && s !== "." && s !== "..")
    .map((s) => sanitizeFileName(s, ""))
    .filter((s) => s !== "")
    .slice(0, MAX_FOLDER_DEPTH);
  return segments.length > 0 ? segments.join("/") : null;
}

/** Returns `name`, or `name (1).ext`, `name (2).ext`... if it is already in `taken`. */
export function dedupeFileName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 1; ; i += 1) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
