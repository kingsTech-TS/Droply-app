// Reads an image's pixel size from its header, without decoding it. Used to decide whether
// a photo is safe to decode for a preview or a resize on a phone (a 50 MP photo needs about
// 200 MB once decoded).
import { readRange, type LocalFile } from "@/lib/files/local-file";

export interface ImageSize {
  width: number;
  height: number;
}

const HEAD_BYTES = 512 * 1024;

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function valid(width: number, height: number): ImageSize | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

function jpegSize(b: Uint8Array): ImageSize | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // Standalone markers have no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = u16be(b, i + 2);
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return valid(u16be(b, i + 7), u16be(b, i + 5));
    }
    if (marker === 0xda) return null; // Start of scan without a frame header.
    i += 2 + length;
  }
  return null;
}

export function imageSizeFromBytes(b: Uint8Array): ImageSize | null {
  if (b.length < 24) return null;
  if (b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return valid(u32be(b, 16), u32be(b, 20));
  if (ascii(b, 0, 3) === "GIF") return valid(u16le(b, 6), u16le(b, 8));
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8X") return valid(u24le(b, 24) + 1, u24le(b, 27) + 1);
    if (chunk === "VP8 ") return valid(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
    if (chunk === "VP8L") {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return valid((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
  }
  if (ascii(b, 0, 2) === "BM") return valid(Math.abs(u16le(b, 18) | (u16le(b, 20) << 16)), Math.abs((u16le(b, 22) | (u16le(b, 24) << 16)) << 0));
  return null;
}

/** Reads at most the first 512 KB of the file. Null when the size can't be found. */
export async function imageSize(file: LocalFile): Promise<ImageSize | null> {
  try {
    const head = new Uint8Array(await readRange(file, 0, HEAD_BYTES));
    return imageSizeFromBytes(head);
  } catch {
    return null;
  }
}
