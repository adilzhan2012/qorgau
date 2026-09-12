/**
 * Сверяет классификатор платы с классификатором сайта.
 *
 *   npm run fw-check
 *
 * В проекте две копии одного и того же: window.ts + classify.ts в браузере и
 * их построчный перевод на C в прошивке. Пока они совпадают, вердикт платы и
 * вердикт сайта можно показывать рядом — и расхождение будет видно, а не
 * спрятано. Стоит поправить порог в одном месте и забыть про другое, как это
 * перестаёт быть правдой, причём молча.
 *
 * Поэтому здесь: кусок прошивки между метками «ОБЩЕЕ С САЙТОМ» вырезается,
 * собирается обычным g++ с десятком заглушек вместо Arduino, и обеим версиям
 * скармливаются одинаковые случайные признаки. Класс обязан совпасть, процент
 * — с точностью до единицы (на плате float, в браузере double).
 *
 * Если g++ в системе нет, скрипт честно говорит об этом и выходит без ошибки:
 * собрать прошивку он всё равно не может, а мешать сборке сайта не должен.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./lib/ts-hooks.mjs", import.meta.url);

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIRMWARE = path.join(ROOT, "firmware", "qorgau_sensor", "qorgau_sensor.ino");

const { summarise } = await import("@/lib/audio/window");
const { classify } = await import("@/lib/audio/classify");
const { topSoundClass } = await import("@/lib/types");

const CASES = Number(process.argv[2]) || 300;
const BANDS = 16;

// ── кусок прошивки ──

const firmware = readFileSync(FIRMWARE, "utf8");
const BEGIN = "// <<< ОБЩЕЕ С САЙТОМ: window.ts + classify.ts — начало >>>";
const END = "// <<< ОБЩЕЕ С САЙТОМ: конец >>>";
if (!firmware.includes(BEGIN) || !firmware.includes(END)) {
  console.error(`В ${path.relative(ROOT, FIRMWARE)} нет меток «ОБЩЕЕ С САЙТОМ». Их убрали?`);
  process.exit(1);
}
const shared = firmware.slice(firmware.indexOf(BEGIN) + BEGIN.length, firmware.indexOf(END));

/** Заглушки вместо Arduino: прошивке из этого куска нужно совсем немного. */
const STUB = `
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <stdint.h>
#define BAND_COUNT ${BANDS}
static float bands[BAND_COUNT];
static int lastTop, lastConf, dangerStreak, dangerVote;
static bool lastDanger;
static uint32_t dangerUntilMs;
static uint32_t millis(void) { return 1; }
static inline float clamp01(float v) {
  if (!isfinite(v)) return 0.0f;
  return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v);
}
`;

/**
 * Читает случайные признаки со стандартного ввода, гоняет их через окно и
 * классификатор платы и печатает вердикт. По строке на случай.
 */
const MAIN = `
int main(void) {
  float rms, zcr, harm, flat, spread, centroid, tonal, crest, flux;
  while (scanf("%f %f %f %f %f %f %f %f %f", &rms, &zcr, &harm, &flat, &spread,
               &centroid, &tonal, &crest, &flux) == 9) {
    for (int b = 0; b < BAND_COUNT; b++) {
      if (scanf("%f", &bands[b]) != 1) return 1;
    }
    winCount = 0;
    winHead = 0;
    for (int f = 0; f < WIN_FRAMES; f++) {
      windowPush(rms, zcr, harm, flat, spread, centroid, tonal, crest, flux);
    }
    windowSummarise();
    classifyWindow();
    printf("%s %d\\n", CLS_NAME[lastTop], lastConf);
    fflush(stdout);
  }
  return 0;
}
`;

const work = mkdtempSync(path.join(tmpdir(), "qorgau-fw-"));
const source = path.join(work, "shared.cpp");
const binary = path.join(work, "shared");
writeFileSync(source, STUB + shared + MAIN);

try {
  execFileSync("g++", ["-std=c++17", "-O1", "-o", binary, source], { stdio: "pipe" });
} catch (error) {
  const message = String(error.stderr ?? error.message);
  if (/not found|ENOENT/i.test(message)) {
    console.log("g++ не найден — сверку с прошивкой пропускаю (собрать её всё равно нечем).");
    process.exit(0);
  }
  console.error("Кусок прошивки не собрался:\n" + message);
  process.exit(1);
}
if (!existsSync(binary)) process.exit(1);

// ── случайные признаки ──

/** Свой генератор: сверка обязана повторяться от запуска к запуску. */
let seed = 20240501;
function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

const frames = [];
for (let i = 0; i < CASES; i += 1) {
  const bands = Array.from({ length: BANDS }, () => random() + 0.02);
  const total = bands.reduce((a, b) => a + b, 0);
  frames.push({
    rms: -80 + random() * 75,
    zcr: random() * 0.4,
    harmonic: random(),
    flatness: random(),
    spread: 0.5 + random() * 0.5,
    centroid: random(),
    tonal: random(),
    crest: random(),
    flux: random() * 0.5,
    attack: 0,
    bands: bands.map((v) => v / total),
  });
}

const input = frames
  .map((f) =>
    [f.rms, f.zcr, f.harmonic, f.flatness, f.spread, f.centroid, f.tonal, f.crest, f.flux]
      .map((v) => v.toFixed(6))
      .join(" ") + " " + f.bands.map((v) => v.toFixed(6)).join(" "),
  )
  .join("\n");

const board = execFileSync(binary, { input, encoding: "utf8" }).trim().split("\n");

// ── сравнение ──

let mismatched = 0;
let maxDrift = 0;

for (const [i, frame] of frames.entries()) {
  const site = topSoundClass(classify(summarise(Array.from({ length: 24 }, () => frame))));
  const [boardClass, boardConf] = board[i].split(" ");
  const drift = Math.abs(site.value - Number(boardConf));
  maxDrift = Math.max(maxDrift, drift);

  if (site.name !== boardClass || drift > 1) {
    mismatched += 1;
    if (mismatched <= 5) {
      console.log(
        `  ✗ случай ${i}: сайт «${site.name} ${site.value}%», плата «${boardClass} ${boardConf}%»\n` +
        `     rms=${frame.rms.toFixed(1)} harm=${frame.harmonic.toFixed(2)} ` +
        `flat=${frame.flatness.toFixed(2)} cen=${frame.centroid.toFixed(2)} crest=${frame.crest.toFixed(2)}`,
      );
    }
  }
}

if (mismatched > 0) {
  console.log(`\n✗ Разошлись на ${mismatched} случаях из ${CASES}.`);
  console.log("  Классификатор на плате и на сайте должен быть одним и тем же:");
  console.log("  правьте src/lib/audio/{window,classify}.ts и firmware/qorgau_sensor вместе.");
  process.exit(1);
}

console.log(`✓ Плата и сайт согласны на всех ${CASES} случаях (расхождение процентов ≤ ${maxDrift}).`);
