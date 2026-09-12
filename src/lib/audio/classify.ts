import type { Features } from "./features";
import { SOUND_CLASSES, SOUND_SAFETY, type Classification, type SoundClass } from "@/lib/types";

/**
 * The classifier. Every sound source in the project — the ESP32, the laptop
 * microphone, the sample player — funnels into this one function, which is why
 * tuning happens in exactly one place.
 *
 * It is not a neural net. Each class scores a handful of acoustic traits, and
 * the scores go through a softmax to become percentages. That makes it fully
 * explainable: `explain()` below says which trait carried the decision.
 */

/** Below this level we are listening to room tone, not to an event. */
const SILENCE_DB = -58;

/** Softmax temperature. Lower = more decisive, higher = more hedged. */
const TEMPERATURE = 0.15;

/** Classes that should put a device into `alert`: everything marked dangerous. */
export function isAlertClass(name: SoundClass): boolean {
  return SOUND_SAFETY[name] === "danger";
}

/** Mean of `bands[from..to)`, scaled so a full-width match reads as ~1. */
function energy(bands: number[], from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to && i < bands.length; i += 1) sum += bands[i];
  // Bands sum to 1 across all 16, so a slice holding all its energy reads 1.
  return clamp01(sum);
}

/** 1 when `x` sits on `mu`, falling off over `sigma`. For "should be mid" traits. */
function gauss(x: number, mu: number, sigma: number): number {
  const d = (x - mu) / sigma;
  return Math.exp(-0.5 * d * d);
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Loudness mapped to 0..1 between the silence floor and a loud -12 dBFS. */
function loudness(rms: number): number {
  return clamp01((rms - SILENCE_DB) / (-12 - SILENCE_DB));
}

interface Term {
  /** Russian label, shown in the "why" readout. */
  label: string;
  weight: number;
  value: number;
}

type Terms = Record<SoundClass, Term[]>;

/** Scores each class against the features, keeping the per-trait breakdown. */
function score(f: Features): Terms {
  const loud = loudness(f.rms);

  // Band groups, by the ranges in BAND_EDGES.
  const rumble = energy(f.bands, 0, 4); //    60 –  204 Hz  engine rumble
  const body = energy(f.bands, 2, 10); //    110 – 1277 Hz  chainsaw stack
  const bark = energy(f.bands, 6, 12); //    376 – 2353 Hz  dog formants
  const bright = energy(f.bands, 10, 16); // 1277 – 8000 Hz birds, hiss, crack

  return {
    // Leaves, wind, a river, rain: broadband noise that just keeps going. It
    // shares the flat spectrum with a gunshot, so the steadiness carries the
    // weight — a waterfall must never read as a rifle.
    // The two noise terms are deliberately steep: a chainsaw is half-flat and
    // half-pitched, and a gentle 1 - x would hand it a third of this score.
    nature: [
      { label: "ровный шум без атаки", weight: 3.0, value: 1 - f.attack },
      { label: "широкий шумовой спектр", weight: 3.0, value: (f.flatness - 0.4) / 0.4 },
      { label: "нет высоты тона", weight: 2.5, value: 1 - f.harmonic * 1.5 },
      { label: "энергия по всему спектру", weight: 1.5, value: f.spread },
    ],
    gunshot: [
      { label: "резкая атака", weight: 3.0, value: f.attack },
      { label: "широкий шумовой спектр", weight: 2.5, value: f.flatness },
      { label: "энергия размазана по спектру", weight: 2.0, value: f.spread },
      { label: "нет высоты тона", weight: 3.0, value: 1 - f.harmonic },
      { label: "громкость", weight: 1.0, value: loud },
    ],
    chainsaw: [
      { label: "энергия в полосе 0.1–1.3 кГц", weight: 2.5, value: body },
      { label: "устойчивая высота тона", weight: 2.0, value: f.harmonic },
      { label: "звук непрерывный", weight: 1.5, value: 1 - f.attack },
      { label: "плотный гармонический стек", weight: 1.5, value: gauss(f.spread, 0.72, 0.22) },
    ],
    dog: [
      { label: "энергия в полосе 0.4–2.3 кГц", weight: 3.0, value: bark },
      { label: "быстрое нарастание", weight: 1.5, value: gauss(f.attack, 0.75, 0.35) },
      { label: "голосовая гармоника", weight: 2.5, value: f.harmonic },
      { label: "формантная структура", weight: 1.0, value: gauss(f.flatness, 0.3, 0.25) },
    ],
    vehicle: [
      { label: "низкочастотный гул", weight: 3.5, value: rumble },
      { label: "мало переходов через ноль", weight: 1.5, value: 1 - f.zcr * 5 },
      { label: "ровный уровень", weight: 1.5, value: 1 - f.attack },
      { label: "тональный спектр", weight: 1.0, value: f.harmonic },
    ],
    animal: [
      { label: "энергия в полосе 1.3–8 кГц", weight: 3.0, value: bright },
      { label: "чистый тон", weight: 1.5, value: 1 - f.flatness },
      { label: "узкий спектр", weight: 1.5, value: 1 - f.spread },
      { label: "высота тона держится", weight: 1.0, value: f.harmonic },
    ],
    other: [
      // A constant floor, so nothing else has to win by default, plus an
      // explicit reward for being quiet.
      { label: "фоновый уровень", weight: 2.2, value: 0.5 },
      { label: "тишина", weight: 2.5, value: 1 - loud },
    ],
  };
}

function totals(terms: Terms): Record<SoundClass, number> {
  const out = {} as Record<SoundClass, number>;
  for (const name of SOUND_CLASSES) {
    let sum = 0;
    let weight = 0;
    for (const term of terms[name]) {
      sum += term.weight * clamp01(term.value);
      weight += term.weight;
    }
    out[name] = weight > 0 ? sum / weight : 0;
  }
  return out;
}

/** Softmax over the class scores, rendered as integer percentages summing to 100. */
export function classify(f: Features): Classification {
  const raw = totals(score(f));

  // Anything below the floor is room tone. Say so rather than guessing.
  if (f.rms < SILENCE_DB) {
    for (const name of SOUND_CLASSES) {
      raw[name] = name === "other" ? 1 : raw[name] * 0.25;
    }
  }

  let max = -Infinity;
  for (const name of SOUND_CLASSES) max = Math.max(max, raw[name]);

  const exp = {} as Record<SoundClass, number>;
  let sum = 0;
  for (const name of SOUND_CLASSES) {
    exp[name] = Math.exp((raw[name] - max) / TEMPERATURE);
    sum += exp[name];
  }

  const percents = {} as Record<SoundClass, number>;
  for (const name of SOUND_CLASSES) percents[name] = (exp[name] / sum) * 100;
  return roundTo100(percents);
}

/** Largest-remainder rounding, so the bars in the UI always add up to 100. */
function roundTo100(values: Record<SoundClass, number>): Classification {
  const floors = {} as Record<SoundClass, number>;
  let used = 0;
  for (const name of SOUND_CLASSES) {
    floors[name] = Math.floor(values[name]);
    used += floors[name];
  }

  const order = [...SOUND_CLASSES].sort(
    (a, b) => (values[b] - floors[b]) - (values[a] - floors[a]),
  );
  let remainder = 100 - used;
  for (const name of order) {
    if (remainder <= 0) break;
    floors[name] += 1;
    remainder -= 1;
  }
  return floors;
}

/**
 * The two or three traits that pushed `name` to the top, strongest first.
 * This is what turns the demo from "trust the number" into "here is why".
 */
export function explain(f: Features, name: SoundClass): string[] {
  const terms = score(f)[name];
  return [...terms]
    .map((t) => ({ label: t.label, strength: t.weight * clamp01(t.value) }))
    .sort((a, b) => b.strength - a.strength)
    .filter((t) => t.strength > 0.35)
    .slice(0, 3)
    .map((t) => t.label);
}
