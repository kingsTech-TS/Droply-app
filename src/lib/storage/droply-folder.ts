// Received files save themselves into a "Droply" folder, without a Save button.
//
// - iOS: finished files already land in Documents/Droply (see sandbox-sink), which the Files app
//   shows as "On My iPhone › Droply › Droply" (UIFileSharingEnabled). Nothing to ask.
// - Android: apps can only write to shared storage in a folder the user allowed once (Storage
//   Access Framework; the permission is kept across restarts). We ask once, opening at Download,
//   create "Droply" inside, and copy each finished file there.
import { Directory, File as FsFile } from "expo-file-system";
import { Platform } from "react-native";
import type { LocalFile } from "@/lib/files/local-file";
import { localKv } from "@/lib/platform/kv";
import { Store } from "@/lib/utils/emitter";
import { logger } from "@/lib/utils/logger";
import { dedupeFileName, sanitizeFileName, sanitizeFolderPath } from "@/lib/utils/sanitize-filename";
import { RECEIVED_DIR } from "./sinks/sandbox-sink";

export const DROPLY_FOLDER_NAME = "Droply";
const FOLDER_KEY = "droply:save-folder";
/** Android's Download folder, where the picker opens. */
const DOWNLOAD_TREE = "content://com.android.externalstorage.documents/tree/primary%3ADownload";
/** The app's sandbox copy is removed this long after it was copied (previews keep working). */
const SOURCE_GRACE_MS = 120_000;

export type DroplyFolderStatus = "ready" | "unset";

export const droplyFolder = new Store<{ status: DroplyFolderStatus; label: string }>({
  status: Platform.OS === "ios" ? "ready" : "unset",
  label: Platform.OS === "ios" ? "Files › On My iPhone › Droply" : "",
});

function storedParent(): Directory | null {
  try {
    const uri = localKv.getItem(FOLDER_KEY);
    if (!uri) return null;
    const dir = new Directory(uri);
    return dir.exists ? dir : null;
  } catch {
    return null;
  }
}

function droplyIn(parent: Directory): Directory {
  if (parent.name === DROPLY_FOLDER_NAME) return parent;
  const existing = parent.list().find((entry) => entry instanceof Directory && entry.name === DROPLY_FOLDER_NAME);
  return existing instanceof Directory ? existing : parent.createDirectory(DROPLY_FOLDER_NAME);
}

function labelFor(parent: Directory): string {
  return parent.name === DROPLY_FOLDER_NAME ? DROPLY_FOLDER_NAME : `${parent.name}/${DROPLY_FOLDER_NAME}`;
}

/** Re-checks the Android folder (it may have been deleted, or access revoked). */
export function refreshDroplyFolder(): DroplyFolderStatus {
  if (Platform.OS !== "android") return "ready";
  const parent = storedParent();
  droplyFolder.set(parent ? { status: "ready", label: labelFor(parent) } : { status: "unset", label: "" });
  return parent ? "ready" : "unset";
}

/** Android: asks once where the Droply folder goes (opens at Download). From a tap only. */
export async function chooseDroplyFolder(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  let parent: Directory;
  try {
    parent = await Directory.pickDirectoryAsync(DOWNLOAD_TREE);
  } catch {
    return false; // cancelled
  }
  try {
    droplyIn(parent);
  } catch (error) {
    logger.warn("save", "couldn't create the Droply folder", String(error));
    return false;
  }
  localKv.setItem(FOLDER_KEY, parent.uri);
  droplyFolder.set({ status: "ready", label: labelFor(parent) });
  return true;
}

/** Copies into `folder` (keeping a sent folder's structure) under a name nothing else uses. */
export async function copyIntoFolder(file: LocalFile, folder: Directory, rawName: string, folderPath?: string | null): Promise<void> {
  let target = folder;
  for (const part of (sanitizeFolderPath(folderPath ?? null) ?? "").split("/").filter(Boolean)) {
    const existing = target.list().find((entry) => entry instanceof Directory && entry.name === part);
    target = existing instanceof Directory ? existing : target.createDirectory(part);
  }
  const taken = new Set(target.list().map((entry) => entry.name));
  const name = dedupeFileName(sanitizeFileName(rawName), taken);
  const destination = target.createFile(name, "application/octet-stream");
  await new FsFile(file.uri).copy(destination, { overwrite: true });
}

/**
 * Saves a finished file into the Droply folder. Returns false when that isn't possible yet
 * (Android before the folder was chosen); the Save button stays in that case.
 */
export async function saveToDroplyFolder(file: LocalFile, rawName: string, folderPath: string | null): Promise<boolean> {
  if (Platform.OS === "ios") {
    // Already there: finished files are moved into Documents/Droply.
    return file.uri.includes(`/${RECEIVED_DIR}/`);
  }
  const parent = storedParent();
  if (!parent) {
    droplyFolder.set({ status: "unset", label: "" });
    return false;
  }
  await copyIntoFolder(file, droplyIn(parent), rawName, folderPath);
  // The app's own copy isn't needed once the file is in the Droply folder.
  setTimeout(() => {
    try {
      const source = new FsFile(file.uri);
      if (source.exists) source.delete();
    } catch {
      // already gone
    }
  }, SOURCE_GRACE_MS);
  return true;
}
