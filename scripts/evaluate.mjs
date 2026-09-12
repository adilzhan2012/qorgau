/**
 * Офлайн-проверка распознавания: «насколько хорошо сайт слышит».
 *
 *   npm run eval              — демо-звуки + помехи
 *   npm run eval -- --plain   — только чистые файлы, без помех
 *   npm run eval -- --dir записи/   — свои записи (класс берётся из имени
 *                                     файла или из имени папки)
 *   npm run eval -- --frames  — распечатать признаки по кадрам
 *
 * Зачем это нужно. Раньше качество распознавания можно было проверить только
 * глазами на странице /selftest: нажал кнопку, посмотрел на проценты. Так
 * нельзя ни поймать ухудшение, ни честно сравнить две версии классификатора —
 * а главное, семь чистых демо-файлов всегда распознаются, потому что пороги
 * подбирались по ним же. Поэтому здесь каждый звук прогоняется ещё и в
 * испорченном виде: тише, дальше, под шум леса и под ветер. Это и есть лес.
 *
 * Гоняется НЕ копия логики, а ровно те модули, что работают в браузере:
 * features.ts → classify.ts → readings.ts. Разойтись они не могут.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decodeWav, resample } from "./lib/wav.mjs";

register("./lib/ts-hooks.mjs", import.meta.url);

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIO_DIR = path.join(ROOT, "public", "audio");

const { FeatureExtractor } = await import("@/lib/audio/features");
const { ListeningWindow } = await import("@/lib/audio/window");
const { classify, inspect } = await import("@/lib/audio/classify");
const { TEST_CASES, TEST_FRAME, TEST_RATE } = await import("@/lib/audio/testSignals");
const { makeReading, mergeReading } = await import("@/lib/live/readings");
const { SOUND_CLASS_LABELS, SOUND_SAFETY } = await import("@/lib/types");

const RATE = 16000;
const FRAME = 1024;

// ─────────────────────────── что проверяем ───────────────────────────

const args = process.argv.slice(2);
const withStress = !args.includes("--plain");
const showFrames = args.includes("--frames");
const extraDirs = args.flatMap((a, i) => (a === "--dir" ? [args[i + 1]] : [])).filter(Boolean);
/** --selftest: прогнать синтетические случаи со страницы /selftest и выйти. */
const selftestOnly = args.includes("--selftest");
/** --why: разобрать самое громкое окно по классам и термам. */
const explainWhy = args.includes("--why");
/** --dump файл.csv: выгрузить признаки окон — по ним и подбираются пороги. */
const dumpTo = args.flatMap((a, i) => (a === "--dump" ? [args[i + 1]] : [])).filter(Boolean)[0] ?? null;
/** --only <часть имени>: прогнать не весь набор, а один звук. Для отладки. */
const only = args.flatMap((a, i) => (a === "--only" ? [args[i + 1]] : [])).filter(Boolean)[0] ?? null;

/** Класс по имени файла или папки — те же подсказки, что в gen-audio.mjs. */
const HINTS = [
  [/gun|shot|shoot|rifle|выстрел|ружь|стрель/i, "gunshot"],
  [/dog|bark|лай|собак|пёс|пес/i, "dog"],
  [/chain|saw|пила|бензо|пил/i, "chainsaw"],
  [/car|truck|engine|vehicle|moto|мотор|машин|транспорт|двигат/i, "vehicle"],
  [/bird|animal|wolf|птиц|животн|волк|зверь/i, "animal"],
  [/leaves|leaf|wind|water|river|rain|nature|листв|ветер|вод|дожд|природ|forest|лес/i, "nature"],
  [/quiet|silence|фон|тишин/i, "other"],
];

function classOf(file) {
  const name = path.basename(file);
  const folder = path.basename(path.dirname(file));
  return HINTS.find(([re]) => re.test(name))?.[1]
    ?? HINTS.find(([re]) => re.test(folder))?.[1]
    ?? null;
}

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (path.extname(entry).toLowerCase() === ".wav") out.push(full);
  }
  return out;
}

// ─────────────────────────── помехи ───────────────────────────

/**
 * Детерминированный шум: одна и та же проверка должна давать один и тот же
 * ответ, иначе «стало лучше» не отличить от «повезло».
 */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function gain(samples, db) {
  const k = Math.pow(10, db / 20);
  return samples.map((v) => v * k);
}

