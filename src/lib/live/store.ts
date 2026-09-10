import type {
  Classification,
  DeviceStatus,
  ReadingSource,
  SoundClass,
} from "@/lib/types";

/**
 * Live state for the sensors, held in the Next process. Firestore keeps the
 * fleet roster; this keeps what the fleet is hearing right now, and pushes it
 * to every open browser over SSE.
 *
 * Deliberately in-memory: the demo needs zero setup and zero credentials, and
 * a reading is worthless thirty seconds after it happened anyway.
 */

export type { ReadingSource };

export interface LiveReading {
  deviceId: string;
  /** ms since epoch. */
  at: number;
  classification: Classification;
  top: SoundClass;
  topValue: number;
  status: DeviceStatus;
  /** Russian label for the winning class, or null when nothing stands out. */
  soundType: string | null;
  /** Traits that drove the decision, strongest first. */
  reasons: string[];
  /** dBFS, for the level meter. */
  rms: number;
  /** The 16 band energies, for the live spectrum strip. */
  bands: number[];
  source: ReadingSource;
  /** While this is in the future the device stays in `alert`. */
  alertUntil: number;
}

/** A gunshot lasts 200 ms. Hold the alert long enough to be seen. */
export const ALERT_HOLD_MS = 8000;

type Listener = (event: LiveEvent) => void;

export type LiveEvent =
  | { type: "reading"; reading: LiveReading }
  | { type: "snapshot"; readings: LiveReading[] };

interface LiveStore {
  readings: Map<string, LiveReading>;
  listeners: Set<Listener>;
}

/**
 * Held on globalThis because Next's dev server re-evaluates modules on every
 * hot reload — a module-level `const` would drop all subscribers mid-demo.
 */
const globalRef = globalThis as typeof globalThis & { __qorgauLive?: LiveStore };

function store(): LiveStore {
  if (!globalRef.__qorgauLive) {
    globalRef.__qorgauLive = { readings: new Map(), listeners: new Set() };
  }
  return globalRef.__qorgauLive;
}

export function publish(reading: LiveReading): void {
  const s = store();
  const previous = s.readings.get(reading.deviceId);
  const holding = previous !== undefined && previous.alertUntil > reading.at;

  let merged = reading;

  if (holding && previous) {
    const incomingAlerts = reading.alertUntil > reading.at;

    // Latch the verdict for the length of the hold. A gunshot is over in
    // 200 ms and the frames right behind it are silence, so without this the
    // panel would flip to "Другое 90%" a fifth of a second after the alert —
    // faster than anyone can look at it.
    //
    // A more confident alert still takes over, so across a burst of frames the
    // display converges on the loudest moment rather than the first one.
    const keepVerdict = !incomingAlerts || reading.topValue <= previous.topValue;

    merged = {
      ...reading,
      status: "alert",
      alertUntil: Math.max(previous.alertUntil, reading.alertUntil),
      // The spectrum and level freeze with the verdict: a flat, silent
      // spectrum sitting under "Выстрел 94%" reads as a contradiction. The
      // card describes the event until the hold expires.
      rms: keepVerdict ? previous.rms : reading.rms,
      bands: keepVerdict ? previous.bands : reading.bands,
      classification: keepVerdict ? previous.classification : reading.classification,
      top: keepVerdict ? previous.top : reading.top,
      topValue: keepVerdict ? previous.topValue : reading.topValue,
      soundType: keepVerdict ? previous.soundType : reading.soundType,
      reasons: keepVerdict ? previous.reasons : reading.reasons,
    };
  }

  s.readings.set(merged.deviceId, merged);

  for (const listener of s.listeners) {
    try {
      listener({ type: "reading", reading: merged });
    } catch {
      // A dead stream must not take the ingest path down with it.
    }
  }
}

export function snapshot(): LiveReading[] {
  return [...store().readings.values()];
}

export function subscribe(listener: Listener): () => void {
  const s = store();
  s.listeners.add(listener);
  return () => {
    s.listeners.delete(listener);
  };
}

export function listenerCount(): number {
  return store().listeners.size;
}

export function clearReadings(): void {
  store().readings.clear();
}
