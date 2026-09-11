"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  describePort,
  getGrantedPorts,
  isSerialSupported,
  openPort,
  requestPort,
  watchPorts,
  type BoardFrame,
  type BoardHello,
  type SerialHandle,
  type SerialPortLike,
} from "@/lib/audio/serialSensor";
import type { PublishFeatures } from "@/hooks/useReadings";

export type BoardState = "connecting" | "listening" | "error";

/** One ESP32 plugged into this laptop. */
export interface Board {
  key: string;
  /** "Espressif · USB" and the like. */
  label: string;
  /** What the board says it is, once it has said anything. */
  boardId: string | null;
  /** The device its frames go to. */
  deviceId: string | null;
  firmware: string | null;
  /** "ok" or the firmware's self-test complaint. */
  mic: string | null;
  state: BoardState;
  error: string | null;
  frames: number;
  /** ms since epoch of the last frame, 0 before the first. */
  lastAt: number;
  battery: number | null;
}

export interface BoardsOptions {
  publish: PublishFeatures;
  /**
   * Which device a board reporting as `boardId` should feed. Called once per
   * board, the first time it identifies itself — this is where an unknown id
   * becomes a new device on the map.
   */
  resolveDevice: (boardId: string) => string;
  hasDevice: (deviceId: string) => boolean;
  /** For firmware that sends no id at all. */
  fallbackDeviceId: string | null;
}

export interface BoardsResult {
  boards: Board[];
  supported: boolean;
  /** Prompts for a port. Must be called from a click. */
  connect: () => Promise<void>;
  disconnect: (key: string) => void;
  /** Sends this board's frames elsewhere from now on, and remembers it. */
  bind: (key: string, deviceId: string) => void;
  /** Writes the bound device's id into the board's flash. */
  writeId: (key: string) => Promise<void>;
}

const BINDINGS_KEY = "qorgau.bindings.v1";

