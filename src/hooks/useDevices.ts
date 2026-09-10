"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase";
import { FALLBACK_DEVICES } from "@/lib/fallbackDevices";
import { useLiveStream } from "@/hooks/useLiveStream";
import type { LiveReading } from "@/lib/live/store";
import {
  SOUND_CLASSES,
  type Classification,
  type Device,
  type DeviceStatus,
} from "@/lib/types";

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/**
 * Documents written before the classification field existed simply lack it,
 * so a missing or malformed breakdown degrades to null rather than to zeros —
 * the panel can then say "no breakdown" instead of showing a false 0%.
 */
function toClassification(value: unknown): Classification | null {
  if (!value || typeof value !== "object") return null;

  const source = value as Record<string, unknown>;
  const result = {} as Classification;
  let present = false;

  for (const name of SOUND_CLASSES) {
    const raw = Number(source[name]);
    if (Number.isFinite(raw)) {
      result[name] = Math.max(0, Math.min(100, raw));
      present = true;
    } else {
      result[name] = 0;
    }
  }

  return present ? result : null;
}

function toDevice(snapshot: QueryDocumentSnapshot<DocumentData>): Device {
  const data = snapshot.data();
  const status: DeviceStatus = data.status === "alert" ? "alert" : "normal";

  return {
    id: typeof data.id === "string" && data.id ? data.id : snapshot.id,
    name: typeof data.name === "string" ? data.name : snapshot.id,
    lat: Number(data.lat),
    lng: Number(data.lng),
    status,
    lastSignal: toDate(data.lastSignal),
    soundType: typeof data.soundType === "string" ? data.soundType : null,
    audioUrl: typeof data.audioUrl === "string" ? data.audioUrl : null,
    battery: Number.isFinite(Number(data.battery)) ? Number(data.battery) : 0,
    classification: toClassification(data.classification),
  };
}

export interface UseDevicesResult {
  devices: Device[];
  loading: boolean;
  error: Error | null;
  /** Firestore has delivered at least one snapshot. */
  synced: boolean;
  /** Whether Firestore is switched on at all. Distinguishes "off" from "broken". */
  firestoreEnabled: boolean;
  /** No first snapshot yet after STALL_AFTER_MS. See the note in the effect. */
  stalled: boolean;
  /** The SSE sensor stream is attached. Independent of Firestore. */
  liveConnected: boolean;
  /** How many devices are currently reporting readings. */
  liveCount: number;
}

/**
 * Lays the live readings over the roster. Firestore says which traps exist and
 * where they are; the sensor stream says what they are hearing right now, and
 * that always wins.
 */
function applyLive(base: Device[], readings: Record<string, LiveReading>): Device[] {
  return base
    .map((device) => {
      const reading = readings[device.id];
      if (!reading) return device;

      return {
        ...device,
        status: reading.status,
        classification: reading.classification,
        soundType: reading.soundType,
        lastSignal: new Date(reading.at),
        live: {
          at: reading.at,
          reasons: reading.reasons,
          rms: reading.rms,
          bands: reading.bands,
          source: reading.source,
        },
      } satisfies Device;
    })
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "alert" ? -1 : 1;
      return a.name.localeCompare(b.name, "ru");
    });
}

/**
 * Firestore retries transport failures indefinitely instead of calling the
 * error handler, so an unreachable backend is indistinguishable from a slow
 * one. Past this point we say so rather than showing an endless skeleton.
 */
const STALL_AFTER_MS = 10_000;

/**
 * Realtime subscription to the `devices` collection.
 * Alerting devices sort first, then by name — so the list never reshuffles
 * arbitrarily between snapshots.
 */
export function useDevices(): UseDevicesResult {
  const [remote, setRemote] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    // No keys is a supported way to run, not a failure. Firestore only holds
    // the roster; FALLBACK_DEVICES covers that, and sound recognition never
    // touched it. Reporting an error here put a red notice over a perfectly
    // working app for anyone who cloned the repo without a .env.local.
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }

    const stallTimer = window.setTimeout(() => setStalled(true), STALL_AFTER_MS);

    const unsubscribe = onSnapshot(
      collection(db, "devices"),
      (snapshot) => {
        const next = snapshot.docs
          .map(toDevice)
          .filter((device) => Number.isFinite(device.lat) && Number.isFinite(device.lng))
          .sort((a, b) => {
            if (a.status !== b.status) return a.status === "alert" ? -1 : 1;
            return a.name.localeCompare(b.name);
          });

        setRemote(next);
        setError(null);

        // Firestore replays an empty snapshot from the local cache before it
        // has heard from the server, so an unreachable backend arrives looking
        // exactly like an empty collection. Only a server snapshot settles it.
        if (!snapshot.metadata.fromCache) {
          window.clearTimeout(stallTimer);
          setStalled(false);
          setLoading(false);
        } else if (next.length > 0) {
          // Cached devices are still worth showing right away.
          setLoading(false);
        }
      },
      (err) => {
        window.clearTimeout(stallTimer);
        setError(err);
        setLoading(false);
      },
    );

    return () => {
      window.clearTimeout(stallTimer);
      unsubscribe();
    };
  }, []);

  const { readings, connected } = useLiveStream();

  // Fall back to the built-in roster until Firestore answers — and keep using
  // it if it never does, so the demo never stalls on a skeleton.
  const devices = useMemo(
    () => applyLive(remote.length > 0 ? remote : FALLBACK_DEVICES, readings),
    [remote, readings],
  );

  return {
    devices,
    // The fallback roster is never empty, so there is nothing to skeleton for.
    // `synced` is what actually says whether Firestore has answered.
    loading: devices.length === 0,
    synced: !loading,
    firestoreEnabled: isFirebaseConfigured,
    error,
    stalled,
    liveConnected: connected,
    liveCount: Object.keys(readings).length,
  };
}
