/**
 * Детектор человека в кадре.
 *
 * Камера подключается к ноутбуку и работает в браузере — как микрофон
 * ноутбука. К плате ESP32-S3 обычную USB-камеру подключить нельзя: у неё нет
 * ни USB-хоста с драйвером UVC, ни памяти под видео. Поэтому камера здесь —
 * это пост оператора, а не датчик в лесу; для леса нужна другая железка
 * (ESP32-CAM с модулем OV2640).
 *
 * Модель — COCO-SSD (lite_mobilenet_v2) на TensorFlow.js: восемьдесят классов,
 * из которых нас интересует один, `person`. Подгружается с CDN при первом
 * включении камеры, около восьми мегабайт; поэтому камере, в отличие от звука,
 * нужен интернет — и поэтому же в сборке сайта не появилось ни одной новой
 * зависимости.
 *
 * Снимки никуда не уходят. Кадры живут ровно столько, сколько нужно, чтобы их
 * посмотрела модель, и на диск не попадают: фотография узнаваемого человека —
 * это персональные данные, и хранить их «чтобы было» проекту незачем.
 */

/**
 * Два CDN на каждый скрипт: если первый не отвечает (бывает и у провайдера, и
 * в школьной сети), берётся второй. Версия закреплена мажорной, а не точной:
 * точную приходится угадывать, а мажорная гарантированно существует и не
 * принесёт несовместимых изменений.
 */
const TFJS = [
  "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4/dist/tf.min.js",
  "https://unpkg.com/@tensorflow/tfjs@4/dist/tf.min.js",
];
const MODEL = [
  "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2/dist/coco-ssd.min.js",
  "https://unpkg.com/@tensorflow-models/coco-ssd@2/dist/coco-ssd.min.js",
];

/** Рамка вокруг найденного человека, в пикселях кадра. */
export interface PersonBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Уверенность модели, 0..1. */
  score: number;
}

interface CocoPrediction {
  class: string;
  score: number;
  bbox: [number, number, number, number];
}

interface CocoModel {
  detect(input: HTMLVideoElement, maxNumBoxes?: number): Promise<CocoPrediction[]>;
}

interface CocoGlobal {
  load(config?: { base?: string }): Promise<CocoModel>;
}

/** Ниже этого модель слишком часто видит человека в шкафу и в дереве. */
export const PERSON_THRESHOLD = 0.6;

let loading: Promise<CocoModel> | null = null;

/**
 * Грузит модель один раз на страницу. Скрипты с CDN — тегом script, а не
 * пакетом: так сайт остаётся статикой без новых зависимостей в сборке.
 */
export function loadPersonDetector(): Promise<CocoModel> {
  loading ??= (async () => {
    await loadFirstThatWorks(TFJS);
    await loadFirstThatWorks(MODEL);
    const coco = (globalThis as unknown as { cocoSsd?: CocoGlobal }).cocoSsd;
    if (!coco) throw new Error("модель не загрузилась: проверьте интернет");
    // lite_mobilenet_v2 — самая лёгкая из трёх: восемь мегабайт против
    // двадцати семи, и на ноутбуке даёт несколько кадров в секунду.
    return coco.load({ base: "lite_mobilenet_v2" });
  })();
  return loading;
}

/** Пробует адреса по очереди и сдаётся только когда не осталось ни одного. */
async function loadFirstThatWorks(sources: string[]): Promise<void> {
  let last: unknown = null;
  for (const src of sources) {
    try {
      await loadScript(src);
      return;
    } catch (cause) {
      last = cause;
    }
  }
  throw last instanceof Error ? last : new Error("не загрузился ни один адрес модели");
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      // Уже грузится или загружен — ждём того же события.
      if (existing.dataset.ready === "1") resolve();
      else existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`не загрузился ${src}`)), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.addEventListener("load", () => {
      script.dataset.ready = "1";
      resolve();
    });
    script.addEventListener("error", () => reject(new Error(`не загрузился ${src}`)));
    document.head.append(script);
  });
}

/** Ищет людей в кадре. Пустой массив — никого нет. */
export async function detectPeople(
  model: CocoModel,
  video: HTMLVideoElement,
): Promise<PersonBox[]> {
  const predictions = await model.detect(video, 8);
  return predictions
    .filter((item) => item.class === "person" && item.score >= PERSON_THRESHOLD)
    .map((item) => ({
      x: item.bbox[0],
      y: item.bbox[1],
      width: item.bbox[2],
      height: item.bbox[3],
      score: item.score,
    }))
    .sort((a, b) => b.score - a.score);
}
