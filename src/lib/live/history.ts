import {
  SOUND_CLASSES,
  type Classification,
  type ReadingSource,
  type SoundClass,
  type SoundEvent,
} from "@/lib/types";

/**
 * What survives a reload: the last thing each device said, and the alerts
 * worth remembering. Both live in localStorage next to the roster, so after
 * the page is reopened a card still reads "Бензопила 82% · 3 минуты назад"
 * instead of pretending the device has never spoken.
 */

const SUMMARY_KEY = "qorgau.readings.v1";
const EVENTS_KEY = "qorgau.events.v1";

/** Enough to remember every alert of a long demo, not enough to bloat storage. */
export const MAX_EVENTS = 300;

export interface ReadingSummary {
  at: number;
  classification: Classification;
  top: SoundClass;
  topValue: number;
  source: ReadingSource;
  battery: number | null;
}

export type SummaryMap = Record<string, ReadingSummary>;

const SOURCES: ReadonlySet<string> = new Set(["esp32", "mic", "sample"]);

function toClassification(raw: unknown): Classification | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  // A class added later is simply missing from older records: read as 0,
  // as long as the record has at least one real number in it.
  const out = {} as Classification;
  let present = false;
  for (const name of SOUND_CLASSES) {
    const n = Number(o[name]);
    if (Number.isFinite(n)) {
      out[name] = Math.max(0, Math.min(100, n));
      present = true;
    } else {
      out[name] = 0;
    }
  }
  return present ? out : null;
}

function isSoundClass(value: unknown): value is SoundClass {
  return typeof value === "string" && (SOUND_CLASSES as readonly string[]).includes(value);
}

function isSource(value: unknown): value is ReadingSource {
  return typeof value === "string" && SOURCES.has(value);
}

function read(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const text = window.localStorage.getItem(key);
    return text === null ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private mode — history is a convenience, never a blocker.
  }
}

export function loadSummaries(): SummaryMap {
  const raw = read(SUMMARY_KEY);
  if (!raw || typeof raw !== "object") return {};

  const out: SummaryMap = {};
  for (const [deviceId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const o = value as Record<string, unknown>;
    const classification = toClassification(o.classification);
    const at = Number(o.at);
    if (!classification || !Number.isFinite(at) || !isSoundClass(o.top)) continue;
    // Number(null) is 0, and 0% is a real reading; keep null as null.
    const battery = typeof o.battery === "number" && Number.isFinite(o.battery) ? o.battery : null;
    out[deviceId] = {
      at,
      classification,
      top: o.top,
      topValue: Number.isFinite(Number(o.topValue)) ? Number(o.topValue) : classification[o.top],
      source: isSource(o.source) ? o.source : "esp32",
      battery,
    };
  }
  return out;
}

export function saveSummaries(summaries: SummaryMap): void {
  write(SUMMARY_KEY, summaries);
}

export function loadEvents(): SoundEvent[] {
  const raw = read(EVENTS_KEY);
  if (!Array.isArray(raw)) return [];

  const out: SoundEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const at = Number(o.at);
    const value = Number(o.value);
    if (
      typeof o.id !== "string" ||
      typeof o.deviceId !== "string" ||
      !Number.isFinite(at) ||
      !Number.isFinite(value) ||
      !isSoundClass(o.sound)
    ) {
      continue;
    }
    out.push({
      id: o.id,
      deviceId: o.deviceId,
      at,
      sound: o.sound,
      value,
      source: isSource(o.source) ? o.source : "esp32",
      reasons: Array.isArray(o.reasons) ? o.reasons.filter((r) => typeof r === "string") : [],
    });
  }
  return out.slice(-MAX_EVENTS);
}

export function saveEvents(events: SoundEvent[]): void {
  write(EVENTS_KEY, events.slice(-MAX_EVENTS));
}
