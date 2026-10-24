// iOS shows the app's Documents folder in the Files app ("On My iPhone › Droply") so received
// files are easy to find in Documents/Droply. App data must not show up there, so on iOS the
// SQLite databases live in Library/Application Support/SQLite instead of expo-sqlite's default
// Documents/SQLite. Databases created before this change are moved over once.
import { Directory, File as FsFile, Paths } from "expo-file-system";
import { Platform } from "react-native";
import { logger } from "@/lib/utils/logger";

let cached: string | null | undefined;

function pathOf(dir: Directory): string {
  return decodeURIComponent(dir.uri.replace(/^file:\/\//, "")).replace(/\/$/, "");
}

/**
 * The private SQLite directory (a plain path, as `openDatabase*` expects), or null to use the
 * default location (Android, where Documents is already private).
 */
export function privateSqliteDirectory(): string | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS !== "ios") return cached;
  try {
    const dir = new Directory(Paths.document.parentDirectory, "Library", "Application Support", "SQLite");
    dir.create({ intermediates: true, idempotent: true });
    cached = pathOf(dir);
  } catch (error) {
    logger.warn("storage", "private database folder unavailable", String(error));
  }
  return cached;
}

/** Moves a database (and its WAL files) out of Documents/SQLite the first time. */
export function migrateDatabase(name: string): void {
  const target = privateSqliteDirectory();
  if (!target) return;
  try {
    const oldDir = new Directory(Paths.document, "SQLite");
    const newDir = new Directory(`file://${target}`);
    if (!oldDir.exists || new FsFile(newDir, name).exists) return;
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = new FsFile(oldDir, name + suffix);
      if (file.exists) file.move(new FsFile(newDir, name + suffix));
    }
    if (oldDir.list().length === 0) oldDir.delete();
  } catch (error) {
    logger.warn("storage", `couldn't move ${name}`, String(error));
  }
}
