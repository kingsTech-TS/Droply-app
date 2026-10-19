// Display-only file categories. The MIME type and extension come from the other device and
// are never trusted for anything but choosing an icon.

export type FileKind = "video" | "image" | "audio" | "archive" | "pdf" | "document" | "spreadsheet" | "presentation" | "code" | "other";

const BY_EXTENSION: Record<string, FileKind> = {
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive", tgz: "archive", bz2: "archive", xz: "archive",
  pdf: "pdf",
  doc: "document", docx: "document", odt: "document", rtf: "document", txt: "document", md: "document", pages: "document",
  xls: "spreadsheet", xlsx: "spreadsheet", ods: "spreadsheet", csv: "spreadsheet", numbers: "spreadsheet",
  ppt: "presentation", pptx: "presentation", odp: "presentation", key: "presentation",
  js: "code", ts: "code", tsx: "code", py: "code", json: "code", html: "code", css: "code", java: "code", c: "code", cpp: "code", go: "code", rs: "code",
};

export function fileKind(name: string, mimeType: string): FileKind {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  const known = BY_EXTENSION[ext];
  if (known) return known;
  if (/^(mp4|mov|mkv|webm|avi|m4v)$/.test(ext)) return "video";
  if (/^(jpe?g|png|gif|webp|heic|heif|bmp|svg|tiff?)$/.test(ext)) return "image";
  if (/^(mp3|wav|flac|aac|m4a|ogg|opus)$/.test(ext)) return "audio";
  return "other";
}
