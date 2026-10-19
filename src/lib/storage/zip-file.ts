// Writes a .zip of local files into the app cache (for "Save all as .zip"), streaming each
// file through in bounded chunks. The archive format lives in zip.ts.
import { File as FsFile, FileMode, Paths } from "expo-file-system";
import { FileReader, localFileFromUri, type LocalFile } from "@/lib/files/local-file";
import { buildZip, type ZipEntry, type ZipOutput, type ZipSource } from "./zip";

function sourceFor(file: LocalFile): ZipSource {
  const reader = new FileReader(file.uri, 1_000);
  return { size: file.size, read: (start, end) => reader.read(start, end) };
}

export async function writeZipFile(
  files: ReadonlyArray<{ path: string; file: LocalFile }>,
  name: string,
  onProgress?: (done: number, total: number) => void,
): Promise<LocalFile> {
  const target = new FsFile(Paths.cache, name);
  if (target.exists) target.delete();
  target.create();
  const handle = target.open(FileMode.WriteOnly);
  const output: ZipOutput = { write: (bytes) => handle.writeBytes(bytes) };
  const entries: ZipEntry[] = files.map((f) => ({ path: f.path, file: sourceFor(f.file), lastModified: f.file.lastModified }));
  try {
    await buildZip(entries, output, onProgress);
  } finally {
    handle.close();
  }
  return localFileFromUri(target.uri, name, "application/zip");
}
