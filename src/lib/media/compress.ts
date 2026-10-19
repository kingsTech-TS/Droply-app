// "Send smaller photos": resizes large JPEG/PNG/WebP photos before sending (same thresholds
// as the website). GIFs and anything that isn't a sniffed raster photo are left untouched.
// The original is kept if compression wouldn't make it meaningfully smaller.
import { localFileFromUri, type LocalFile } from "@/lib/files/local-file";
import { sniffMedia } from "./sniff";
import { scaledImage } from "./thumbnail";

const COMPRESSIBLE = new Set(["image/jpeg", "image/png", "image/webp"]);
const MIN_SIZE = 500_000;
const MAX_DIMENSION = 2560;
const QUALITY = 0.85;

export async function compressPhoto(file: LocalFile): Promise<LocalFile> {
  if (file.size < MIN_SIZE) return file;
  const media = await sniffMedia(file);
  if (!media || !COMPRESSIBLE.has(media.mime)) return file;
  const uri = await scaledImage(file, MAX_DIMENSION, QUALITY);
  if (!uri) return file;
  const base = file.name.replace(/\.[^.]+$/, "");
  const smaller = localFileFromUri(uri, `${base}.jpg`, "image/jpeg");
  if (smaller.size === 0 || smaller.size > file.size * 0.9) return file;
  return { ...smaller, lastModified: file.lastModified, relativePath: file.relativePath ?? null };
}

export async function compressPhotos(files: readonly LocalFile[]): Promise<LocalFile[]> {
  const out: LocalFile[] = [];
  for (const file of files) out.push(await compressPhoto(file));
  return out;
}

export function isCompressibleType(type: string): boolean {
  return /^image\/(jpeg|png|webp)$/.test(type);
}
