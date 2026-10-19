// Renders the website's Web Audio sounds (droply/lib/fun/celebrate.ts) to WAV files, using
// the same oscillators, frequencies and envelopes, so the app sounds identical without Web
// Audio. Run: node scripts/generate-sounds.mjs  (writes assets/sounds/*.wav)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 44100;
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "sounds");

function wave(type, phase) {
  const p = phase - Math.floor(phase);
  if (type === "triangle") return 4 * Math.abs(p - 0.5) - 1;
  return Math.sin(2 * Math.PI * p);
}

/** Web Audio's exponentialRampToValueAtTime between two points. */
function expRamp(v0, v1, t0, t1, t) {
  if (t <= t0) return v0;
  if (t >= t1) return v1;
  return v0 * (v1 / v0) ** ((t - t0) / (t1 - t0));
}

/** tone(ctx, frequency, start, length, volume, type) from celebrate.ts. */
function tone(buffer, frequency, start, length, volume, type = "sine") {
  const from = Math.floor(start * RATE);
  const to = Math.min(buffer.length, Math.ceil((start + length + 0.05) * RATE));
  let phase = 0;
  for (let i = from; i < to; i += 1) {
    const t = i / RATE;
    const gain = t < start + 0.02 ? expRamp(0.0001, volume, start, start + 0.02, t) : expRamp(volume, 0.0001, start + 0.02, start + length, t);
    phase += frequency / RATE;
    buffer[i] += wave(type, phase) * gain;
  }
}

function sweep(buffer) {
  // "send": triangle 220 → 880 Hz over 0.25 s; gain 0.0001 → 0.08 (0.05 s) → 0.0001 (0.3 s).
  let phase = 0;
  for (let i = 0; i < Math.ceil(0.35 * RATE); i += 1) {
    const t = i / RATE;
    const frequency = expRamp(220, 880, 0, 0.25, t);
    const gain = t < 0.05 ? expRamp(0.0001, 0.08, 0, 0.05, t) : expRamp(0.08, 0.0001, 0.05, 0.3, t);
    phase += frequency / RATE;
    buffer[i] += wave("triangle", phase) * gain;
  }
}

const SOUNDS = {
  send: { seconds: 0.4, render: (b) => sweep(b) },
  receive: {
    seconds: 0.5,
    render: (b) => {
      tone(b, 784, 0, 0.18, 0.09);
      tone(b, 1047, 0.12, 0.3, 0.08);
    },
  },
  request: {
    seconds: 0.35,
    render: (b) => {
      tone(b, 660, 0, 0.12, 0.06);
      tone(b, 660, 0.16, 0.12, 0.06);
    },
  },
  record: {
    seconds: 0.6,
    render: (b) => [523, 659, 784, 1047].forEach((f, i) => tone(b, f, i * 0.09, 0.22, 0.07, "triangle")),
  },
};

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  // Web Audio output is quiet by design (gains ≤ 0.09); normalise to a comfortable level.
  const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  const scale = 0.5 / peak;
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * scale)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

mkdirSync(out, { recursive: true });
for (const [name, { seconds, render }] of Object.entries(SOUNDS)) {
  const buffer = new Float64Array(Math.ceil(seconds * RATE));
  render(buffer);
  writeFileSync(join(out, `${name}.wav`), wav(Array.from(buffer)));
  console.log(`assets/sounds/${name}.wav`);
}
