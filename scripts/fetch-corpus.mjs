/**
 * Скачивает настоящие полевые записи для проверки распознавания.
 *
 *   npm run corpus            — ~10 записей на категорию (около 80 МБ)
 *   npm run corpus -- 20      — больше записей, дольше
 *
 * Берём ESC-50 (github.com/karoldvl/ESC-50, CC BY-NC 3.0) — 2000 записей по
 * 5 секунд, размеченных людьми. Это не наши синтезированные демо-файлы, а
 * реальный микрофон, реальные помехи и реальный разброс: настоящая собака
 * лает не так, как сумма шести синусов.
 *
 * Файлы ложатся в corpus/<класс>/… и в git не попадают (см. .gitignore) —
 * лицензия ESC-50 некоммерческая, и держать 80 МБ звука в репозитории ни к
 * чему. Скачали один раз — гоняйте `npm run eval -- --dir corpus`.
 *
 * Выстрелов в ESC-50 нет, ближайшее по звуку — фейерверк: те же короткие
 * широкополосные хлопки. Пока нет своих записей выстрелов, проверяем на нём,
 * и папка называется честно.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "corpus");
const META = "https://raw.githubusercontent.com/karoldvl/ESC-50/master/meta/esc50.csv";
const AUDIO = "https://raw.githubusercontent.com/karoldvl/ESC-50/master/audio/";

/** Категория ESC-50 → наша папка (имя папки и есть ожидаемый класс). */
const MAP = {
  dog: "dog",
  chainsaw: "chainsaw",
  engine: "vehicle-engine",
  fireworks: "gunshot-fireworks",
  chirping_birds: "animal-birds",
  crow: "animal-crow",
  hen: "animal-hen",
  frog: "animal-frog",
  insects: "animal-insects",
  crickets: "animal-crickets",
  rain: "nature-rain",
  wind: "nature-wind",
  thunderstorm: "nature-thunder",
  water_drops: "nature-drops",
  pouring_water: "nature-water",
  sea_waves: "nature-waves",
  crackling_fire: "nature-fire",
};

const perCategory = Number(process.argv[2]) || 10;

const csv = await (await fetch(META)).text();
const rows = csv.trim().split("\n").slice(1).map((line) => line.split(","));

/** Записи одной категории идут подряд — берём каждую n-ю, чтобы взять разные. */
const picked = [];
for (const [category, folder] of Object.entries(MAP)) {
  const all = rows.filter((r) => r[3] === category).map((r) => r[0]);
  const step = Math.max(1, Math.floor(all.length / perCategory));
  for (let i = 0; i < all.length && picked.filter((p) => p.folder === folder).length < perCategory; i += step) {
    picked.push({ folder, file: all[i] });
  }
}

console.log(`Качаю ${picked.length} записей в corpus/ …`);
let done = 0;
let skipped = 0;

// По четыре за раз: быстрее, но не выглядит как атака на raw.githubusercontent.
const queue = [...picked];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let item = queue.shift(); item; item = queue.shift()) {
    const dir = path.join(OUT, item.folder);
    const target = path.join(dir, item.file);
    if (existsSync(target)) { skipped += 1; continue; }

    const response = await fetch(AUDIO + item.file);
    if (!response.ok) {
      console.error(`  ✗ ${item.file}: ${response.status}`);
      continue;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(target, Buffer.from(await response.arrayBuffer()));
    done += 1;
    if (done % 20 === 0) console.log(`  … ${done}`);
  }
}));

console.log(`Готово: ${done} новых, ${skipped} уже были. Дальше: npm run eval -- --dir corpus`);
