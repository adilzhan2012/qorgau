import type { Features } from "./features";
import { getSensorContext, runSensor, type SensorHandle } from "./sensor";

/**
 * The two browser-side sound sources: the laptop microphone, and playback of a
 * file from public/audio. Both hand their audio to `runSensor`, so nothing
 * downstream can tell them apart from the ESP32 — same features, same path.
 */

export interface SourceHandle extends SensorHandle {
  /** Resolves when the source finishes on its own. Never, for the microphone. */
  readonly done: Promise<void>;
}

/**
 * Opens the microphone and starts reporting. Browser processing is turned off:
 * noise suppression and AGC are built to erase exactly the transients we are
 * trying to detect.
 */
export async function startMicrophone(
  deviceId: string,
  onFeatures: (features: Features) => void,
): Promise<SourceHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  const context = await getSensorContext();
  const node = context.createMediaStreamSource(stream);
  const sensor = runSensor(context, node, { deviceId, source: "mic", onFeatures });

  let stopped = false;
  return {
    done: new Promise<void>(() => {}),
    stop() {
      if (stopped) return;
      stopped = true;
      sensor.stop();
      node.disconnect();
      for (const track of stream.getTracks()) track.stop();
      // The context is shared and stays open for the next source.
    },
  };
}

/**
 * Plays a file through the speakers and analyses it at the same time, so what
 * the room hears and what the site classifies are the same signal.
 */
export async function playSample(
  url: string,
  deviceId: string,
  onFeatures: (features: Features) => void,
): Promise<SourceHandle> {
  const context = await getSensorContext();

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Не удалось загрузить ${url}: ${response.status}`);
  }
  const buffer = await context.decodeAudioData(await response.arrayBuffer());

  const node = context.createBufferSource();
  node.buffer = buffer;
  node.connect(context.destination);

  const sensor = runSensor(context, node, { deviceId, source: "sample", onFeatures });

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    sensor.stop();
    try {
      node.stop();
    } catch {
      // Already ended.
    }
    node.disconnect();
  };

  const done = new Promise<void>((resolve) => {
    node.onended = () => {
      stop();
      resolve();
    };
  });

  node.start();
  return { done, stop };
}
