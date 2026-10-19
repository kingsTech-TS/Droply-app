// Files (and text) picked before a room exists: from Home or from another app's share sheet.
// They are carried to the room screen in memory and never serialized or uploaded.
import type { LocalFile } from "@/lib/files/local-file";

let pending: LocalFile[] = [];
let pendingText: string | null = null;

export function setPendingFiles(files: LocalFile[]): void {
  pending = files;
}

export function takePendingFiles(): LocalFile[] {
  const files = pending;
  pending = [];
  return files;
}

export function setPendingText(text: string | null): void {
  pendingText = text && text.trim() ? text : null;
}

export function takePendingText(): string | null {
  const text = pendingText;
  pendingText = null;
  return text;
}
