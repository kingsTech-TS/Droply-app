// "@Name" tags in room chat (website: chat-panel.tsx).
import type { DeviceView } from "@/types/device";

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Devices tagged as "@Name" in `text`. Longer names win, so "@Phone 2" isn't also "@Phone". */
export function findMentions(text: string, devices: readonly Pick<DeviceView, "device_id" | "device_name">[]): string[] {
  let rest = text;
  const found: string[] = [];
  for (const device of [...devices].sort((a, b) => b.device_name.length - a.device_name.length)) {
    const pattern = new RegExp(`@${escapeRegExp(device.device_name)}(?![\\p{L}\\p{N}_])`, "u");
    if (pattern.test(rest)) {
      found.push(device.device_id);
      rest = rest.replace(new RegExp(pattern.source, "gu"), " ");
    }
  }
  return found;
}

/** The "@query" being typed right before the caret, if any. */
export function mentionQuery(value: string, caret: number): { start: number; query: string } | null {
  const match = /(?:^|\s)@([^\s@]{0,32})$/u.exec(value.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[1]!.length - 1, query: match[1]!.toLowerCase() };
}
