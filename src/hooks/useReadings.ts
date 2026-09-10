"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import type { Features } from "@/lib/audio/features";
import { makeReading, mergeReading, type LiveReading } from "@/lib/live/readings";
import type { ReadingSource } from "@/lib/types";

export type PublishFeatures = (
  deviceId: string,
  source: ReadingSource,
  features: Features,
) => void;

export interface ReadingsResult {
  /** Latest reading per device id. */
  readings: Record<string, LiveReading>;
  publish: PublishFeatures;
}

/**
 * Holds what each device is hearing right now.
 *
 * Sound arrives about fifteen times a second, so this deliberately keeps the
 * authoritative copy in a ref and mirrors it into state: `mergeReading` needs
 * the previous reading to decide whether an alert is still latched, and
 * reading that from `useState` inside a callback would see a stale value when
 * two frames land in the same React batch.
 */
export function useReadings(): ReadingsResult {
  const [readings, setReadings] = useState<Record<string, LiveReading>>({});
  const latest = useRef<Record<string, LiveReading>>({});

  const publish = useCallback<PublishFeatures>((deviceId, source, features) => {
    const merged = mergeReading(
      latest.current[deviceId],
      makeReading(deviceId, source, features),
    );
    latest.current = { ...latest.current, [deviceId]: merged };
    setReadings(latest.current);
  }, []);

  return useMemo(() => ({ readings, publish }), [readings, publish]);
}
