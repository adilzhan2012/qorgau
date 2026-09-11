import { classify, explain, isAlertClass } from "@/lib/audio/classify";
import type { Features } from "@/lib/audio/features";
import {
  SOUND_CLASS_LABELS,
  topSoundClass,
  type Classification,
  type DeviceStatus,
  type ReadingSource,
  type SoundClass,
} from "@/lib/types";

/**
 * Turning sound into a verdict, and holding that verdict long enough to be
 * seen. Pure functions with no server or browser APIs, so the same code runs
 * wherever the sound arrives from.
 *
 * This used to live behind /api/ingest and an in-memory store on the server.
 * It moved here so the site can be published as static files and opened from a
 * URL with nothing installed — which is what the demo actually needs.
 */

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
  /** Percentage the board reported alongside the frame, if it has a battery. */
  battery: number | null;
  /** While this is in the future the device stays in `alert`. */
  alertUntil: number;
}

/** A gunshot lasts 200 ms. Hold the alert long enough to be seen. */
export const ALERT_HOLD_MS = 8000;

/**
 * An alert needs a confident verdict, not merely a winning one — otherwise
 * room tone leaning 22% chainsaw would light up the map.
 */
const ALERT_THRESHOLD = 40;

/** Classifies one frame of features into a reading. */
export function makeReading(
  deviceId: string,
  source: ReadingSource,
  features: Features,
  battery: number | null = null,
  at: number = Date.now(),
): LiveReading {
  const classification = classify(features);
  const top = topSoundClass(classification);

  // topSoundClass only returns null for a null classification, which classify()
  // never produces — but the type says otherwise, so handle it honestly.
  if (!top) {
    return {
      deviceId,
      at,
      classification,
      top: "other",
      topValue: 0,
      status: "online",
      soundType: null,
      reasons: [],
      rms: features.rms,
      bands: features.bands,
      source,
      battery,
      alertUntil: 0,
    };
  }

  const alerting = isAlertClass(top.name) && top.value >= ALERT_THRESHOLD;

  return {
    deviceId,
    at,
    classification,
    top: top.name,
    topValue: top.value,
    status: alerting ? "alert" : "online",
    soundType: alerting ? SOUND_CLASS_LABELS[top.name] : null,
    reasons: explain(features, top.name),
    rms: features.rms,
    bands: features.bands,
    source,
    battery,
    alertUntil: alerting ? at + ALERT_HOLD_MS : 0,
  };
}

/**
 * Folds a new reading into the previous one for the same device.
 *
 * The whole point is the latch. A gunshot is over in 200 ms and the frames
 * right behind it are silence, so without holding the verdict the panel would
 * flip to "Другое 90%" a fifth of a second after the alert — faster than
 * anyone can look at it. A more confident alert still takes over, so across a
 * burst of frames the display converges on the loudest moment rather than the
 * first one.
 */
export function mergeReading(
  previous: LiveReading | undefined,
  incoming: LiveReading,
): LiveReading {
  const holding = previous !== undefined && previous.alertUntil > incoming.at;
  if (!holding || !previous) {
    // A board without a battery sensor says nothing about it; keep the last
    // figure it did report rather than flickering to "unknown".
    return incoming.battery === null && previous
      ? { ...incoming, battery: previous.battery }
      : incoming;
  }

  const incomingAlerts = incoming.alertUntil > incoming.at;
  const keepVerdict = !incomingAlerts || incoming.topValue <= previous.topValue;

  return {
    ...incoming,
    battery: incoming.battery ?? previous.battery,
    status: "alert",
    alertUntil: Math.max(previous.alertUntil, incoming.alertUntil),
    // The spectrum and level freeze with the verdict: a flat, silent spectrum
    // sitting under "Выстрел 94%" reads as a contradiction. The card describes
    // the event until the hold expires.
    rms: keepVerdict ? previous.rms : incoming.rms,
    bands: keepVerdict ? previous.bands : incoming.bands,
    classification: keepVerdict ? previous.classification : incoming.classification,
    top: keepVerdict ? previous.top : incoming.top,
    topValue: keepVerdict ? previous.topValue : incoming.topValue,
    soundType: keepVerdict ? previous.soundType : incoming.soundType,
    reasons: keepVerdict ? previous.reasons : incoming.reasons,
  };
}
