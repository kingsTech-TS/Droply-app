// Transfer history, personal records, badges and stats, kept only on this device
// (localStorage). Never uploaded. Clearable from the History page.
import { fileKind, type FileKind } from "@/lib/utils/file-kind";
import { isRecord, LocalStore } from "@/lib/utils/local-store";

export interface HistoryEntry {
  id: string;
  at: number;
  direction: "outgoing" | "incoming";
  fileName: string;
  fileSize: number;
  kind: FileKind;
  peerName: string;
  averageSpeed: number | null;
  peakSpeed: number | null;
  seconds: number;
  /** Devices in the room at the time (for the "Party room" badge). */
  roomSize: number;
}

const MAX_ENTRIES = 1000;

function isEntry(value: unknown): value is HistoryEntry {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.at === "number" &&
    (value.direction === "outgoing" || value.direction === "incoming") &&
    typeof value.fileName === "string" &&
    typeof value.fileSize === "number" &&
    typeof value.peerName === "string" &&
    typeof value.seconds === "number"
  );
}

export const history = new LocalStore<HistoryEntry[]>("droply:history", [], (raw) =>
  Array.isArray(raw) ? raw.filter(isEntry).slice(-MAX_ENTRIES) : null,
);

export interface Records {
  /** Best average speed of one finished file (bytes/s). */
  bestAverage: number | null;
  /** Best peak speed seen during a transfer (bytes/s). */
  bestPeak: number | null;
  /** Largest single file moved (bytes). */
  biggestFile: number;
}

export const records = new LocalStore<Records>(
  "droply:records",
  { bestAverage: null, bestPeak: null, biggestFile: 0 },
  (raw) =>
    isRecord(raw)
      ? {
          bestAverage: typeof raw.bestAverage === "number" ? raw.bestAverage : null,
          bestPeak: typeof raw.bestPeak === "number" ? raw.bestPeak : null,
          biggestFile: typeof raw.biggestFile === "number" ? raw.biggestFile : 0,
        }
      : null,
);

/** Speeds only count as records for files big enough to measure (avoids tiny-file noise). */
const RECORD_MIN_BYTES = 20_000_000;

export interface RecordResult {
  newAverageRecord: boolean;
  newPeakRecord: boolean;
}

export function addToHistory(entry: Omit<HistoryEntry, "id" | "kind"> & { mimeType: string }): RecordResult {
  const { mimeType, ...rest } = entry;
  const full: HistoryEntry = { ...rest, id: `${entry.at}-${Math.random().toString(36).slice(2, 8)}`, kind: fileKind(entry.fileName, mimeType) };
  history.update((list) => [...list, full].slice(-MAX_ENTRIES));
  const current = records.get();
  const measurable = entry.fileSize >= RECORD_MIN_BYTES;
  const newAverageRecord = measurable && entry.averageSpeed !== null && entry.averageSpeed > (current.bestAverage ?? 0);
  const newPeakRecord = measurable && entry.peakSpeed !== null && entry.peakSpeed > (current.bestPeak ?? 0);
  records.set({
    bestAverage: newAverageRecord ? entry.averageSpeed : current.bestAverage,
    bestPeak: newPeakRecord ? entry.peakSpeed : current.bestPeak,
    biggestFile: Math.max(current.biggestFile, entry.fileSize),
  });
  // A first measurable transfer sets the record quietly; beating it is the news.
  return {
    newAverageRecord: newAverageRecord && current.bestAverage !== null,
    newPeakRecord: newPeakRecord && current.bestPeak !== null,
  };
}

export function clearHistory(): void {
  history.set([]);
  records.set({ bestAverage: null, bestPeak: null, biggestFile: 0 });
}

// --- badges ---------------------------------------------------------------------------

export interface Badge {
  id: string;
  emoji: string;
  title: string;
  description: string;
  earned: boolean;
}

const GB = 1_000_000_000;

export function badges(entries: readonly HistoryEntry[], best: Records): Badge[] {
  const total = entries.reduce((sum, e) => sum + e.fileSize, 0);
  const peers = new Set(entries.map((e) => e.peerName));
  const kinds = new Set(entries.map((e) => e.kind));
  const define = (id: string, emoji: string, title: string, description: string, earned: boolean): Badge => ({
    id,
    emoji,
    title,
    description,
    earned,
  });
  return [
    define("first-drop", "🎈", "First drop", "Send or receive your first file", entries.length > 0),
    define("gigabyte-club", "💾", "Gigabyte club", "Move a single file of 1 GB or more", best.biggestFile >= GB),
    define("marathon", "🏃", "Marathon", "Move a single file of 10 GB or more", best.biggestFile >= 10 * GB),
    define("speed-demon", "⚡", "Speed demon", "Reach 100 MB/s", (best.bestPeak ?? 0) >= 100_000_000),
    define("party-room", "🎉", "Party room", "Transfer in a room with 5 or more devices", entries.some((e) => e.roomSize >= 5)),
    define("hundred", "💯", "Century", "Move 100 files", entries.length >= 100),
    define("terabyte", "🚀", "Terabyte", "Move 1 TB in total", total >= 1000 * GB),
    define("social", "🤝", "Social butterfly", "Share with 5 different devices", peers.size >= 5),
    define("collector", "🗂️", "Collector", "Send 5 kinds of files (videos, photos, docs…)", kinds.size >= 5),
  ];
}

// --- stats ("Droply Wrapped") ----------------------------------------------------------

export interface Stats {
  files: number;
  bytes: number;
  sentBytes: number;
  receivedBytes: number;
  devices: number;
  topKind: FileKind | null;
  busiestHour: number | null;
  fastest: number | null;
}

export function stats(entries: readonly HistoryEntry[], since: number = 0): Stats {
  const list = entries.filter((e) => e.at >= since);
  const kindCount = new Map<FileKind, number>();
  const hourCount = new Map<number, number>();
  for (const e of list) {
    kindCount.set(e.kind, (kindCount.get(e.kind) ?? 0) + 1);
    const hour = new Date(e.at).getHours();
    hourCount.set(hour, (hourCount.get(hour) ?? 0) + 1);
  }
  const top = <K>(map: Map<K, number>): K | null =>
    [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const speeds = list.map((e) => e.peakSpeed ?? e.averageSpeed).filter((s): s is number => s !== null);
  return {
    files: list.length,
    bytes: list.reduce((s, e) => s + e.fileSize, 0),
    sentBytes: list.filter((e) => e.direction === "outgoing").reduce((s, e) => s + e.fileSize, 0),
    receivedBytes: list.filter((e) => e.direction === "incoming").reduce((s, e) => s + e.fileSize, 0),
    devices: new Set(list.map((e) => e.peerName)).size,
    topKind: top(kindCount),
    busiestHour: top(hourCount),
    fastest: speeds.length ? Math.max(...speeds) : null,
  };
}
