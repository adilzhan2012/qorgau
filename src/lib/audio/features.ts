import { magnitudeSpectrum } from "./fft";

/**
 * The contract between every sound source and the classifier. The ESP32
 * firmware, the laptop microphone and the sample player all produce exactly
 * this, and `classify()` is the only thing that consumes it.
 *
 * Keep it small — it travels over a 115200 baud serial line.
 */
export interface Features {
  /** Loudness in dBFS, roughly -100 (silence) to 0 (clipping). */
  rms: number;
  /** Zero-crossing rate, 0..1. High for noise and hiss, low for rumble. */
  zcr: number;
  /**
   * How sharply the level rose into this frame, 0..1. A gunshot is ~1.
   *
   * The classifier no longer reads this one: it measures the rise across the
   * whole window instead, which survives a recording that opens on the event
   * itself (this field is 0 there — the first frames have nothing to rise
   * above). It stays because the board reports it and it is the fastest way to
   * see on a serial monitor that the microphone hears anything at all.
   */
  attack: number;
  /**
   * Strength of the strongest periodicity between 60 and 600 Hz, 0..1.
   * ~1 for anything with a pitch (engine, bark, whistle), ~0 for noise.
   */
  harmonic: number;
  /** Spectral flatness, 0..1. ~1 for broadband noise, ~0 for a pure tone. */
  flatness: number;
  /** Entropy of the band distribution, 0..1. ~1 when energy is everywhere. */
  spread: number;
  /**
   * Peak-to-RMS of the waveform, 0..1. A shot or a bang is a spike sitting on
   * near-silence and reads high; an engine or rain reads low. Cheap, and it
   * catches impulsiveness that the spectrum alone cannot see.
   */
  crest: number;
  /**
   * Centre of gravity of the spectrum as a band index, 0..1. Rumble is ~0.1,
   * a bird whistle ~0.9. The single most useful number for "high or low".
   */
  centroid: number;
  /**
   * How far the loudest spectral peak stands above the average bin, 0..1.
   * A whistle or an engine harmonic reads high, rain reads low. Flatness says
   * the same thing about the whole spectrum; this one survives a peak that is
   * narrow — a cricket in a noisy forest.
   */
  tonal: number;
  /**
   * How much the shape of the spectrum changed since the previous frame, 0..1.
   * Near zero while an engine runs, high while a bird sings. Averaged over a
   * window it becomes the "steadiness" that tells a chainsaw from a chirp.
   */
  flux: number;
  /** Energy in 16 log-spaced bands from 60 Hz to 8 kHz, normalised to sum 1. */
  bands: number[];
}

export const BAND_COUNT = 16;
/**
 * The whole frame, not half of it. With a 512-point window over a 1024-sample
 * frame the spectrum came from the first 32 ms while the level came from all
 * 64 — and a bird starting mid-frame read as "loud, flat, sudden": a gunshot.
 */
export const FFT_SIZE = 1024;
export const BAND_LOW_HZ = 60;
export const BAND_HIGH_HZ = 8000;

/** Edges of the 16 log-spaced bands: 17 values, in Hz. */
export const BAND_EDGES: number[] = (() => {
  const edges: number[] = [];
  const ratio = Math.log(BAND_HIGH_HZ / BAND_LOW_HZ) / BAND_COUNT;
  for (let i = 0; i <= BAND_COUNT; i += 1) {
    edges.push(BAND_LOW_HZ * Math.exp(ratio * i));
  }
  return edges;
})();

