// Picking files to send (the website's file input, drop zone and folder selection).
//
// - Files: the system document picker, any type, several at once. `copyToCacheDirectory:
//   false` so a 10 GB video isn't duplicated before sending; when the picker can only hand
//   back a copy, the OS makes it.
// - Photos & videos: the photo library picker (originals, not re-encoded).
// - Folder (Android only): the Storage Access Framework folder picker; the folder structure is
//   kept as `relativePath`, like the browser's webkitRelativePath. iOS can't pick folders.
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Directory, File as FsFile } from "expo-file-system";
import { Platform } from "react-native";
import { logger } from "@/lib/utils/logger";
import { localFile, type LocalFile } from "./local-file";

/** Large folders are capped so a mis-tap on "Internal storage" doesn't freeze the app. */
const MAX_FOLDER_FILES = 5_000;

export async function pickDocuments(): Promise<LocalFile[]> {
  const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: false, type: "*/*" });
  if (result.canceled) return [];
  return result.assets.map((asset) =>
    localFile({
      uri: asset.uri,
      name: asset.name,
      size: asset.size ?? sizeOf(asset.uri),
      type: asset.mimeType,
      lastModified: asset.lastModified,
    }),
  );
}

export async function pickMedia(): Promise<LocalFile[]> {
  const permission = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) await ImagePicker.requestMediaLibraryPermissionsAsync();
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsMultipleSelection: true,
    selectionLimit: 0,
    quality: 1,
    exif: false,
    base64: false,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
  });
  if (result.canceled) return [];
  return result.assets.map((asset, index) =>
    localFile({
      uri: asset.uri,
      name: asset.fileName || fallbackName(asset.uri, asset.type === "video" ? "video" : "photo", index),
      size: asset.fileSize ?? sizeOf(asset.uri),
      type: asset.mimeType,
    }),
  );
}

export const canPickFolder = Platform.OS === "android";

export async function pickFolder(): Promise<LocalFile[]> {
  if (!canPickFolder) return [];
  let root: Directory;
  try {
    root = await Directory.pickDirectoryAsync();
  } catch {
    return [];
  }
  const out: LocalFile[] = [];
  const walk = (dir: Directory, path: string) => {
    for (const entry of dir.list()) {
      if (out.length >= MAX_FOLDER_FILES) return;
      if (entry instanceof Directory) {
        walk(entry, path ? `${path}/${entry.name}` : entry.name);
      } else if (entry instanceof FsFile) {
        out.push(
          localFile({
            uri: entry.uri,
            name: entry.name,
            size: entry.size ?? 0,
            type: entry.type,
            lastModified: entry.modificationTime ?? entry.lastModified ?? null,
            relativePath: path || null,
          }),
        );
      }
    }
  };
  try {
    walk(root, root.name);
  } catch (error) {
    logger.warn("pick", "reading the folder failed", String(error));
  }
  return out;
}

function sizeOf(uri: string): number {
  try {
    return new FsFile(uri).size ?? 0;
  } catch {
    return 0;
  }
}

function fallbackName(uri: string, kind: string, index: number): string {
  const last = uri.split(/[\\/]/).pop();
  return last && last.includes(".") ? decodeURIComponent(last) : `${kind}-${index + 1}`;
}
