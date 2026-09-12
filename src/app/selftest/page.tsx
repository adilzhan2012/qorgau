"use client";

import { useMemo } from "react";

import { Header } from "@/components/Header";
import { classify, explain } from "@/lib/audio/classify";
import { FeatureExtractor, type Features } from "@/lib/audio/features";
import {
  SAFETY_LABELS,
  SOUND_CLASS_LABELS,
  SOUND_SAFETY,
  topSoundClass,
  type SoundClass,
} from "@/lib/types";

/**
 * Runs the classifier against synthesised signals whose class we know, and
 * shows what it decided and why.
 *
 * This is how the thresholds in classify.ts got tuned — it found three real
 * bugs in feature extraction — and it doubles as the answer to "is this
 * actually working, or is the demo hard-coded?".
 */

const RATE = 16000;
const FRAME = 1024;

function noise(): number {
  return Math.random() * 2 - 1;
}

function render(frames: number, synth: (t: number) => number): Float32Array {
  const out = new Float32Array(frames * FRAME);
  for (let i = 0; i < out.length; i += 1) out[i] = synth(i / RATE);
  return out;
}

interface Case {
  expect: SoundClass;
  name: string;
  build: () => Float32Array;
}

const CASES: Case[] = [
  {
    expect: "other",
    name: "тишина (фон леса)",
    build: () => render(6, () => noise() * 0.0012),
  },
  {
    expect: "gunshot",
    name: "выстрел",
    build: () =>
      render(6, (t) => {
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
    build: () =>
      render(6, (t) => {
        const onset = 0.192;
        if (t < onset) return noise() * 0.0015;
        const dt = (t - onset) % 0.34;
        const env = Math.exp(-dt / 0.08) * (dt < 0.22 ? 1 : 0);
        let v = 0;
        // Harmonic stack with the energy sitting in the 0.5-2 kHz formants.
        for (let h = 1; h <= 6; h += 1) {
          const gain = h >= 2 && h <= 4 ? 1 : 0.35;
          v += Math.sin(2 * Math.PI * 420 * h * dt) * gain;
        }
        return (v / 4 + noise() * 0.18) * env * 0.7;
      }),
  },
  {
    expect: "chainsaw",
    name: "бензопила",
    build: () =>
      render(6, (t) => {
        let v = 0;
        for (let h = 1; h <= 8; h += 1) v += Math.sin(2 * Math.PI * 170 * h * t) / h;
        const am = 0.5 + 0.5 * Math.sin(2 * Math.PI * 120 * t);
        return (v * 0.45 + noise() * 0.12) * am * 0.6;
      }),
  },
  {
    expect: "vehicle",
    name: "машина (гул двигателя)",
    build: () =>
      render(6, (t) => {
        let v = 0;
        for (let h = 1; h <= 5; h += 1) v += Math.sin(2 * Math.PI * 70 * h * t) / (h * h);
        return (v * 0.8 + noise() * 0.02) * 0.5;
      }),
  },
  {
    expect: "nature",
    name: "листва на ветру",
    build: () =>
      render(6, (t) => {
        const gust = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.4 * t + 1);
        return noise() * 0.12 * gust;
      }),
  },
  {
    expect: "nature",
    name: "водопад (громкий ровный шум)",
    build: () => render(6, () => noise() * 0.5),
  },
  {
    expect: "animal",
    name: "птица (тональный свист)",
    build: () =>
      render(6, (t) => {
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
  return loudest as Features;
}

export default function SelfTestPage() {
  const results = useMemo(
    () =>
      CASES.map(({ expect, name, build }) => {
        const features = analyse(build());
        const classification = classify(features);
        const top = topSoundClass(classification)!;
        return {
          name,
          expectLabel: SOUND_CLASS_LABELS[expect],
          gotLabel: SOUND_CLASS_LABELS[top.name],
          danger: SOUND_SAFETY[top.name] === "danger",
          confidence: top.value,
          pass: top.name === expect,
          why: explain(features, top.name),
          features,
        };
      }),
    [],
  );

  const passed = results.filter((r) => r.pass).length;
  const allPassed = passed === results.length;

  return (
    <div className="min-h-[100dvh]">
      <Header />

      <main className="mx-auto max-w-[860px] px-5 pb-20 pt-10 sm:px-8">
        <h1 className="text-[32px] font-semibold tracking-tightest">Проверка классификатора</h1>
        <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-muted">
          Восемь звуков синтезируются прямо в браузере, и правильный ответ для каждого известен
          заранее. Классификатор их не видел — он получает те же признаки, что приходят с платы.
          Обновите страницу: сигналы генерируются заново со случайным шумом.
        </p>

        <div
          className={`mt-6 inline-flex items-center gap-2.5 rounded-full px-4 py-2 text-[15px] font-medium ${
            allPassed ? "bg-accent-soft text-accent" : "bg-alarm-soft text-alarm"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${allPassed ? "bg-accent" : "bg-alarm"}`} />
          {passed} из {results.length} распознано верно
        </div>

        <ul className="mt-8 space-y-3">
          {results.map((r) => (
            <li key={r.name} className="rounded-2xl bg-surface p-5 shadow-card">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-[17px] font-medium">{r.name}</span>
                <span
                  className={`text-[13px] font-medium ${r.pass ? "text-accent" : "text-alarm"}`}
                >
                  {r.pass ? "верно" : `ошибка — ожидалось «${r.expectLabel}»`}
                </span>
              </div>

              <div className="mt-3 flex items-baseline gap-3">
                <span className="text-[24px] font-semibold tabular-nums">{r.confidence}%</span>
                <span className="text-[15px] text-muted">{r.gotLabel}</span>
                <span
                  className={`rounded-full px-2 py-[3px] text-[11px] font-semibold uppercase tracking-[0.06em] ${
                    r.danger ? "bg-alarm-soft text-alarm" : "bg-accent-soft text-accent"
                  }`}
                >
                  {r.danger ? SAFETY_LABELS.danger : SAFETY_LABELS.safe}
                </span>
              </div>

              {r.why.length > 0 && (
                <p className="mt-2 text-[13px] leading-relaxed text-muted">
                  Почему: {r.why.join(", ")}
                </p>
              )}

              <p className="mt-3 font-mono text-[11px] leading-relaxed text-faint">
                уровень {r.features.rms.toFixed(0)} дБ · атака {r.features.attack.toFixed(2)} ·
                тон {r.features.harmonic.toFixed(2)} · шумность {r.features.flatness.toFixed(2)} ·
                разброс {r.features.spread.toFixed(2)}
              </p>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
