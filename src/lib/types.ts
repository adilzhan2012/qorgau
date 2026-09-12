/**
 * A device is in `alert` while a verdict is latched, `online` while something
 * is actually feeding it sound, and `offline` the rest of the time. Nothing
 * here is assumed: a device that has never reported is offline.
 */
export type DeviceStatus = "alert" | "online" | "offline";

/** The sound classes the classifier reports against. */
export const SOUND_CLASSES = [
  "nature",
  "animal",
  "dog",
  "vehicle",
  "chainsaw",
  "gunshot",
  "other",
] as const;

export type SoundClass = (typeof SOUND_CLASSES)[number];

/** Confidence per sound class, as percentages that sum to roughly 100. */
export type Classification = Record<SoundClass, number>;

export const SOUND_CLASS_LABELS: Record<SoundClass, string> = {
  nature: "Природа",
  animal: "Птицы, звери",
  dog: "Собака",
  vehicle: "Транспорт",
  chainsaw: "Бензопила",
  gunshot: "Выстрел",
  other: "Тишина",
};

/** A word more about each class, for tooltips and the about page. */
export const SOUND_CLASS_HINTS: Record<SoundClass, string> = {
  nature: "листва, ветер, вода, дождь",
  animal: "птичье пение, крики зверей",
  dog: "лай — рядом человек",
  vehicle: "двигатель машины, мотоцикла",
  chainsaw: "бензопила, незаконная рубка",
  gunshot: "выстрел, браконьеры",
  other: "фон, ничего заметного",
};

/**
 * What a class means for the park. The site alerts on danger; the board sends
 * the same flag so a LoRa packet of a few bytes is enough to raise the alarm.
 */
export type Safety = "safe" | "danger";

export const SOUND_SAFETY: Record<SoundClass, Safety> = {
  nature: "safe",
  animal: "safe",
  other: "safe",
  dog: "danger",
  vehicle: "danger",
  chainsaw: "danger",
  gunshot: "danger",
};

export const SAFETY_LABELS: Record<Safety, string> = {
  safe: "безопасно",
  danger: "опасно",
};

/** Where a reading came from. */
export type ReadingSource = "esp32" | "mic" | "sample";

export const SOURCE_LABELS: Record<ReadingSource, string> = {
  esp32: "ESP32 · INMP441",
  mic: "микрофон ноутбука",
  sample: "проигрывание файла",
};

/** What a device is hearing right now, when something is listening. */
export interface LiveInfo {
  /** ms since epoch. */
  at: number;
  /** Traits that drove the verdict, strongest first. */
  reasons: string[];
  /** dBFS, for the level meter. */
  rms: number;
  /** The 16 band energies, for the live spectrum strip. */
  bands: number[];
  source: ReadingSource;
}

/**
 * What the user actually entered about a device. This is what gets persisted;
 * everything else on `Device` is derived from live readings.
 */
export interface DeviceRecord {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** ms since epoch. */
  createdAt: number;
  /** How the record came to exist. Boards announce themselves; people type. */
  origin: "manual" | "board";
  /**
   * Take the position from the board's GPS whenever it has a fix. On by
   * default for devices a board created — their initial spot was arbitrary.
   */
  followGps: boolean;
}

export interface Device extends DeviceRecord {
  status: DeviceStatus;
  /** Null until the device has reported at least once. */
  lastSignal: Date | null;
  /** Russian label for the latched alert, or null. */
  soundType: string | null;
  /** Percentage, 0–100, or null when the device has never reported one. */
  battery: number | null;
  /** Null until the device has reported at least once. */
  classification: Classification | null;
  /** Present only while a sensor is feeding this device. */
  live?: LiveInfo | null;
  /** Where the last reading came from, even after the sensor stopped. */
  lastSource: ReadingSource | null;
}

export type DeviceFilter = "all" | "alert" | "online" | "offline";

/** An alert worth remembering: what, where, how sure, from which source. */
export interface SoundEvent {
  id: string;
  deviceId: string;
  /** ms since epoch. */
  at: number;
  sound: SoundClass;
  /** 0–100. */
  value: number;
  source: ReadingSource;
  reasons: string[];
}

/** The class the model is most confident about, or null without a breakdown. */
export function topSoundClass(
  classification: Classification | null,
): { name: SoundClass; value: number } | null {
  if (!classification) return null;

  let best: { name: SoundClass; value: number } | null = null;
  for (const name of SOUND_CLASSES) {
    const value = classification[name];
    if (!best || value > best.value) best = { name, value };
  }
  return best;
}
