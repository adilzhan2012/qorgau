import { NextResponse } from "next/server";

import { classify, explain } from "@/lib/audio/classify";
import { FeatureExtractor, type Features } from "@/lib/audio/features";
import { SOUND_CLASS_LABELS, topSoundClass, type SoundClass } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runs the classifier against synthesised signals whose class we know, and
 * reports what it decided. This is how the thresholds in classify.ts get
 * tuned, and it doubles as something to show: the pipeline is testable, not
 * a hard-coded demo.
 */

const RATE = 16000;
const FRAME = 1024;

type Synth = (t: number, i: number) => number;

function noise(): number {
  return Math.random() * 2 - 1;
}

/** Builds `frames` frames of audio from a generator, in one Float32Array. */
function render(frames: number, synth: Synth): Float32Array {
  const out = new Float32Array(frames * FRAME);
  for (let i = 0; i < out.length; i += 1) out[i] = synth(i / RATE, i);
  return out;
}

const CASES: Array<{ expect: SoundClass; name: string; signal: Float32Array }> = [
  {
    expect: "other",
    name: "тишина (фон леса)",
    signal: render(6, () => noise() * 0.0012),
  },
  {
    expect: "gunshot",
    name: "выстрел",
    signal: render(6, (t) => {
      const onset = 0.192; // three quiet frames first, so attack has a floor
      if (t < onset) return noise() * 0.0015;
      const dt = t - onset;
      // A rifle report heard at distance is mostly broadband crack; the
      // muzzle thump is there but must not dominate the spectrum.
      const crack = noise() * Math.exp(-dt / 0.045);
      const thump = Math.sin(2 * Math.PI * 90 * dt) * Math.exp(-dt / 0.05) * 0.18;
      return (crack + thump) * 0.9;
    }),
  },
  {
    expect: "dog",
    name: "лай собаки",
    signal: render(6, (t) => {
      const onset = 0.192;
      if (t < onset) return noise() * 0.0015;
      const dt = (t - onset) % 0.34; // a couple of barks
      const env = Math.exp(-dt / 0.08) * (dt < 0.22 ? 1 : 0);
      const f0 = 420;
      let v = 0;
      // Harmonic stack with the energy sitting in the 0.5-2 kHz formants.
      for (let h = 1; h <= 6; h += 1) {
        const gain = h >= 2 && h <= 4 ? 1 : 0.35;
        v += Math.sin(2 * Math.PI * f0 * h * dt) * gain;
      }
      return (v / 4 + noise() * 0.18) * env * 0.7;
    }),
  },
  {
    expect: "chainsaw",
    name: "бензопила",
    signal: render(6, (t) => {
      // Harmonic engine tone, deeply modulated at the firing rate.
      let v = 0;
      for (let h = 1; h <= 8; h += 1) {
        v += Math.sin(2 * Math.PI * 170 * h * t) / h;
      }
      const am = 0.5 + 0.5 * Math.sin(2 * Math.PI * 120 * t);
      return (v * 0.45 + noise() * 0.12) * am * 0.6;
    }),
  },
  {
    expect: "vehicle",
    name: "машина (гул двигателя)",
    signal: render(6, (t) => {
      let v = 0;
      for (let h = 1; h <= 5; h += 1) {
        v += Math.sin(2 * Math.PI * 70 * h * t) / (h * h);
      }
      return (v * 0.8 + noise() * 0.02) * 0.5;
    }),
  },
  {
    expect: "animal",
    name: "птица (тональный свист)",
    signal: render(6, (t) => {
      // Vibrato has to be integrated into the phase — multiplying a varying
      // frequency by t sweeps far wider than intended and reads as noise.
      const phase = 2 * Math.PI * 2600 * t - 180 * Math.cos(2 * Math.PI * 5 * t);
      return (Math.sin(phase) + noise() * 0.03) * 0.35;
    }),
  },
];

/** Feeds the signal frame by frame and returns the features of the loudest frame. */
function analyse(signal: Float32Array): Features {
  const extractor = new FeatureExtractor(RATE);
  let loudest: Features | null = null;
  for (let offset = 0; offset + FRAME <= signal.length; offset += FRAME) {
    const f = extractor.extract(signal.subarray(offset, offset + FRAME));
    if (!loudest || f.rms > loudest.rms) loudest = f;
  }
  return loudest!;
}

export async function GET() {
  const results = CASES.map(({ expect, name, signal }) => {
    const features = analyse(signal);
    const classification = classify(features);
    const top = topSoundClass(classification)!;
    return {
      name,
      expect,
      expectLabel: SOUND_CLASS_LABELS[expect],
      got: top.name,
      gotLabel: SOUND_CLASS_LABELS[top.name],
      confidence: top.value,
      pass: top.name === expect,
      why: explain(features, top.name),
      features: {
        rms: Number(features.rms.toFixed(1)),
        zcr: Number(features.zcr.toFixed(3)),
        attack: Number(features.attack.toFixed(3)),
        harmonic: Number(features.harmonic.toFixed(3)),
        flatness: Number(features.flatness.toFixed(3)),
        spread: Number(features.spread.toFixed(3)),
        bands: features.bands.map((v) => Number(v.toFixed(3))),
      },
      classification,
    };
  });

  const passed = results.filter((r) => r.pass).length;
  return NextResponse.json({
    passed,
    total: results.length,
    ok: passed === results.length,
    results,
  });
}