/** Простой RC-фильтр: так звук глохнет с расстоянием — верха уходят первыми. */
function lowpass(samples, hz) {
  const rc = 1 / (2 * Math.PI * hz);
  const a = (1 / RATE) / (rc + 1 / RATE);
  const out = new Float32Array(samples.length);
  let prev = 0;
  for (let i = 0; i < samples.length; i += 1) {
    prev += a * (samples[i] - prev);
    out[i] = prev;
  }
  return out;
}

/** Лесной фон: шелест (шум) плюс медленные порывы ветра на низах. */
function forest(length, level, seed) {
  const random = rng(seed);
  const out = new Float32Array(length);
  let wind = 0;
  for (let i = 0; i < length; i += 1) {
    const t = i / RATE;
    const gust = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.25 * t + seed);
    wind += 0.002 * ((random() * 2 - 1) - wind);
    out[i] = ((random() * 2 - 1) * 0.55 * gust + wind * 6) * level;
  }
  return out;
}

function mix(a, b) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] + (b[i] ?? 0);
  return out;
}

/** Как звук доходит до датчика на самом деле. Чистый файл — только первый. */
const STRESS = [
  { name: "как есть", apply: (s) => s },
  { name: "тихо (−18 дБ)", apply: (s) => gain(s, -18) },
  { name: "далеко", apply: (s, i) => mix(gain(lowpass(s, 1800), -14), forest(s.length, 0.004, 7 + i)) },
  { name: "шум леса", apply: (s, i) => mix(gain(s, -6), forest(s.length, 0.02, 21 + i)) },
  { name: "ветер", apply: (s, i) => mix(s, forest(s.length, 0.05, 43 + i)) },
];

// ─────────────────────────── прогон ───────────────────────────

/** Прогоняет звук через настоящий конвейер сайта и возвращает, что он услышал. */
function listen(samples) {
  const extractor = new FeatureExtractor(RATE);
  const listening = new ListeningWindow();
  const windows = [];
  const frames = {};
  const alerts = new Map(); // класс → лучшая уверенность тревоги
  let previous;
  let peak = -100;

  for (let at = 0; at + FRAME <= samples.length; at += FRAME) {
    const features = extractor.extract(samples.subarray(at, at + FRAME));
    const time = (at / RATE) * 1000;
    const window = listening.push(features);
    const reading = mergeReading(
      previous,
      makeReading("eval", "sample", features, window, null, null, time),
    );
    previous = reading;

    windows.push(window);
    frames[reading.top] = (frames[reading.top] ?? 0) + 1;
    peak = Math.max(peak, features.rms);
    if (reading.status === "alert") {
      alerts.set(reading.top, Math.max(alerts.get(reading.top) ?? 0, reading.topValue));
    }
    if (showFrames) {
      console.log(
        `    ${(time / 1000).toFixed(2)}s rms=${window.rms.toFixed(1)} duty=${window.duty.toFixed(2)} ` +
        `onset=${window.onsets.toFixed(2)} steady=${window.steady.toFixed(2)} mod=${window.modDepth.toFixed(2)}@${window.modRate.toFixed(1)}Гц ` +
        `cen=${window.centroid.toFixed(2)} tonal=${window.tonal.toFixed(2)} harm=${window.harmonic.toFixed(2)} ` +
        `flat=${window.flatness.toFixed(2)} crest=${window.crest.toFixed(2)} span=${window.levelSpan.toFixed(2)} → ${reading.top} ${reading.topValue}%`,
      );
    }
  }

  if (explainWhy && windows.length) {
    const loudest = windows.reduce((a, b) => (b.rms > a.rms ? b : a));
    console.log(`    окно: rms=${loudest.rms.toFixed(1)} duty=${loudest.duty.toFixed(2)} ` +
      `onsets=${loudest.onsets.toFixed(2)} span=${loudest.levelSpan.toFixed(2)} steady=${loudest.steady.toFixed(2)} ` +
      `harm=${loudest.harmonic.toFixed(2)} flat=${loudest.flatness.toFixed(2)} cen=${loudest.centroid.toFixed(2)} ` +
      `crest=${loudest.crest.toFixed(2)} attack=${loudest.attack.toFixed(2)} tonal=${loudest.tonal.toFixed(2)}`);
    for (const cls of inspect(loudest).slice(0, 3)) {
      console.log(`    ${cls.name} = ${cls.total.toFixed(3)}`);
      for (const t of cls.terms) {
        console.log(`       ${t.gate ? "!" : " "} ${t.label.padEnd(34)} ${t.value.toFixed(2)}`);
      }
    }
  }

  const total = Object.values(frames).reduce((a, b) => a + b, 0) || 1;
  const dominant = Object.entries(frames).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other";
  return { dominant, share: Math.round((frames[dominant] ?? 0) * 100 / total), alerts, frames, peak, windows };
}

