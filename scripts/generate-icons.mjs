// Generates the app icon, Android adaptive-icon layers and splash image from the brand mark
// (lucide "zap" on the primary → electric gradient, as on the website). Pure Node, no deps.
//   node scripts/generate-icons.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
const PRIMARY = [0x4f, 0x46, 0xe5];
const ELECTRIC = [0x00, 0x8a, 0xf1];

// lucide "zap": M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7
// a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z  (24×24 box)
const BOLT = [
  [4, 14], [3.22, 12.37], [13.12, 2.17], [13.98, 2.63], [12.06, 8.65], [13, 10],
  [20, 10], [20.78, 11.63], [10.88, 21.83], [10.02, 21.37], [11.94, 15.35], [11, 14],
];

function inPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const SS = 3; // supersampling for smooth edges
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const [pr, pg, pb, pa] = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          r += pr * pa; g += pg * pa; b += pb * pa; a += pa;
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const gradient = (u, v) => {
  const t = Math.min(1, Math.max(0, (u + v) / 2));
  return PRIMARY.map((c, i) => Math.round(c + (ELECTRIC[i] - c) * t));
};

/** Bolt test in unit coordinates; `scale` = bolt height as a fraction of the canvas. */
const bolt = (u, v, scale) => {
  const x = ((u - 0.5) / scale) * 24 + 12;
  const y = ((v - 0.5) / scale) * 24 + 12;
  return inPolygon(x, y, BOLT);
};

const roundedSquare = (u, v, r) => {
  const dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
  return dx * dx + dy * dy <= r * r;
};

const write = (name, buf) => {
  writeFileSync(join(out, name), buf);
  console.log(`assets/${name}`);
};

// iOS/Android legacy icon: full-bleed gradient (iOS applies its own mask), white bolt.
write("icon.png", png(1024, (u, v) => (bolt(u, v, 0.56) ? [255, 255, 255, 1] : [...gradient(u, v), 1])));
// Adaptive icon: background gradient, foreground bolt inside the 66% safe zone, monochrome.
write("android-icon-background.png", png(512, (u, v) => [...gradient(u, v), 1]));
write("android-icon-foreground.png", png(512, (u, v) => (bolt(u, v, 0.36) ? [255, 255, 255, 1] : [0, 0, 0, 0])));
write("android-icon-monochrome.png", png(512, (u, v) => (bolt(u, v, 0.36) ? [255, 255, 255, 1] : [0, 0, 0, 0])));
// Splash: the logo mark (rounded gradient square + bolt) on a transparent background.
write(
  "splash-icon.png",
  png(512, (u, v) => {
    if (!roundedSquare(u, v, 0.22)) return [0, 0, 0, 0];
    return bolt(u, v, 0.56) ? [255, 255, 255, 1] : [...gradient(u, v), 1];
  }),
);
write("favicon.png", png(64, (u, v) => (!roundedSquare(u, v, 0.22) ? [0, 0, 0, 0] : bolt(u, v, 0.6) ? [255, 255, 255, 1] : [...gradient(u, v), 1])));
