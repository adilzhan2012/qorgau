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
  /**
   * The dangerous class this one frame voted for, confirmed or not. An alert
   * needs two frames in a row: see `mergeReading`.
   */
  candidate: SoundClass | null;
}

/** A gunshot lasts 200 ms. Hold the alert long enough to be seen. */
export const ALERT_HOLD_MS = 8000;



/**
 * An alert needs a confident verdict, not merely a winning one — otherwise
 * room tone leaning 22% chainsaw would light up the map.
 */
const ALERT_THRESHOLD = 40;

/** What the board decided on its own, when its firmware classifies. */
export interface BoardOpinion {
  top: SoundClass;
  conf: number;
  danger: boolean;
}

/**
 * Classifies one frame of features into a reading.
 *
 * The board's own verdict, when it sends one, can raise an alert by itself:
 * in the field that flag is all a LoRa packet carries, so the site must act
 * on it even if its own copy of the classifier is a shade less sure.
 */
export function makeReading(
  deviceId: string,
  source: ReadingSource,
  features: Features,
  battery: number | null = null,
  board: BoardOpinion | null = null,
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
      candidate: null,
    };
  }

  const ownAlert = isAlertClass(top.name) && top.value >= ALERT_THRESHOLD;
  const boardAlert = board !== null && board.danger && isAlertClass(board.top);
  const alerting = ownAlert || boardAlert;

  // The site's own verdict when it alerts; otherwise the board's.
  const verdict = ownAlert || !boardAlert ? top.name : board.top;
  const verdictValue = ownAlert || !boardAlert ? top.value : board.conf;

  return {
    deviceId,
    at,
    classification,
    top: verdict,
    topValue: verdictValue,
    // Provisional: `mergeReading` promotes it to an alert once a second frame agrees.
    status: "online",
    soundType: null,
    reasons: explain(features, verdict),
    rms: features.rms,
    bands: features.bands,
    source,
    battery,
    alertUntil: 0,
    candidate: alerting ? verdict : null,
  };
}

/** The reading as an alert: latched, labelled, held. */
function promote(reading: LiveReading, at: number): LiveReading {
  return {
    ...reading,
    status: "alert",
    soundType: SOUND_CLASS_LABELS[reading.top],
    alertUntil: at + ALERT_HOLD_MS,
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

  // A candidate becomes an alert when the previous frame voted the same way,
  // or while an alert is already latched (a louder frame of the same event).
  // Frames are 64 ms: a gunshot's crack, a bark, an engine all span several,
  // while a single loud frame is a click, a door, a bird starting mid-frame.
  // Two agreeing frames is the cheapest filter that tells them apart; the
  // firmware applies the same rule to its LED and its `danger` flag.
  const confirmed =
    incoming.candidate !== null &&
    previous !== undefined &&
    (holding || previous.candidate === incoming.candidate);
  if (confirmed) incoming = promote(incoming, incoming.at);

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
