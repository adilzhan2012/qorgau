/**
 * Синтезирует демонстрационные звуки в public/audio/.
 *
 *   npm run audio
 *
 * Это подстраховка, а не цель: положите в ту же папку настоящие записи, и они
 * появятся на сайте кнопками. Существующие файлы не перезаписываются, так что
 * ваш gunshot.wav всегда побеждает синтезированный.
 *
 * Сигналы берутся из src/lib/audio/testSignals.ts — оттуда же, откуда их берёт
 * страница /selftest. Раньше синтез был написан здесь второй раз, и две копии
 * успели разойтись: на странице лай звучал иначе, чем в файле, а значит
 * «проверка классификатора» проверяла не то, что слышит посетитель.
 *
 * Скрипт также пишет public/audio/samples.json — список, по которому сайт
 * строит кнопки. Сайт публикуется статикой, сервера, который просканировал бы
 * папку, нет: сканируем здесь.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./lib/ts-hooks.mjs", import.meta.url);

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "audio");

const { TEST_CASES, TEST_RATE } = await import("@/lib/audio/testSignals");
const { SOUND_CLASS_LABELS } = await import("@/lib/types");

/** Кадров в демонстрационном файле: 47 × 64 мс — три секунды. */
const FRAMES = 47;

/** 16-битный моно PCM WAV. Зависимостей не нужно — заголовок в 44 байта. */
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
  header.writeUInt32LE(16, 16); // размер блока fmt
  header.writeUInt16LE(1, 20); // формат: PCM
  header.writeUInt16LE(1, 22); // каналов: 1
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); // байт в секунду
  header.writeUInt16LE(2, 32); // байт на кадр
  header.writeUInt16LE(16, 34); // бит на отсчёт
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
for (const { file, name, build } of TEST_CASES) {
  const target = path.join(OUT_DIR, file);
  if (existsSync(target)) {
    console.log(`· ${file} — уже есть, не трогаю`);
    continue;
  }

  writeFileSync(target, toWav(build(FRAMES), TEST_RATE));
  written += 1;
  console.log(`✓ ${file} — ${name}`);
}

/**
 * Ключевое слово в имени файла → класс. Чтобы добавить свой звук, достаточно
 * положить `gunshot-01.wav` или `лай собаки.mp3` в ту же папку.
 */
const HINTS = [
  [/gun|shot|shoot|rifle|выстрел|ружь|стрель/i, "gunshot"],
  [/dog|bark|лай|собак|пёс|пес/i, "dog"],
  [/chain|saw|пила|бензо|пил/i, "chainsaw"],
  [/car|truck|engine|vehicle|мотор|машин|транспорт|двигат/i, "vehicle"],
  [/bird|animal|wolf|птиц|животн|волк|зверь/i, "animal"],
  [/leaves|leaf|wind|water|river|rain|nature|листв|ветер|вод|дожд|природ|ambient|forest|лес/i, "nature"],
  [/quiet|silence|фон|тишин/i, "other"],
];

const AUDIO_EXTENSIONS = [".wav", ".mp3", ".ogg", ".m4a", ".flac", ".aac", ".webm"];

const samples = readdirSync(OUT_DIR)
  .filter((file) => AUDIO_EXTENSIONS.includes(path.extname(file).toLowerCase()))
  .sort((a, b) => a.localeCompare(b, "ru"))
  .map((file) => {
    const expected = HINTS.find(([pattern]) => pattern.test(file))?.[1] ?? null;
    const builtin = TEST_CASES.find((item) => item.file === file);
    return {
      // Только имя файла: префикс сайт добавляет сам, потому что на GitHub
      // Pages всё живёт под /qorgau/, а не в корне.
      file,
      name: path.basename(file, path.extname(file)),
      // Подпись кнопки: у встроенных сигналов своя, у принесённого файла —
      // класс, а если имя ни о чём не говорит, то само имя файла.
      title: builtin ? capitalise(builtin.name) : null,
      expected,
      expectedLabel: expected ? SOUND_CLASS_LABELS[expected] : null,
    };
  });

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

writeFileSync(
  path.join(OUT_DIR, "samples.json"),
  JSON.stringify(samples, null, 2) + "\n",
);

console.log(
  written > 0
    ? `\nГотово: ${written} новых файл(ов) в public/audio/`
    : "\nВсе звуки уже на месте.",
);
console.log(`Список samples.json обновлён: ${samples.length} звук(ов).`);
console.log("Свои записи кладите туда же и запускайте `npm run audio` заново.");
