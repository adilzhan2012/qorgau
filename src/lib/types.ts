export type DeviceStatus = "normal" | "alert";

/** The sound classes the classifier reports against. */
export const SOUND_CLASSES = [
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
  animal: "Животное",
  dog: "Собака",
  vehicle: "Транспорт",
  chainsaw: "Бензопила",
  gunshot: "Выстрел",
  other: "Другое",
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

export interface Device {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: DeviceStatus;
  /** Normalised from a Firestore Timestamp. Null when the field is missing. */
  lastSignal: Date | null;
  soundType: string | null;
  audioUrl: string | null;
  /** Percentage, 0–100. */
  battery: number;
  /** Null for devices whose documents predate the classification field. */
  classification: Classification | null;
  /** Present only while a sensor is feeding this device. */
  live?: LiveInfo | null;
}

export type DeviceFilter = "all" | "alert" | "normal";

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