/**
 * Оценка одного прогона. Для опасного звука важно, что тревога поднялась и
 * названа верно; для безопасного — что тревоги не было вообще. Ложная тревога
 * в парке дороже пропуска: она приходит ночью и никого не находит.
 */
function judge(expected, heard) {
  const danger = SOUND_SAFETY[expected] === "danger";
  const raised = [...heard.alerts.keys()];
  const wrongAlerts = raised.filter((c) => c !== expected);

  if (danger) {
    if (!heard.alerts.has(expected)) return { ok: false, why: raised.length ? `тревога не та: ${raised.join(", ")}` : "тревоги не было" };
    if (wrongAlerts.length) return { ok: false, why: `заодно ложная тревога: ${wrongAlerts.join(", ")}` };
    return { ok: true, why: "" };
  }

  if (raised.length) return { ok: false, why: `ложная тревога: ${raised.join(", ")}` };
  if (heard.dominant !== expected && heard.dominant !== "other") {
    return { ok: true, why: `не тревога, но слышит как «${SOUND_CLASS_LABELS[heard.dominant]}»`, soft: true };
  }
  return { ok: true, why: "" };
}

// ─────────────────────────── отчёт ───────────────────────────

// Синтетика со страницы /selftest: тот же модуль, те же сигналы. Быстрая
// проверка «ничего не сломалось» — и её же видит любой, кто открыл сайт.
if (selftestOnly) {
  let ok = 0;
  console.log("\nПроверка на синтетических сигналах (та же, что на странице /selftest)\n");
  for (const { expect, name, build } of TEST_CASES) {
    const extractor = new FeatureExtractor(TEST_RATE);
    const listening = new ListeningWindow();
    const signal = build();
    let loudest = null;
    for (let at = 0; at + TEST_FRAME <= signal.length; at += TEST_FRAME) {
      const w = listening.push(extractor.extract(signal.subarray(at, at + TEST_FRAME)));
      if (w.seconds >= 1 && (!loudest || w.rms > loudest.rms)) loudest = w;
    }
    const percents = classify(loudest);
    const top = Object.entries(percents).sort((a, b) => b[1] - a[1])[0];
    const pass = top[0] === expect;
    if (pass) ok += 1;
    console.log(`  ${pass ? "✓" : "✗"} ${name.padEnd(28)} → ${SOUND_CLASS_LABELS[top[0]]} ${top[1]}%` +
      (pass ? "" : `  (ожидалось «${SOUND_CLASS_LABELS[expect]}»)`));
    if (explainWhy && !pass) {
      console.log(`      окно: rms=${loudest.rms.toFixed(1)} duty=${loudest.duty.toFixed(2)} ` +
        `onsets=${loudest.onsets.toFixed(2)} span=${loudest.levelSpan.toFixed(2)} steady=${loudest.steady.toFixed(2)} ` +
        `harm=${loudest.harmonic.toFixed(2)} flat=${loudest.flatness.toFixed(2)} cen=${loudest.centroid.toFixed(2)} ` +
        `crest=${loudest.crest.toFixed(2)} attack=${loudest.attack.toFixed(2)}`);
      const all = inspect(loudest);
      for (const cls of [...all.slice(0, 3), ...all.filter((c) => c.name === expect && !all.slice(0, 3).includes(c))]) {
        console.log(`      ${cls.name} = ${cls.total.toFixed(3)}  ` +
          cls.terms.map((t) => `${t.gate ? "!" : ""}${t.label}=${t.value.toFixed(2)}`).join("; "));
      }
    }
  }
  console.log(`\n${ok} из ${TEST_CASES.length} верно\n`);
  process.exit(ok === TEST_CASES.length ? 0 : 1);
}