/** Human-readable band ranges, for the "why" readout in the UI. */
export function bandLabel(index: number): string {
  const lo = Math.round(BAND_EDGES[index]);
  const hi = Math.round(BAND_EDGES[index + 1]);
  const fmt = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(1)}к` : `${hz}`);
  return `${fmt(lo)}–${fmt(hi)} Гц`;
}

const SILENCE_DB = -100;

/**
 * Turns raw audio frames into `Features`. Stateful, because attack needs to
 * know how loud the previous frames were — one instance per sound source.
 */
export class FeatureExtractor {
  private readonly sampleRate: number;
  private readonly spectrum = new Float32Array(FFT_SIZE >> 1);
  /** Recent frame levels in dBFS, newest last. Drives `attack`. */
  private readonly history: number[] = [];
  private static readonly HISTORY = 8;
  /** The previous frame's band profile. Drives `flux`. */
  private previousBands: number[] | null = null;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  reset(): void {
    this.history.length = 0;
    this.previousBands = null;
  }

  /** `samples` should be roughly 1024 long (64 ms at 16 kHz). */
  extract(samples: Float32Array): Features {
    const rms = toDb(rmsOf(samples));
    const zcr = zcrOf(samples);
    const harmonic = harmonicity(samples, this.sampleRate);

    magnitudeSpectrum(samples, FFT_SIZE, this.spectrum);
    const bands = bandEnergies(this.spectrum, this.sampleRate);
    const flatness = spectralFlatness(this.spectrum);
    const spread = bandSpread(bands);
    const centroid = bandCentroid(bands);
    const tonal = peakProminence(this.spectrum);
    const crest = crestFactor(samples);
    const flux = bandFlux(this.previousBands, bands);
    this.previousBands = bands;

    // Attack: how far this frame rose above the quietest of the recent ones.
    // 24 dB of rise inside half a second is a hard transient.
    let floor = rms;
    for (const past of this.history) floor = Math.min(floor, past);
    const attack = clamp01((rms - floor) / 24);

    // Exact digital silence is not a quiet room — it is the analyser before
    // audio starts flowing, or a file's leading zeros. A microphone always
    // has a noise floor. Measuring a waterfall's first frame against nothing
    // would call it a gunshot.
    if (rms > SILENCE_DB + 0.5) {
      this.history.push(rms);
      if (this.history.length > FeatureExtractor.HISTORY) this.history.shift();
    }

    return { rms, zcr, attack, harmonic, flatness, spread, crest, centroid, tonal, flux, bands };
  }
}

export function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

export function toDb(amplitude: number): number {
  if (amplitude <= 1e-7) return SILENCE_DB;
  return Math.max(SILENCE_DB, 20 * Math.log10(amplitude));
}

function zcrOf(samples: Float32Array): number {
  let crossings = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if ((samples[i - 1] < 0 && samples[i] >= 0) || (samples[i - 1] >= 0 && samples[i] < 0)) {
      crossings += 1;
    }
  }
  return clamp01(crossings / Math.max(1, samples.length - 1));
}

/**
 * How strongly the frame repeats itself at a pitch between 60 and 600 Hz.
 *
 * Two details matter more than the autocorrelation itself, and both were
 * learned from the corpus rather than guessed:
 *
 *   1. The lag has to be a *local peak*. Autocorrelation of any smooth signal
 *      decays from lag 1 — take the plain maximum and a gust of wind, which is
 *      just low-passed noise, scores as "pitched" as an engine. Wind at 0.53
 *      against an engine at 0.60 is not a measurement, it is a coin toss.
 *   2. What counts is how far that peak stands above the average correlation,
 *      not its height. A periodic signal comes back to itself and leaves
 *      again; noise correlates with itself a bit at every lag.
 *
 * After this, an engine keeps its score and wind loses two thirds of it —
 * which is exactly the difference between a patrol at 3 a.m. and a quiet night.
 */
function harmonicity(samples: Float32Array, sampleRate: number): number {
  const n = samples.length;
  const minLag = Math.max(2, Math.floor(sampleRate / 600));
  const maxLag = Math.min(n >> 1, Math.floor(sampleRate / 60));
  if (maxLag <= minLag + 2) return 0;

  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += samples[i];
  mean /= n;

  const x = new Float32Array(n);
  let energy = 0;
  for (let i = 0; i < n; i += 1) {
    x[i] = samples[i] - mean;
    energy += x[i] * x[i];
  }
  if (energy <= 1e-9) return 0;

  const correlation = new Float32Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1 && lag < correlation.length; lag += 1) {
    let acc = 0;
    let norm = 0;
    for (let i = 0; i + lag < n; i += 1) {
      acc += x[i] * x[i + lag];
      norm += x[i] * x[i];
    }
    correlation[lag] = norm > 1e-9 ? acc / norm : 0;
  }

  let peak = 0;
  let average = 0;
  let count = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const r = correlation[lag];
    average += Math.abs(r);
    count += 1;
    if (r > peak && r >= correlation[lag - 1] && r >= correlation[lag + 1]) peak = r;
  }
  if (count === 0) return 0;
  average /= count;

  return clamp01((peak - average) / Math.max(0.15, 1 - average));
}

/**
 * Peak over RMS of the waveform, in dB, mapped to 0..1 over 6–24 dB.
 * A sine reads 3 dB, white noise ~12 dB, a bang well past 20 — so this is the
 * one number that says "a spike on quiet" without looking at the spectrum.
 */
function crestFactor(samples: Float32Array): number {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
    sum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  if (rms <= 1e-7 || peak <= 1e-7) return 0;
  return clamp01((20 * Math.log10(peak / rms) - 6) / 18);
}

/**
 * Centre of gravity of the band profile, as a position along the 16 bands.
 * The bands are log-spaced, so this is the centroid in log-frequency — which
 * is how hearing works, and it keeps a bird at ~0.9 whether it sings at 3 or
 * 6 kHz.
 */
function bandCentroid(bands: number[]): number {
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < bands.length; i += 1) {
    weighted += i * bands[i];
    total += bands[i];
  }
  if (total <= 1e-9) return 0;
  return clamp01(weighted / total / (bands.length - 1));
}

/**
 * How far the loudest bin stands above the average one, 0..1 over 0–60 dB.
 * Flatness averages the whole spectrum and a single narrow peak barely moves
 * it; a cricket is exactly a single narrow peak.
 *
 * Sixty decibels, not thirty: on real recordings thirty put every class at the
 * top of the scale, and a feature that reads 0.9 for everything decides
 * nothing.
 */
function peakProminence(spectrum: Float32Array): number {
  let peak = 0;
  let sum = 0;
  let count = 0;
  for (let i = 2; i < spectrum.length; i += 1) {
    const v = spectrum[i];
    if (v > peak) peak = v;
    sum += v;
    count += 1;
  }
  if (count === 0 || sum <= 1e-9 || peak <= 1e-9) return 0;
  return clamp01((20 * Math.log10(peak / (sum / count))) / 60);
}

/**
 * How much the *shape* of the spectrum moved since the previous frame: half
 * the sum of absolute differences, which for two profiles that each sum to 1
 * lands in 0..1. Level is deliberately not in it — a car driving closer is
 * still the same sound, while a bird between two notes is not.
 */
function bandFlux(previous: number[] | null, bands: number[]): number {
  if (!previous) return 0;
  let sum = 0;
  for (let i = 0; i < bands.length; i += 1) sum += Math.abs(bands[i] - previous[i]);
  return clamp01(sum / 2);
}

/** Shannon entropy of the band distribution, normalised to 0..1. */
function bandSpread(bands: number[]): number {
  let h = 0;
  for (const p of bands) {
    if (p > 1e-9) h -= p * Math.log(p);
  }
  return clamp01(h / Math.log(BAND_COUNT));
}

/** Geometric mean over arithmetic mean of the spectrum: 1 = noise, 0 = tone. */
function spectralFlatness(spectrum: Float32Array): number {
  let logSum = 0;
  let sum = 0;
  let count = 0;
  // Skip the first two bins — DC and rumble skew the result.
  for (let i = 2; i < spectrum.length; i += 1) {
    const v = spectrum[i] + 1e-9;
    logSum += Math.log(v);
    sum += v;
    count += 1;
  }
  if (count === 0 || sum <= 0) return 0;
  const geometric = Math.exp(logSum / count);
  const arithmetic = sum / count;
  return clamp01(geometric / arithmetic);
}

/** Sums FFT bins into the 16 log bands and normalises so the bands sum to 1. */
function bandEnergies(spectrum: Float32Array, sampleRate: number): number[] {
  const binHz = sampleRate / FFT_SIZE;
  const bands = new Array<number>(BAND_COUNT).fill(0);

  for (let b = 0; b < BAND_COUNT; b += 1) {
    const from = Math.max(1, Math.round(BAND_EDGES[b] / binHz));
    const to = Math.min(spectrum.length - 1, Math.round(BAND_EDGES[b + 1] / binHz));
    // Sum, not mean: averaging over a wide upper band dilutes a narrow peak
    // until a bird whistle reads as flat as white noise.
    let acc = 0;
    for (let i = from; i <= to; i += 1) acc += spectrum[i] * spectrum[i];
    bands[b] = Math.sqrt(acc);
  }

  const total = bands.reduce((a, b) => a + b, 0);
  if (total <= 1e-9) return bands.map(() => 1 / BAND_COUNT);
  return bands.map((v) => v / total);
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Accepts whatever arrived over the wire and returns usable `Features`, or
 * null. Packets come from firmware, so nothing here can be trusted.
 */
export function parseFeatures(raw: unknown): Features | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const bandsRaw = o.bands ?? o.b;
  if (!Array.isArray(bandsRaw) || bandsRaw.length !== BAND_COUNT) return null;

  const bands = bandsRaw.map((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  });
  const total = bands.reduce((a, b) => a + b, 0);
  const normalised =
    total > 1e-9 ? bands.map((v) => v / total) : bands.map(() => 1 / BAND_COUNT);

  const num = (value: unknown, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  // Older firmware sends six numbers, not ten. Rather than refuse the frame,
  // derive what can be derived from the bands and leave the rest neutral — an
  // old board keeps working, a shade less sure of itself.
  return {
    rms: Math.max(SILENCE_DB, Math.min(0, num(o.rms, SILENCE_DB))),
    zcr: clamp01(num(o.zcr, 0)),
    attack: clamp01(num(o.attack ?? o.atk, 0)),
    harmonic: clamp01(num(o.harmonic ?? o.harm, 0)),
    flatness: clamp01(num(o.flatness ?? o.flat, 0.5)),
    spread: clamp01(num(o.spread, bandSpread(normalised))),
    crest: clamp01(num(o.crest, 0.3)),
    centroid: clamp01(num(o.centroid ?? o.cen, bandCentroid(normalised))),
    tonal: clamp01(num(o.tonal, 0.3)),
    flux: clamp01(num(o.flux, 0.2)),
    bands: normalised,
  };
}
