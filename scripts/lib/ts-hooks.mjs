/**
 * Позволяет запускать модули сайта (TypeScript) прямо в Node — без сборки и
 * без единой зависимости. Node 22 сам умеет снимать типы с .ts; ему не хватает
 * только двух вещей, которые есть в tsconfig, но нет в спецификации ESM:
 *
 *   1. псевдоним "@/..." → src/...
 *   2. импорт без расширения ("./fft") → ./fft.ts
 *
 * Нужно это ради одного: офлайн-проверка (scripts/evaluate.mjs) обязана гонять
 * ТОТ ЖЕ код, что и браузер. Копия классификатора для тестов рано или поздно
 * разошлась бы с оригиналом, и проверка начала бы врать.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return nextResolve(withExtension(pathToFileURL(path.join(SRC, specifier.slice(2))).href), context);
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const parent = context.parentURL;
    if (parent && !path.extname(specifier)) {
      return nextResolve(withExtension(new URL(specifier, parent).href), context);
    }
  }
  return nextResolve(specifier, context);
}

/** Дописывает .ts (или .tsx), если файла без расширения нет. */
function withExtension(url) {
  const file = fileURLToPath(url);
  if (existsSync(file)) return url;
  for (const ext of [".ts", ".tsx", ".mjs", ".js"]) {
    if (existsSync(file + ext)) return url + ext;
  }
  return url;
}
