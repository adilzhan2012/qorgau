"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_DEVICES,
  DEVICES_STORAGE_KEY,
  loadDevices,
  nextDeviceId,
  normaliseId,
  saveDevices,
} from "@/lib/devices/store";
import type { DeviceRecord } from "@/lib/types";

export type DeviceInput = Omit<DeviceRecord, "createdAt" | "origin"> & {
  origin?: DeviceRecord["origin"];
};

export interface DeviceStore {
  records: DeviceRecord[];
  /** False during SSR and the first client render, before localStorage is read. */
  hydrated: boolean;
  /** Returns the stored record. Throws if the id is taken. */
  add: (input: DeviceInput) => DeviceRecord;
  update: (id: string, patch: Partial<Pick<DeviceRecord, "name" | "lat" | "lng">>) => void;
  remove: (id: string) => void;
  /** The next free QRG-NNN. */
  suggestId: () => string;
  /** Puts the six built-in places back. Only offered when the roster is empty. */
  restoreDefaults: () => void;
}

/**
 * The roster, backed by localStorage, shared across tabs.
 *
 * The authoritative copy sits in a ref and is mirrored into state, so that
 * `add` called twice inside one event (a board announces itself while the
 * user is saving a form) sees the first addition rather than a stale array.
 */
export function useDeviceStore(): DeviceStore {
  const [records, setRecords] = useState<DeviceRecord[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const latest = useRef<DeviceRecord[]>([]);

  const commit = useCallback((next: DeviceRecord[]) => {
    latest.current = next;
    setRecords(next);
    saveDevices(next);
  }, []);

  useEffect(() => {
    const stored = loadDevices();
    if (stored === null) {
      // First visit: seed the park so there is something to point a sensor at.
      commit(DEFAULT_DEVICES.map((record) => ({ ...record, createdAt: Date.now() })));
    } else {
      latest.current = stored;
      setRecords(stored);
    }
    setHydrated(true);

    // Another tab edited the roster: pick it up without a reload.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== DEVICES_STORAGE_KEY) return;
      const next = loadDevices();
      if (next) {
        latest.current = next;
        setRecords(next);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [commit]);

  const add = useCallback<DeviceStore["add"]>(
    (input) => {
      const id = normaliseId(input.id);
      if (latest.current.some((device) => device.id === id)) {
        throw new Error(`Устройство ${id} уже есть`);
      }
      const record: DeviceRecord = {
        id,
        name: input.name.trim() || id,
        lat: input.lat,
        lng: input.lng,
        createdAt: Date.now(),
        origin: input.origin ?? "manual",
      };
      commit([...latest.current, record]);
      return record;
    },
    [commit],
  );

  const update = useCallback<DeviceStore["update"]>(
    (id, patch) => {
      commit(
        latest.current.map((device) =>
          device.id === id
            ? {
                ...device,
                ...patch,
                name: patch.name !== undefined ? patch.name.trim() || device.id : device.name,
              }
            : device,
        ),
      );
    },
    [commit],
  );

  const remove = useCallback<DeviceStore["remove"]>(
    (id) => commit(latest.current.filter((device) => device.id !== id)),
    [commit],
  );

  const suggestId = useCallback(() => nextDeviceId(latest.current), []);

  const restoreDefaults = useCallback(() => {
    const taken = new Set(latest.current.map((device) => device.id));
    const missing = DEFAULT_DEVICES.filter((device) => !taken.has(device.id)).map(
      (device) => ({ ...device, createdAt: Date.now() }),
    );
    commit([...latest.current, ...missing]);
  }, [commit]);

  return useMemo(
    () => ({ records, hydrated, add, update, remove, suggestId, restoreDefaults }),
    [records, hydrated, add, update, remove, suggestId, restoreDefaults],
  );
}
