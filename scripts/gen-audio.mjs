/**
 * Synthesises the demo sound files into public/audio/.
 *
 * These are a safety net, not the goal: drop real recordings into the same
 * folder and /api/samples picks them up on its own. Existing files are never
 * overwritten, so your own gunshot.wav always wins over the generated one.
 *
 *   node scripts/gen-audio.mjs
 *
 * The waveforms are the ones in src/app/api/selftest/route.ts, which the
 * classifier is verified against — so what these produce is what the site is
 * known to recognise.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 16000;
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "audio");

const noise = () => Math.random() * 2 - 1;

/** One rifle report starting at `onset`, as heard from some distance away. */
function gunshotAt(t, onset) {
  if (t < onset) return 0;
  const dt = t - onset;
  if (dt > 0.6) return 0;
  const crack = noise() * Math.exp(-dt / 0.045);
  const thump = Math.sin(2 * Math.PI * 90 * dt) * Math.exp(-dt / 0.05) * 0.18;
  return (crack + thump) * 0.9;
}

/** One bark: a harmonic stack with its energy in the 0.5-2 kHz formants. */
function barkAt(t, onset) {
  const dt = t - onset;
  if (dt < 0 || dt > 0.24) return 0;
  const env = Math.exp(-dt / 0.08);
  let v = 0;
  for (let h = 1; h <= 6; h += 1) {
    const gain = h >= 2 && h <= 4 ? 1 : 0.35;
    v += Math.sin(2 * Math.PI * 420 * h * dt) * gain;
  }
  return (v / 4 + noise() * 0.18) * env * 0.7;
}

const SOUNDS = [
  {
    file: "gunshot-demo.wav",
    seconds: 3,
    // Three shots, so the alert has time to appear and be pointed at.
    synth: (t) => gunshotAt(t, 0.4) + gunshotAt(t, 1.3) + gunshotAt(t, 2.2),
  },
  {
    file: "dog-demo.wav",
    seconds: 3,
    synth: (t) => {
      let v = 0;
      for (const onset of [0.3, 0.65, 1.0, 1.7, 2.05, 2.4]) v += barkAt(t, onset);
      return v;
    },
  },
  {
    file: "chainsaw-demo.wav",
    seconds: 3,
    synth: (t) => {
      // Engine harmonics, deeply modulated at the firing rate, revving up.
      const rev = 150 + 40 * Math.min(1, t / 2);
      let v = 0;
      for (let h = 1; h <= 8; h += 1) v += Math.sin(2 * Math.PI * rev * h * t) / h;
      const am = 0.5 + 0.5 * Math.sin(2 * Math.PI * 120 * t);
      return (v * 0.45 + noise() * 0.12) * am * 0.6;
    },
  },
  {
    file: "vehicle-demo.wav",
    seconds: 3,
    synth: (t) => {
      let v = 0;
      for (let h = 1; h <= 5; h += 1) v += Math.sin(2 * Math.PI * 70 * h * t) / (h * h);
      return (v * 0.8 + noise() * 0.02) * 0.5;
    },
  },
  {
    file: "ambient-forest.wav",
    seconds: 3,
    synth: (t) => {
      // Room tone with the occasional bird, so "Другое" has something honest
      // to sit on during the demo.
      const phase = 2 * Math.PI * 2600 * t - 180 * Math.cos(2 * Math.PI * 5 * t);
      const bird = t > 1.2 && t < 1.8 ? Math.sin(phase) * 0.3 : 0;
      return noise() * 0.004 + bird;
    },
  },
];

/** 16-bit mono PCM WAV. No dependency needed — the header is 44 bytes. */
function toWav(samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format: PCM
  header.writeUInt16LE(1, 22); // channels: mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
for (const { file, seconds, synth } of SOUNDS) {
  const target = path.join(OUT_DIR, file);
  if (existsSync(target)) {
    console.log(`· ${file} — уже есть, не трогаю`);
    continue;
  }

  const total = Math.round(seconds * RATE);
  const samples = new Float32Array(total);
  for (let i = 0; i < total; i += 1) samples[i] = synth(i / RATE);

  writeFileSync(target, toWav(samples, RATE));
  written += 1;
  console.log(`✓ ${file} — ${seconds} с`);
}

console.log(
  written > 0
    ? `\nГотово: ${written} файл(ов) в public/audio/`
    : "\nВсе файлы уже на месте.",
);
console.log("Свои записи кладите в ту же папку — сайт подхватит их сам.");
