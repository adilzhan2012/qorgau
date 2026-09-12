import { classify, explain, isAlertClass } from "@/lib/audio/classify";
import type { Features } from "@/lib/audio/features";
import type { WindowFeatures } from "@/lib/audio/window";
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
   * needs the same vote several frames running: see `mergeReading`.
   */
  candidate: SoundClass | null;
  /** How many frames in a row have now voted for this same dangerous class. */
  streak: number;
}

/** A gunshot lasts 200 ms. Hold the alert long enough to be seen. */
export const ALERT_HOLD_MS = 8000;

/**
 * An alert needs a confident verdict, not merely a winning one — otherwise
 * room tone leaning 22% chainsaw would light up the map.
 */
const ALERT_THRESHOLD = 45;

/**
 * How many frames in a row have to agree before a verdict becomes an alert.
 * A frame is 64 ms, so four frames is a quarter of a second.
 *
 * The window already smooths the features, but the verdict can still flicker
 * for a single frame on the boundary where two classes come out nearly equal.
 * A single flickering frame is most of what a false alarm is made of, and
 * insisting on a steady one costs exactly these few frames of delay.
 */
const CONFIRM_FRAMES: Record<SoundClass, number> = {
  chainsaw: 8,
  vehicle: 8,
  dog: 5,
  gunshot: 4,
  nature: 0,
  animal: 0,
  other: 0,
};

/**
 * How much sound has to be in the window before a class may raise an alarm at
 * all. A saw and an engine last by their nature: under a second of them is not
 * yet them, it is the beginning of something. A shot lasts 200 ms and cannot
 * wait that long — but it is also the easiest to confirm, being the only one
 * that loud that briefly.
 */
const EVIDENCE_SECONDS: Record<SoundClass, number> = {
  chainsaw: 1.0,
  vehicle: 1.0,
  dog: 0.5,
  gunshot: 0.25,
  nature: 0,
  animal: 0,
  other: 0,
};

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
  window: WindowFeatures,
  battery: number | null = null,
  board: BoardOpinion | null = null,
  at: number = Date.now(),
): LiveReading {
  const classification = classify(window);
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
      streak: 0,
    };
  }

  const ownAlert =
    isAlertClass(top.name) &&
    top.value >= ALERT_THRESHOLD &&
    window.seconds >= EVIDENCE_SECONDS[top.name];
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
    reasons: explain(window, verdict),
    rms: features.rms,
    bands: features.bands,
    source,
    battery,
    alertUntil: 0,
    candidate: alerting ? verdict : null,
    streak: 0,
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

  // The run of identical votes. It resets the moment the verdict changes:
  // "three frames chainsaw, one frame nature, three frames chainsaw" is not a
  // chainsaw, it is a classifier that cannot make up its mind.
  const streak =
    incoming.candidate !== null && previous?.candidate === incoming.candidate
      ? previous.streak + 1
      : incoming.candidate !== null
        ? 1
        : 0;
  incoming = { ...incoming, streak };

  // A vote becomes an alert once it has held for its class's number of frames,
  // or while an alert is already latched and another frame of the same event
  // arrives. The firmware applies the same rule to its LED and `danger` flag.
  const confirmed =
    incoming.candidate !== null &&
    (holding || streak >= CONFIRM_FRAMES[incoming.candidate]);
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