const files = [...collect(AUDIO_DIR), ...extraDirs.flatMap((d) => collect(path.resolve(d)))];
const cases = files
  .map((file) => ({ file, expected: classOf(file) }))
  .filter((c) => c.expected !== null)
  .filter((c) => !only || c.file.includes(only))
  .sort((a, b) => a.expected.localeCompare(b.expected) || a.file.localeCompare(b.file));

if (cases.length === 0) {
  console.error("Нечего проверять: не нашёл ни одного .wav с понятным классом в имени.");
  process.exit(1);
}

const variants = withStress ? STRESS : STRESS.slice(0, 1);
const DUMP_FIELDS = ["rms", "peak", "floor", "levelSpan", "duty", "onsets", "steady",
  "bandPeak", "zcr", "harmonic", "flatness", "spread", "centroid",
  "tonal", "attack", "crest"];
const dumpRows = [];
const failures = [];
const confusion = new Map();
let passed = 0;
let checks = 0;

console.log(`\nQorgau — проверка распознавания: ${cases.length} звук(ов) × ${variants.length} условие(й)\n`);

for (const { file, expected } of cases) {
  const wav = decodeWav(readFileSync(file));
  const audio = resample(wav.samples, wav.rate, RATE);
  console.log(`${path.relative(ROOT, file)}  →  ожидаем «${SOUND_CLASS_LABELS[expected]}»`);

  for (const [index, variant] of variants.entries()) {
    const heard = listen(variant.apply(audio, index));
    const verdict = judge(expected, heard);
    checks += 1;
    if (verdict.ok) passed += 1;
    else failures.push({ file: path.relative(ROOT, file), variant: variant.name, expected, why: verdict.why });

    if (dumpTo) {
      // Медиана по окнам: одно число на файл, устойчивое к началу и концу записи.
      const median = (pick) => {
        const values = heard.windows.map(pick).sort((a, b) => a - b);
        return values.length ? values[values.length >> 1] : 0;
      };
      dumpRows.push([
        expected, variant.name, path.relative(ROOT, file),
        ...DUMP_FIELDS.map((f) => median((w) => w[f]).toFixed(3)),
        ...Array.from({ length: 16 }, (_, b) => median((w) => w.bands[b]).toFixed(4)),
      ].join(","));
    }

    const key = `${expected}→${heard.dominant}`;
    confusion.set(key, (confusion.get(key) ?? 0) + 1);

    const mark = verdict.ok ? (verdict.soft ? "~" : "✓") : "✗";
    const alerts = heard.alerts.size ? `тревога: ${[...heard.alerts].map(([c, v]) => `${SOUND_CLASS_LABELS[c]} ${v}%`).join(", ")}` : "тревоги нет";
    console.log(
      `  ${mark} ${variant.name.padEnd(14)} слышит «${SOUND_CLASS_LABELS[heard.dominant]}» ${String(heard.share).padStart(3)}% кадров · ` +
      `${alerts}${verdict.why ? ` · ${verdict.why}` : ""}`,
    );
  }
  console.log("");
}

if (dumpTo) {
  const header = ["class", "variant", "file", ...DUMP_FIELDS,
    ...Array.from({ length: 16 }, (_, b) => `band${b}`)].join(",");
  writeFileSync(dumpTo, `${header}\n${dumpRows.join("\n")}\n`);
  console.log(`Признаки выгружены: ${dumpTo} (${dumpRows.length} строк)\n`);
}

console.log("── Путаница (ожидали → чаще всего слышим) ──");
for (const [key, count] of [...confusion].sort((a, b) => b[1] - a[1])) {
  const [from, to] = key.split("→");
  const mark = from === to ? " " : "!";
  console.log(` ${mark} ${SOUND_CLASS_LABELS[from]} → ${SOUND_CLASS_LABELS[to]}: ${count}`);
}

const misses = failures.filter((f) => SOUND_SAFETY[f.expected] === "danger").length;
const falseAlarms = failures.length - misses;
console.log(`\n── Итог ──`);
console.log(` Прошло:          ${passed} из ${checks} (${Math.round((passed * 100) / checks)}%)`);
console.log(` Пропуск опасного: ${misses}`);
console.log(` Ложная тревога:   ${falseAlarms}`);

if (failures.length) {
  console.log("\n── Что не так ──");
  for (const f of failures) console.log(` ✗ ${f.file} · ${f.variant}: ${f.why}`);
}
console.log("");
process.exit(failures.length ? 1 : 0);
