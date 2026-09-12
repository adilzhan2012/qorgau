import { FeatureExtractor, type Features } from "./features";
import type { ReadingSource } from "@/lib/types";

/**
 * Превращает любой узел Web Audio в датчик: тянет кадры, считает те же
 * признаки, что шлёт ESP32, и отдаёт их в `onFeatures`. Микрофон ноутбука и
 * проигрывание файла идут через одно и то же место, поэтому дальше по цепочке
 * их не отличить от платы.
 */

/**
 * Прошивка пишет звук на 16 кГц, и признаки считаются на этой же частоте:
 * полосы в features.ts кончаются на 8 кГц, и совпадение частоты делает
 * одинаковыми сами корзины БПФ по обе стороны.
 */
export const SENSOR_RATE = 16000;
export const FRAME_SAMPLES = 1024;

/** ~15 показаний в секунду: выглядит живым и стоит дёшево. */
const FRAME_MS = 64;

export interface SensorHandle {
  stop(): void;
}

export interface SensorOptions {
  deviceId: string;
  source: ReadingSource;
  /** Получает каждый кадр. Так показания и попадают в приложение. */
  onFeatures: (features: Features) => void;
}

/**
 * Один AudioContext на всю страницу, на СОБСТВЕННОЙ частоте звуковой карты.
 *
 * Раньше он создавался с `sampleRate: 16000`, чтобы браузер сам пересчитывал
 * микрофон на частоту платы. Красиво и не работает: на части машин Chrome в
 * ответ на контекст с чужой для устройства частотой отдаёт с микрофона нули.
 * Значок захвата в адресной строке горит, кадры идут, а уровень стоит на
 * −100 дБ — сайт «слушает» и не слышит ничего. Ни ошибки, ни исключения.
 *
 * Поэтому частоту больше не навязываем, а пересчитываем сами — в `runSensor`.
 * Признаки от этого не меняются: они по-прежнему считаются на 16 кГц.
 *
 * Контекст общий, а не по одному на проигрывание: браузеры ограничивают их
 * число (Chrome — примерно шестью), и демонстрация, где каждая кнопка открывает
 * новый, замолкает после десятка нажатий — молча, без ошибки.
 */
let sharedContext: AudioContext | null = null;

export async function getSensorContext(): Promise<AudioContext> {
  if (!sharedContext || sharedContext.state === "closed") {
    const Ctor: typeof AudioContext =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedContext = new Ctor();
  }
  // Политика автозапуска держит контекст остановленным до жеста пользователя.
  if (sharedContext.state === "suspended") await sharedContext.resume();
  return sharedContext;
}

export function runSensor(
  context: AudioContext,
  node: AudioNode,
  options: SensorOptions,
): SensorHandle {
  const rate = context.sampleRate;
  // Сколько отсчётов исходной частоты укладывается в кадр 16 кГц: на 48 кГц
  // это 3072 отсчёта на те же 64 мс.
  const sourceSamples = Math.max(FRAME_SAMPLES, Math.round((FRAME_SAMPLES * rate) / SENSOR_RATE));

  const analyser = context.createAnalyser();
  // Окно анализатора — степень двойки, не меньше кадра: берём из него самые
  // свежие `sourceSamples` отсчётов.
  analyser.fftSize = Math.min(32768, nextPowerOfTwo(sourceSamples * 2));
  analyser.smoothingTimeConstant = 0;
  node.connect(analyser);

  const window = new Float32Array(analyser.fftSize);
  const frame = new Float32Array(FRAME_SAMPLES);
  const extractor = new FeatureExtractor(SENSOR_RATE);

  let stopped = false;

  const tick = () => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(window);
    resampleInto(window.subarray(window.length - sourceSamples), frame);
    options.onFeatures(extractor.extract(frame));
  };

  const timer = window_setInterval(tick, FRAME_MS);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      try {
        node.disconnect(analyser);
      } catch {
        // Уже разобрано.
      }
    },
  };
}

/**
 * Пересчёт на 16 кГц усреднением: каждый отсчёт результата — среднее тех
 * исходных, что в него попали.
 *
 * Не просто «брать каждый третий»: выбрасывание отсчётов заворачивает всё, что
 * выше 8 кГц, обратно в слышимую полосу, и шипение с ключей превращается в
 * призрачный тон посреди спектра. Усреднение — это заодно и фильтр.
 */
function resampleInto(source: Float32Array, target: Float32Array): void {
  const step = source.length / target.length;
  for (let i = 0; i < target.length; i += 1) {
    const from = Math.floor(i * step);
    const to = Math.min(source.length, Math.max(from + 1, Math.floor((i + 1) * step)));
    let sum = 0;
    for (let j = from; j < to; j += 1) sum += source[j];
    target[i] = sum / (to - from);
  }
}

function nextPowerOfTwo(value: number): number {
  let size = 32;
  while (size < value) size *= 2;
  return size;
}

/** Названа так, чтобы локальный Float32Array `window` не заслонил глобальный. */
function window_setInterval(fn: () => void, ms: number): number {
  return globalThis.setInterval(fn, ms) as unknown as number;
}
