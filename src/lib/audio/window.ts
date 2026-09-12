import { BAND_COUNT, clamp01, type Features } from "./features";

/**
 * Полторы секунды памяти — то, чего классификатору не хватало больше всего.
 *
 * Кадр длится 64 мс. За 64 мс лай собаки, треск сучка, капля и первый слог
 * вороны выглядят почти одинаково: коротко, громко, широкополосно. Поэтому
 * решение по одному кадру и давало на настоящих записях больше ложных тревог,
 * чем верных ответов — 95 против 63 на первой же проверке корпусом.
 *
 * Человек в такой ситуации делает очевидное: слушает подольше. Бензопила —
 * это ровный звук, который не прекращается; лай — это несколько отдельных
 * выкриков с паузами; выстрел — одиночный хлопок на фоне тишины. Разница не в
 * спектре одного мгновения, а в том, как звук ведёт себя во времени.
 *
 * Здесь копятся последние 24 кадра и из них считаются признаки, которых у
 * отдельного кадра просто нет: ровность, доля громкого времени, перепад
 * громкости, число резких начал. Классификатор смотрит только на них.
 *
 * Ритм (автокорреляция огибающей: «лай-пауза-лай») здесь был и был убран —
 * на настоящих записях он не разделял классы, а не разделяющий признак ничем
 * не лучше случайного числа. Проверить можно: npm run eval -- --dump.
 */

/** 24 кадра по 64 мс. Дольше — надёжнее, но тревога приходит позже. */
export const WINDOW_FRAMES = 24;

/** Длительность кадра в секундах — одна и та же у платы и у браузера. */
export const FRAME_SECONDS = 0.064;

/** Ниже этого уровня считаем, что события нет — это фон. */
export const SILENCE_DB = -58;

export interface WindowFeatures {
  /** Сколько звука накоплено, в секундах. Меньше ~0.4 — выводы ненадёжны. */
  seconds: number;

  /** Уровень окна по энергии, дБFS: громкие кадры весят больше тихих. */
  rms: number;
  /** Самый громкий кадр окна, дБFS. */
  peak: number;
  /** Тихий фон окна (20-й перцентиль), дБFS. */
  floor: number;
  /** Насколько пик поднялся над фоном, 0..1 (30 дБ = 1). */
  levelSpan: number;
  /**
   * Какую долю окна звук держится у своего максимума (не тише пика на 12 дБ).
   * У мотора и дождя — единица: они не прекращаются. У лая — около трети:
   * выкрик, пауза, выкрик. У выстрела — пара кадров из двадцати четырёх.
   */
  duty: number;

  /** Резких начал в секунду, 0..1 (пять и больше = 1). */
  onsets: number;
  /** Самый резкий подъём громкости в окне, 0..1 (24 дБ = 1). */
  attack: number;
  /** Насколько неподвижен спектр, 0..1. Мотор ~1, птица ~0. */
  steady: number;
  /** Средний профиль спектра по энергии, сумма 1. */
  bands: number[];
  /** Доля самой сильной полосы: узкий тон против широкого шума. */
  bandPeak: number;

  /** Средние по энергии за окно — те же признаки, но устойчивые. */
  zcr: number;
  harmonic: number;
  flatness: number;
  spread: number;
  centroid: number;
  tonal: number;

  /**
   * Пик к среднему у самого громкого кадра окна, 0..1.
   *
   * Именно у самого громкого, а не максимум по всем: у кадра, на границу
   * которого попал самый край звука, пик к среднему всегда огромен — там одна
   * миллисекунда сигнала на шестьдесят три миллисекунды фона. Это свойство
   * нарезки на кадры, а не звука.
   */
  crest: number;
}

/**
 * Кольцевой буфер кадров. По одному на источник звука (микрофон, файл,
 * каждая плата) — ровно как FeatureExtractor.
 */
export class ListeningWindow {
  private readonly frames: Features[] = [];

  reset(): void {
    this.frames.length = 0;
  }

  /** Добавляет кадр и возвращает признаки всего окна. */
  push(features: Features): WindowFeatures {
    this.frames.push(features);
    if (this.frames.length > WINDOW_FRAMES) this.frames.shift();
    return summarise(this.frames);
  }

  /** Сколько секунд звука уже накоплено. */
  get seconds(): number {
    return this.frames.length * FRAME_SECONDS;
  }
}

/** Признаки окна из готового списка кадров. Чистая функция — её и тестируем. */
export function summarise(frames: readonly Features[]): WindowFeatures {
  const levels = frames.map((f) => f.rms);
  const peak = Math.max(...levels);
  const floor = percentile(levels, 0.2);

  // Вес кадра — его энергия. Иначе тишина между двумя выкриками размажет
  // спектр лая в шум: паузы занимают больше времени, чем сам лай.
  const weights = frames.map((f) => Math.pow(10, f.rms / 10));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const mean = (pick: (f: Features) => number) =>
    frames.reduce((sum, f, i) => sum + pick(f) * weights[i], 0) / totalWeight;

  const bands = new Array<number>(BAND_COUNT).fill(0);
  for (let i = 0; i < frames.length; i += 1) {
    for (let b = 0; b < BAND_COUNT; b += 1) bands[b] += frames[i].bands[b] * weights[i];
  }
  const bandTotal = bands.reduce((a, b) => a + b, 0) || 1;
  for (let b = 0; b < BAND_COUNT; b += 1) bands[b] /= bandTotal;

  const loudEnough = levels.filter((db) => db > peak - 12).length;
  const seconds = frames.length * FRAME_SECONDS;

  // Подъём громкости считаем по самому окну, а не берём `attack` кадра.
  // У кадра память короткая и своя: в записи, которая начинается сразу с
  // лая, первым кадрам не с чем сравнивать, и самый громкий лай в корпусе
  // получал attack = 0 — «резких начал нет», хотя ничего резче в файле и нет.
  let steepest = 0;
  let onsetCount = 0;
  for (let i = 1; i < levels.length; i += 1) {
    let before = levels[i - 1];
    for (let back = 2; back <= 4 && i - back >= 0; back += 1) {
      before = Math.min(before, levels[i - back]);
    }
    const rise = levels[i] - before;
    if (rise > steepest) steepest = rise;
    if (rise > 14 && levels[i] > floor + 8) onsetCount += 1;
  }

  return {
    seconds,
    rms: 10 * Math.log10(totalWeight / frames.length),
    peak,
    floor,
    levelSpan: clamp01((peak - floor) / 30),
    duty: loudEnough / frames.length,
    onsets: clamp01(onsetCount / seconds / 5),
    attack: clamp01(steepest / 24),
    // Поток спектра у мотора ~0.05, у поющей птицы ~0.3: растягиваем втрое,
    // иначе «ровно» и «неровно» отличались бы третьим знаком после запятой.
    steady: clamp01(1 - mean((f) => f.flux) * 3),
    bands,
    bandPeak: Math.max(...bands),
    zcr: mean((f) => f.zcr),
    harmonic: mean((f) => f.harmonic),
    flatness: mean((f) => f.flatness),
    spread: mean((f) => f.spread),
    centroid: mean((f) => f.centroid),
    tonal: mean((f) => f.tonal),
    crest: frames.reduce((best, f) => (f.rms > best.rms ? f : best), frames[0]).crest,
  };
}

function percentile(values: number[], at: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * at)));
  return sorted[index];
}
