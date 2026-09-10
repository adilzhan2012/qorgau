import { FeatureExtractor, type Features } from "./features";
import type { ReadingSource } from "@/lib/types";

/**
 * Turns any Web Audio node into a sensor: pulls frames, extracts the same
 * features the ESP32 sends, and hands them to `onFeatures`. The microphone and
 * the sample player both run through here, so all three sources are literally
 * the same pipeline.
 */

/**
 * The firmware samples at 16 kHz, so the browser does too — the band edges in
 * features.ts only reach 8 kHz, and matching the rate keeps the FFT bins
 * identical on both sides.
 */
export const SENSOR_RATE = 16000;
export const FRAME_SAMPLES = 1024;

/** ~15 readings a second: fast enough to look live, light enough to be free. */
const FRAME_MS = 64;

export interface SensorHandle {
  stop(): void;
}

export interface SensorOptions {
  deviceId: string;
  source: ReadingSource;
  /** Receives every frame. This is how readings reach the app. */
  onFeatures: (features: Features) => void;
}

/**
 * One AudioContext for the whole page, locked to 16 kHz so the browser
 * resamples the microphone and the sample files onto the firmware's rate.
 *
 * Shared rather than created per playback: browsers cap how many contexts a
 * page may hold (Chrome allows about six), and a demo where every button press
 * opens another one goes silent after a handful of clicks — with no error, the
 * audio simply stops arriving.
 */
let sharedContext: AudioContext | null = null;

export async function getSensorContext(): Promise<AudioContext> {
  if (!sharedContext || sharedContext.state === "closed") {
    const Ctor: typeof AudioContext =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedContext = new Ctor({ sampleRate: SENSOR_RATE });
  }
  // Autoplay policy starts it suspended until a user gesture resumes it.
  if (sharedContext.state === "suspended") await sharedContext.resume();
  return sharedContext;
}

export function runSensor(
  context: AudioContext,
  node: AudioNode,
  options: SensorOptions,
): SensorHandle {
  const analyser = context.createAnalyser();
  // 2048 at 16 kHz is a 128 ms window; we read the newest 1024 of it.
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  node.connect(analyser);

  const window = new Float32Array(analyser.fftSize);
  const frame = new Float32Array(FRAME_SAMPLES);
  const extractor = new FeatureExtractor(SENSOR_RATE);

  let stopped = false;

  const tick = () => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(window);
    frame.set(window.subarray(window.length - FRAME_SAMPLES));

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
        // Already torn down.
      }
    },
  };
}

/** Named so the local `window` Float32Array above cannot shadow the global. */
function window_setInterval(fn: () => void, ms: number): number {
  return globalThis.setInterval(fn, ms) as unknown as number;
}
