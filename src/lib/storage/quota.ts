// Free space on the device. The app stores incoming files in its own sandbox, so the limit
// is the disk itself (the website's equivalent is the browser's storage quota).
import { Paths } from "expo-file-system";

export interface StorageEstimateResult {
  available: number | null;
  usage: number | null;
}

export async function estimateStorage(): Promise<StorageEstimateResult> {
  try {
    const available = Paths.availableDiskSpace;
    const total = Paths.totalDiskSpace;
    return {
      available: Number.isFinite(available) && available >= 0 ? available : null,
      usage: Number.isFinite(total) && Number.isFinite(available) ? Math.max(0, total - available) : null,
    };
  } catch {
    return { available: null, usage: null };
  }
}

/** Sandbox files are never evicted by the OS, unlike browser storage. Kept for parity. */
export async function requestPersistence(): Promise<boolean> {
  return true;
}
