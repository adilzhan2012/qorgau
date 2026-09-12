"use client";

import { useEffect, useState } from "react";

import { Header } from "@/components/Header";
import { classify, explain } from "@/lib/audio/classify";
import { FeatureExtractor } from "@/lib/audio/features";
import { TEST_CASES, TEST_FRAME, TEST_RATE } from "@/lib/audio/testSignals";
import { ListeningWindow, type WindowFeatures } from "@/lib/audio/window";
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

/**
 * Прогоняет сигнал кадр за кадром и возвращает признаки самого громкого окна.
 *
 * Именно окна, а не кадра: классификатор смотрит на полторы секунды звука, и
 * проверять его на одном кадре в 64 мс значило бы проверять не то, что
 * работает на самом деле.
 */
function analyse(signal: Float32Array): WindowFeatures {
  const extractor = new FeatureExtractor(TEST_RATE);
  const listening = new ListeningWindow();
  let loudest: WindowFeatures | null = null;

  for (let offset = 0; offset + TEST_FRAME <= signal.length; offset += TEST_FRAME) {
    const window = listening.push(extractor.extract(signal.subarray(offset, offset + TEST_FRAME)));
    // Окно должно успеть наполниться: по трём кадрам «непрерывный ли звук»
    // сказать нельзя.
    if (window.seconds >= 1 && (!loudest || window.rms > loudest.rms)) loudest = window;
  }
  return (loudest ?? listening.push(extractor.extract(new Float32Array(TEST_FRAME)))) as WindowFeatures;
}

interface Result {
  name: string;
  expectLabel: string;
  gotLabel: string;
  danger: boolean;
  confidence: number;
  pass: boolean;
  why: string[];
  window: WindowFeatures;
}

function run(): Result[] {
  return TEST_CASES.map(({ expect, name, build }) => {
    const window = analyse(build());
    const top = topSoundClass(classify(window))!;
    return {
      name,
      expectLabel: SOUND_CLASS_LABELS[expect],
      gotLabel: SOUND_CLASS_LABELS[top.name],
      danger: SOUND_SAFETY[top.name] === "danger",
      confidence: top.value,
      pass: top.name === expect,
      why: explain(window, top.name),
      window,
    };
  });
}

export default function SelfTestPage() {
  // Считаем после монтирования, а не при рендере. Сигналы синтезируются со
  // случайным шумом, поэтому статический HTML, собранный при сборке, и первый
  // рендер в браузере дают разные числа — React справедливо ругается на
  // расхождение. Пусть сервер отдаёт «считаю…», а считает браузер.
  const [results, setResults] = useState<Result[] | null>(null);
  useEffect(() => setResults(run()), []);

  const passed = results?.filter((r) => r.pass).length ?? 0;
  const allPassed = results !== null && passed === results.length;

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
        <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-muted">
          Это быстрая проверка «ничего не сломалось». Настоящее качество меряется на полевых
          записях: <code className="font-mono text-[13px]">npm run corpus</code> и{" "}
          <code className="font-mono text-[13px]">npm run eval</code> — там же видно, сколько
          ложных тревог и пропусков.
        </p>

        <div
          className={`mt-6 inline-flex items-center gap-2.5 rounded-full px-4 py-2 text-[15px] font-medium ${
            results === null
              ? "bg-surface text-muted"
              : allPassed
                ? "bg-accent-soft text-accent"
                : "bg-alarm-soft text-alarm"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              results === null ? "bg-faint" : allPassed ? "bg-accent" : "bg-alarm"
            }`}
          />
          {results === null
            ? "считаю…"
            : `${passed} из ${results.length} распознано верно`}
        </div>

        <ul className="mt-8 space-y-3">
          {(results ?? []).map((r) => (
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
                уровень {r.window.rms.toFixed(0)} дБ · подъём {r.window.attack.toFixed(2)} ·
                тон {r.window.harmonic.toFixed(2)} · шумность {r.window.flatness.toFixed(2)} ·
                непрерывность {r.window.duty.toFixed(2)} · резких начал{" "}
                {r.window.onsets.toFixed(2)} · ровность {r.window.steady.toFixed(2)}
              </p>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
