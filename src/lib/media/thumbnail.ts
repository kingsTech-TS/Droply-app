// Small previews. As on the website, a preview is only produced for files whose first bytes
// are a real raster image or video (sniffed, never trusted from the name or MIME type), and
// very large photos are skipped on low-memory devices. Images are shown through expo-image,
// which decodes at the size of the view; videos get one frame via expo-video-thumbnails.
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as VideoThumbnails from "expo-video-thumbnails";
import { memoryBudget } from "@/lib/device/memory";
import type { LocalFile } from "@/lib/files/local-file";
import { imageSize, type ImageSize } from "./image-size";
import { sniffMedia } from "./sniff";

const cache = new Map<string, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();

/** One decode at a time, so at most one full-size bitmap exists. */
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

function fit(size: ImageSize, maxDimension: number): ImageSize {
  const scale = Math.min(1, maxDimension / Math.max(size.width, size.height));
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}

/**
 * Decodes `file` scaled to fit `maxDimension` and re-encodes it as JPEG in the cache.
 * Returns the new file's URI, or null when the photo is too big to decode safely here.
 */
export async function scaledImage(file: LocalFile, maxDimension: number, quality = 0.8): Promise<string | null> {
  const budget = memoryBudget();
  const size = await imageSize(file);
  if (!size) return null;
  if ((size.width * size.height) / 1_000_000 > budget.previewMaxMegapixels) return null;
  const target = fit(size, maxDimension);
  return serial(async () => {
    try {
      const image = await ImageManipulator.manipulate(file.uri).resize(target).renderAsync();
      const result = await image.saveAsync({ compress: quality, format: SaveFormat.JPEG });
      return result.uri;
    } catch {
      return null;
    }
  });
}

/** A URI that can be shown as a preview of `file`, or null if it shouldn't be previewed. */
export function thumbnailUrl(file: LocalFile): Promise<string | null> {
  const key = `${file.uri}|${file.size}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      const media = await sniffMedia(file);
      if (!media) return null;
      const budget = memoryBudget();
      if (media.kind === "image") {
        if (budget.previewMaxMegapixels === 0) return null;
        const size = await imageSize(file);
        if (size && (size.width * size.height) / 1_000_000 > budget.previewMaxMegapixels) return null;
        return file.uri;
      }
      if (!budget.videoThumbnails && budget.previewMaxMegapixels === 0) return null;
      return serial(async () => {
        try {
          const thumb = await VideoThumbnails.getThumbnailAsync(file.uri, { time: 500, quality: 0.6 });
          return thumb.uri;
        } catch {
          return null;
        }
      });
    })();
    cache.set(key, pending);
  }
  return pending;
}
