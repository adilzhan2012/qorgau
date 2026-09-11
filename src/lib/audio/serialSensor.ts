import { parseFeatures, type Features } from "./features";

/**
 * Reads the ESP32 over USB straight from the page, using Web Serial.
 *
 * The obvious alternative — the `serialport` npm package and a Node bridge —
 * needs a native build, and on Node 24 + Windows that can mean installing
 * Visual Studio build tools. Web Serial ships inside Chrome and Edge, needs no
 * install at all, and removes a whole process from the demo.
 *
 * The browser remembers which ports the user has granted, so after the first
 * pick a board reconnects on its own: `getGrantedPorts()` at page load, and
 * the `connect` event when it is plugged in later.
 */

/** Minimal Web Serial typings — not in TypeScript's DOM lib yet. */
export interface SerialPortLike extends EventTarget {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}

interface SerialLike extends EventTarget {
  requestPort(): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}

function serial(): SerialLike | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { serial?: SerialLike };
  return nav.serial ?? null;
}

export function isSerialSupported(): boolean {
  return serial() !== null;
}

/** Prompts the user for a port. Must be called from a click. */
export async function requestPort(): Promise<SerialPortLike> {
  const api = serial();
  if (!api) throw new Error("Этот браузер не поддерживает Web Serial. Нужен Chrome или Edge.");
  return api.requestPort();
}

/** Ports the user has already granted to this site, plugged in or not. */
export async function getGrantedPorts(): Promise<SerialPortLike[]> {
  const api = serial();
  if (!api) return [];
  try {
    return await api.getPorts();
  } catch {
    return [];
  }
}

/**
 * Fires when a granted port is plugged in or pulled out. The board is the
 * event target; the DOM typings do not know that, hence the cast.
 */
export function watchPorts(handlers: {
  onConnect: (port: SerialPortLike) => void;
  onDisconnect: (port: SerialPortLike) => void;
}): () => void {
  const api = serial();
  if (!api) return () => {};

  const connect = (event: Event) => handlers.onConnect(event.target as SerialPortLike);
  const disconnect = (event: Event) => handlers.onDisconnect(event.target as SerialPortLike);
  api.addEventListener("connect", connect);
  api.addEventListener("disconnect", disconnect);
  return () => {
    api.removeEventListener("connect", connect);
    api.removeEventListener("disconnect", disconnect);
  };
}

/** One frame of measurements from the board. */
export interface BoardFrame {
  /** The id the board reports as, or null for firmware that sends none. */
  boardId: string | null;
  features: Features;
  /** 0–100 when the board measures its battery; otherwise null. */
  battery: number | null;
}

/** The board introducing itself: printed at boot and on request. */
export interface BoardHello {
  boardId: string | null;
  firmware: string | null;
  /** "ok" or the self-test complaint; null when the firmware predates it. */
  mic: string | null;
}

export interface SerialHandle {
  readonly port: SerialPortLike;
  /** Resolves once the port is actually closed and can be opened again. */
  stop(): Promise<void>;
  /** Sends one JSON line to the board. */
  send(command: Record<string, unknown>): Promise<void>;
}

export interface SerialOptions {
  baudRate?: number;
  onFrame: (frame: BoardFrame) => void;
  onHello?: (hello: BoardHello) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
}

/**
 * Opens a port and decodes every JSON line the board prints. Boot banners,
 * self-test output and anything else that is not JSON are skipped.
 */
export async function openPort(port: SerialPortLike, options: SerialOptions): Promise<SerialHandle> {
  await port.open({ baudRate: options.baudRate ?? 115200 });

  let stopped = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let closing: Promise<void> | null = null;

  // Order matters: close() rejects while the reader holds its lock, so cancel
  // the read, wait for the loop to let go, and only then close the port —
  // otherwise the port stays open and the next open() fails as "in use".
  const stop = (): Promise<void> => {
    if (closing) return closing;
    stopped = true;
    closing = (async () => {
      try {
        await reader?.cancel();
      } catch {
        // Already finished.
      }
      await readLoop;
      try {
        await port.close();
      } catch {
        // Already closed, or pulled out.
      }
      options.onClose?.();
    })();
    return closing;
  };

  const send = async (command: Record<string, unknown>) => {
    if (stopped || !port.writable) throw new Error("Порт закрыт");
    const writer = port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(`${JSON.stringify(command)}\n`));
    } finally {
      writer.releaseLock();
    }
  };

  const readLoop = (async () => {
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
      try {
        reader?.releaseLock();
      } catch {
        // Never acquired.
      }
      reader = null;
    }
  })();

  // The loop ending on its own — cable pulled, board reset — closes the port
  // the same way an explicit stop does.
  void readLoop.then(() => {
    if (!stopped) void stop();
  });

  // Ask the board to introduce itself. Firmware without the command ignores
  // the line, and its frames carry the id anyway.
  void send({ get: "hello" }).catch(() => {});

  return { port, stop, send };
}

function idOf(packet: Record<string, unknown>): string | null {
  return typeof packet.id === "string" && packet.id.trim() ? packet.id.trim().toUpperCase() : null;
}

function handleLine(line: string, options: SerialOptions): void {
  let packet: Record<string, unknown>;
  try {
    packet = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }

  if (packet.hello === "qorgau") {
    options.onHello?.({
      boardId: idOf(packet),
      firmware: typeof packet.fw === "string" ? packet.fw : null,
      mic: typeof packet.mic === "string" ? packet.mic : null,
    });
    return;
  }

  // Packets come from firmware, so nothing is trusted: anything without a
  // usable feature vector is skipped rather than treated as an error.
  const features = parseFeatures(packet);
  if (!features) return;

  const bat = Number(packet.bat);
  options.onFrame({
    boardId: idOf(packet),
    features,
    battery: Number.isFinite(bat) ? Math.max(0, Math.min(100, Math.round(bat))) : null,
  });
}

/** A human-readable name for a port, from its USB ids. */
export function describePort(port: SerialPortLike): string {
  const info = port.getInfo();
  if (info.usbVendorId === undefined) return "последовательный порт";
  const vendor = KNOWN_VENDORS[info.usbVendorId] ?? `VID ${info.usbVendorId.toString(16)}`;
  return `${vendor} · USB`;
}

/** The chips that end up on ESP32 dev boards. */
const KNOWN_VENDORS: Record<number, string> = {
  0x303a: "Espressif",
  0x10c4: "Silicon Labs CP210x",
  0x1a86: "WCH CH340",
  0x0403: "FTDI",
};
