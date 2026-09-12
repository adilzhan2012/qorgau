import type { Features } from "@/lib/audio/features";
import { FRAME_SECONDS } from "@/lib/audio/window";
import { SOUND_CLASS_LABELS, type ReadingSource, type SoundClass } from "@/lib/types";

/**
 * Запись образца: то, что слышит датчик, с приклеенным ответом «что это было».
 *
 * Зачем это нужно. Пороги классификатора измерены на чужом корпусе полевых
 * записей — они лучше, чем на глаз, но это не ваш микрофон, не ваш лес и не
 * ваша комната. INMP441 на этой плате слышит иначе, чем микрофон, которым
 * записывали ESC-50: своя чувствительность, свой шум, своё положение.
 * Единственный способ довести точность до конца — записать образцы тем самым
 * железом, которое будет стоять в парке.
 *
 * Пишем не звук, а признаки — те самые 26 чисел на кадр, которые плата и так
 * шлёт сайту пятнадцать раз в секунду. Этого достаточно: классификатор видит
 * ровно их и ничего больше. Зато файл выходит в сотню килобайт вместо
 * мегабайтов, и его можно просто приложить к письму.
 *
 * Дальше файл уходит в `npm run eval -- --dir <папка>` наравне с wav-файлами
 * корпуса: пороги настраиваются по нему и измеряются на нём же.
 */

/** Сколько секунд писать. Три секунды — это ~47 кадров, два полных окна. */
export const RECORDING_SECONDS = 3;

/** Формат файла. Поднимать, если поменяется набор признаков. */
export const RECORDING_VERSION = 2;

export interface SampleRecording {
  version: number;
  /** Правильный ответ: что здесь на самом деле звучит. */
  label: SoundClass;
  /** То же по-русски — чтобы файл читался человеком. */
  labelRu: string;
  /** Откуда пришёл звук: плата, микрофон ноутбука, проигрывание файла. */
  source: ReadingSource;
  deviceId: string;
  /** Длительность кадра в секундах — на случай, если однажды поменяется. */
  frameSeconds: number;
  /** Когда записано, ms since epoch. */
  at: number;
  frames: Features[];
}

/**
 * Копит кадры, пока не наберётся нужная длительность. Один на запись.
 */
export class SampleRecorder {
  readonly label: SoundClass;
  readonly deviceId: string;
  readonly startedAt: number;
  private readonly wanted: number;
  private readonly collected: Features[] = [];
  private source: ReadingSource = "esp32";

  constructor(label: SoundClass, deviceId: string, seconds = RECORDING_SECONDS) {
    this.label = label;
    this.deviceId = deviceId;
    this.startedAt = Date.now();
    this.wanted = Math.max(1, Math.round(seconds / FRAME_SECONDS));
  }

  /** Добавляет кадр. Возвращает true, когда запись набралась. */
  push(features: Features, source: ReadingSource): boolean {
    this.source = source;
    this.collected.push(features);
    return this.collected.length >= this.wanted;
  }

  get frames(): number {
    return this.collected.length;
  }

  /** 0..1 — сколько уже записано, для полоски в интерфейсе. */
  get progress(): number {
    return Math.min(1, this.collected.length / this.wanted);
  }

  toRecording(): SampleRecording {
    return {
      version: RECORDING_VERSION,
      label: this.label,
      labelRu: SOUND_CLASS_LABELS[this.label],
      source: this.source,
      deviceId: this.deviceId,
      frameSeconds: FRAME_SECONDS,
      at: this.startedAt,
      frames: this.collected,
    };
  }
}

/**
 * Имя файла: класс, устройство и время. Класс первым, потому что именно по
 * нему проверка потом группирует записи, и потому что в списке файлов сразу
 * видно, чего записано мало.
 */
export function recordingFileName(recording: SampleRecording): string {
  const stamp = new Date(recording.at)
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-");
  return `${recording.label}-${recording.deviceId}-${stamp}.qorgau.json`;
}

/**
 * Отдаёт запись файлом. Сервера у сайта нет и не будет: файл собирается в
 * браузере и сохраняется как обычная загрузка.
 */
export function downloadRecording(recording: SampleRecording): void {
  const blob = new Blob([JSON.stringify(recording)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = recordingFileName(recording);
  document.body.append(link);
  link.click();
  link.remove();
  // Освобождаем не сразу: Safari успевает потерять ссылку, если отозвать её
  // в том же кадре.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
