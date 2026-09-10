import { parseFeatures, type Features } from "./features";

/**
 * Reads the ESP32 over USB straight from the page, using Web Serial.
 *
 * The obvious alternative — the `serialport` npm package and a Node bridge —
 * needs a native build, and on Node 24 + Windows that can mean installing
 * Visual Studio build tools. Web Serial ships inside Chrome and Edge, needs no
 * install at all, and removes a whole process from the demo.
 */

/** Minimal Web Serial typings — not in TypeScript's DOM lib yet. */
interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}

interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
}

function serial(): SerialLike | null {
  const nav = navigator as Navigator & { serial?: SerialLike };
  return nav.serial ?? null;
}

export function isSerialSupported(): boolean {
  return serial() !== null;
}

export interface SerialHandle {
  stop(): void;
}

export interface SerialOptions {
  /** Used when a packet does not name a device itself. */
  fallbackDeviceId: string;
  baudRate?: number;
  /** Receives the features from every valid packet the board prints. */
  onFeatures: (deviceId: string, features: Features) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
}

/**
 * Prompts for a port, then decodes every JSON line the board prints.
 * Must be called from a click — the picker needs a user gesture.
 */
export async function connectSerial(options: SerialOptions): Promise<SerialHandle> {
  const api = serial();
  if (!api) throw new Error("Этот браузер не поддерживает Web Serial. Нужен Chrome или Edge.");

  const port = await api.requestPort();
  await port.open({ baudRate: options.baudRate ?? 115200 });

  let stopped = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    void reader?.cancel().catch(() => {});
    void port.close().catch(() => {});
    options.onClose?.();
  };

  void (async () => {
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      if (!port.readable) throw new Error("Порт открылся, но не отдаёт данные");
      reader = port.readable.getReader();

      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;

        buffer += decoder.decode(value, { stream: true });

        // The board prints one JSON object per line. Anything else it
        // writes — boot messages, warnings — is skipped rather than fatal.
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (line.startsWith("{")) handleLine(line, options);
        }

        // A board stuck mid-line must not grow the buffer without bound.
        if (buffer.length > 8192) buffer = "";
      }
    } catch (error) {
      if (!stopped) {
        options.onError?.(error instanceof Error ? error.message : String(error));
      }
    } finally {
      stop();
    }
  })();

  return { stop };
}

function handleLine(line: string, options: SerialOptions): void {
  let packet: Record<string, unknown>;
  try {
    packet = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }

  // The board also prints its microphone self-test and boot messages; anything
  // without a usable feature vector is skipped rather than treated as an error.
  const features = parseFeatures(packet);
  if (!features) return;

  const id =
    typeof packet.id === "string" && packet.id.trim() ? packet.id : options.fallbackDeviceId;
  options.onFeatures(id, features);
}
