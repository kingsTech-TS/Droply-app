// Hands a finished file to the user. Received files are untrusted: they keep a sanitized
// name, are shared as application/octet-stream (unless sniffing proved they're a raster
// image or video), and are never executed or rendered by the app.
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import { Directory, File as FsFile } from "expo-file-system";
import { Platform } from "react-native";
import type { LocalFile } from "@/lib/files/local-file";
import { sniffMedia } from "@/lib/media/sniff";
import { logger } from "@/lib/utils/logger";
import { sanitizeFileName } from "@/lib/utils/sanitize-filename";

export type SaveResult = "saved" | "cancelled";

/**
 * "Save": the system share sheet (iOS offers "Save to Files", Android every installed target).
 * Must run from a user action.
 */
export async function saveFile(file: LocalFile, rawName: string): Promise<SaveResult> {
  const name = sanitizeFileName(rawName);
  if (!(await Sharing.isAvailableAsync())) return "cancelled";
  const media = await sniffMedia(file);
  try {
    await Sharing.shareAsync(file.uri, {
      dialogTitle: name,
      mimeType: media?.mime ?? "application/octet-stream",
      UTI: media ? undefined : "public.data",
    });
    return "saved";
  } catch (error) {
    logger.warn("save", "share failed", String(error));
    return "cancelled";
  }
}

/** Whether "Save to Photos" applies: only files whose first bytes are a real image or video. */
export async function canSaveToPhotos(file: LocalFile): Promise<boolean> {
  return (await sniffMedia(file)) !== null;
}

/** Adds a verified image/video to the photo library (asks for permission when first used). */
export async function saveToPhotos(file: LocalFile): Promise<SaveResult> {
  if (!(await canSaveToPhotos(file))) return "cancelled";
  const permission = await MediaLibrary.requestPermissionsAsync(true, ["photo", "video"]);
  if (!permission.granted) return "cancelled";
  try {
    await MediaLibrary.Asset.create(file.uri);
    return "saved";
  } catch (error) {
    logger.warn("save", "save to photos failed", String(error));
    return "cancelled";
  }
}

/** Android only: the system folder picker (Storage Access Framework). */
export const canSaveToFolder = Platform.OS === "android";

export async function pickSaveFolder(): Promise<Directory | null> {
  if (!canSaveToFolder) return null;
  try {
    return await Directory.pickDirectoryAsync();
  } catch {
    return null;
  }
}

/** Copies a file into a folder the user picked (e.g. Downloads), under a sanitized name. */
export async function copyToFolder(file: LocalFile, folder: Directory, rawName: string, folderPath?: string | null): Promise<void> {
  let target = folder;
  for (const part of (folderPath ?? "").split("/").filter(Boolean)) {
    const existing = target.list().find((entry) => entry instanceof Directory && entry.name === part);
    target = existing instanceof Directory ? existing : target.createDirectory(part);
  }
  const destination = target.createFile(sanitizeFileName(rawName), "application/octet-stream");
  await new FsFile(file.uri).copy(destination, { overwrite: true });
}

export async function saveToFolder(file: LocalFile, rawName: string): Promise<SaveResult> {
  const folder = await pickSaveFolder();
  if (!folder) return "cancelled";
  try {
    await copyToFolder(file, folder, rawName);
    return "saved";
  } catch (error) {
    logger.warn("save", "save to folder failed", String(error));
    return "cancelled";
  }
}
