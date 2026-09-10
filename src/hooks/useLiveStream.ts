"use client";

import { useEffect, useState } from "react";

import type { LiveEvent, LiveReading } from "@/lib/live/store";

export interface LiveStreamResult {
  /** Latest reading per device id. */
  readings: Record<string, LiveReading>;
  connected: boolean;
}

/**
 * Subscribes to /api/stream. Every tab gets the same readings, which is what
 * makes the demo convincing: the state lives on the server, not in one page.
 *
 * EventSource reconnects on its own, so a dev-server restart heals itself.
 */
export function useLiveStream(): LiveStreamResult {
  const [readings, setReadings] = useState<Record<string, LiveReading>>({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/stream");

    source.onopen = () => setConnected(true);

    source.onmessage = (event) => {
      let payload: LiveEvent;
      try {
        payload = JSON.parse(event.data) as LiveEvent;
      } catch {
        return;
      }

      if (payload.type === "snapshot") {
        const next: Record<string, LiveReading> = {};
        for (const reading of payload.readings) next[reading.deviceId] = reading;
        setReadings(next);
        return;
      }

      if (payload.type === "reading") {
        setReadings((current) => ({
          ...current,
          [payload.reading.deviceId]: payload.reading,
        }));
      }
    };

    source.onerror = () => setConnected(false);

    return () => {
      source.close();
    };
  }, []);

  return { readings, connected };
}