function loadBindings(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(BINDINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveBindings(bindings: Record<string, string>): void {
  try {
    window.localStorage.setItem(BINDINGS_KEY, JSON.stringify(bindings));
  } catch {
    // Bindings are re-derived from ids anyway.
  }
}

/** Errors Chrome throws for a port another program holds. */
function friendlyError(message: string): string {
  if (/already open|in use|Failed to open|access denied/i.test(message)) {
    return "Порт занят другой программой. Закройте Монитор порта в Arduino IDE и подключите снова.";
  }
  if (/No port selected|NotFoundError/i.test(message)) return "Порт не выбран.";
  return message;
}

interface Slot {
  board: Board;
  port: SerialPortLike;
  handle: SerialHandle | null;
}

let slotCounter = 0;

/**
 * Opens and closes on one physical port happen strictly one after another.
 * React's dev-mode double mount, or a quick navigate-away-and-back, otherwise
 * asks to open a port whose previous close is still in flight — and Chrome
 * answers "already open".
 */
const portQueue = new WeakMap<SerialPortLike, Promise<void>>();

function enqueue(port: SerialPortLike, task: () => Promise<void>): Promise<void> {
  const next = (portQueue.get(port) ?? Promise.resolve()).catch(() => {}).then(task);
  portQueue.set(port, next);
  return next;
}

/**
 * Every ESP32 plugged into this laptop, each feeding one device.
 *
 * Ports the user granted once reopen by themselves: at page load, and again
 * when the board is plugged back in. So the demo flow is "plug it in" — the
 * click to pick a port happens once per board per laptop.
 *
 * Frames arrive ~15×/s per board. `publish` already re-renders on each, so
 * the board list itself only refreshes on a timer; the per-frame counters
 * live in refs.
 */
export function useBoards(options: BoardsOptions): BoardsResult {
  const [supported, setSupported] = useState(false);
  const [boards, setBoards] = useState<Board[]>([]);

  const slots = useRef<Map<string, Slot>>(new Map());
  const bindings = useRef<Record<string, string>>({});
  const alive = useRef(false);
  const opts = useRef(options);
  opts.current = options;

  const flush = useCallback(() => {
    setBoards([...slots.current.values()].map((slot) => ({ ...slot.board })));
  }, []);

  const routeFor = useCallback((boardId: string): string => {
    const remembered = bindings.current[boardId];
    if (remembered && opts.current.hasDevice(remembered)) return remembered;

    const deviceId = opts.current.resolveDevice(boardId);
    bindings.current = { ...bindings.current, [boardId]: deviceId };
    saveBindings(bindings.current);
    return deviceId;
  }, []);

  const open = useCallback(
    async (port: SerialPortLike) => {
      if (!alive.current) return;
      // The same physical port can show up twice: once from getPorts() at load
      // and once from the connect event a moment later.
      for (const slot of slots.current.values()) {
        if (slot.port === port) return;
      }

      slotCounter += 1;
      const key = `board-${slotCounter}`;
      const slot: Slot = {
        port,
        handle: null,
        board: {
          key,
          label: describePort(port),
          boardId: null,
          deviceId: null,
          firmware: null,
          mic: null,
          state: "connecting",
          error: null,
          frames: 0,
          lastAt: 0,
          battery: null,
        },
      };
      slots.current.set(key, slot);
      flush();

      const identify = (boardId: string | null) => {
        if (!boardId || slot.board.boardId === boardId) return;
        slot.board.boardId = boardId;
        slot.board.deviceId = routeFor(boardId);
        flush();
      };

      const onHello = (hello: BoardHello) => {
        slot.board.firmware = hello.firmware;
        slot.board.mic = hello.mic;
        identify(hello.boardId);
        flush();
      };

      const onFrame = (frame: BoardFrame) => {
        identify(frame.boardId);
        slot.board.frames += 1;
        slot.board.lastAt = Date.now();
        if (frame.battery !== null) slot.board.battery = frame.battery;

        const target = slot.board.deviceId ?? opts.current.fallbackDeviceId;
        if (!target) return;
        if (slot.board.deviceId === null) slot.board.deviceId = target;
        opts.current.publish(target, "esp32", frame.features, { battery: frame.battery });
      };

      try {
        slot.handle = await openPort(port, {
          onFrame,
          onHello,
          onError: (message) => {
            slot.board.state = "error";
            slot.board.error = friendlyError(message);
            flush();
          },
          onClose: () => {
            // A pulled cable is not an error worth keeping on screen; the
            // board simply leaves the list. A failed open stays, with its reason.
            if (slot.board.state !== "error") slots.current.delete(key);
            flush();
          },
        });
        // Unmounted while the port was opening: let it go again.
        if (!alive.current || slots.current.get(key) !== slot) {
          await slot.handle.stop();
          return;
        }
        slot.board.state = "listening";
        flush();
      } catch (error) {
        slot.board.state = "error";
        slot.board.error = friendlyError(error instanceof Error ? error.message : String(error));
        flush();
      }
    },
    [flush, routeFor],
  );

  const attach = useCallback((port: SerialPortLike) => enqueue(port, () => open(port)), [open]);

  useEffect(() => {
    if (!isSerialSupported()) return;
    alive.current = true;
    setSupported(true);
    bindings.current = loadBindings();

    // Everything granted earlier comes back without a click.
    void getGrantedPorts().then((ports) => {
      for (const port of ports) void attach(port);
    });

    const unwatch = watchPorts({
      onConnect: (port) => void attach(port),
      onDisconnect: (port) => {
        for (const [key, slot] of slots.current) {
          if (slot.port === port) {
            const { handle } = slot;
            if (handle) void enqueue(port, () => handle.stop());
            slots.current.delete(key);
          }
        }
        flush();
      },
    });

    // Frame counters and "last seen" refresh on a timer, not per frame.
    const timer = window.setInterval(() => {
      if (slots.current.size > 0) flush();
    }, 500);

    return () => {
      alive.current = false;
      unwatch();
      window.clearInterval(timer);
      for (const slot of slots.current.values()) {
        const { handle, port } = slot;
        if (handle) void enqueue(port, () => handle.stop());
      }
      slots.current.clear();
    };
  }, [attach, flush]);

  const connect = useCallback(async () => {
    const port = await requestPort();
    await attach(port);
  }, [attach]);

  const disconnect = useCallback(
    (key: string) => {
      const slot = slots.current.get(key);
      if (!slot) return;
      const { handle, port } = slot;
      if (handle) void enqueue(port, () => handle.stop());
      slots.current.delete(key);
      flush();
    },
    [flush],
  );

  const bind = useCallback(
    (key: string, deviceId: string) => {
      const slot = slots.current.get(key);
      if (!slot) return;
      slot.board.deviceId = deviceId;
      if (slot.board.boardId) {
        bindings.current = { ...bindings.current, [slot.board.boardId]: deviceId };
        saveBindings(bindings.current);
      }
      flush();
    },
    [flush],
  );

  const writeId = useCallback(
    async (key: string) => {
      const slot = slots.current.get(key);
      if (!slot?.handle || !slot.board.deviceId) return;
      // Captured first: the board answers with a hello carrying the new id,
      // and that can land before `send` resolves.
      const oldId = slot.board.boardId;
      const newId = slot.board.deviceId;
      await slot.handle.send({ set: { id: newId } });
      // The binding for the old id is now just noise.
      if (oldId && oldId !== newId && oldId in bindings.current) {
        const { [oldId]: _old, ...rest } = bindings.current;
        bindings.current = rest;
        saveBindings(rest);
      }
    },
    [],
  );

  return useMemo(
    () => ({ boards, supported, connect, disconnect, bind, writeId }),
    [boards, supported, connect, disconnect, bind, writeId],
  );
}
