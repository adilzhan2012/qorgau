"use client";

import { useEffect, useMemo, useState } from "react";

import type { SummaryMap } from "@/lib/live/history";
import type { LiveReading } from "@/lib/live/readings";
import type { Device, DeviceRecord, DeviceStatus } from "@/lib/types";

/**
 * A device is online while frames keep arriving. Frames come ~15×/s, so a
 * ten-second gap means the source has stopped — unplugged, closed, or the
 * microphone was switched off — not that a frame was late.
 */
export const ONLINE_WINDOW_MS = 10_000;

function statusOf(reading: LiveReading | undefined, now: number): DeviceStatus {
  if (!reading) return "offline";
  if (reading.alertUntil > now) return "alert";
  return now - reading.at < ONLINE_WINDOW_MS ? "online" : "offline";
}

/**
 * Lays live readings and remembered summaries over the roster.
 *
 * The roster says which devices exist and where they are. A live reading
 * says what a device hears right now and wins outright. A summary is what it
 * last said in an earlier session — enough for "Бензопила 82%, 3 минуты
 * назад", never enough to call it online.
 */
function compose(
  records: DeviceRecord[],
  readings: Record<string, LiveReading>,
  summaries: SummaryMap,
  now: number,
): Device[] {
  return records
    .map((record): Device => {
      const reading = readings[record.id];
      if (reading) {
        const status = statusOf(reading, now);
        return {
          ...record,
          status,
          lastSignal: new Date(reading.at),
          soundType: status === "alert" ? reading.soundType : null,
          battery: reading.battery,
          classification: reading.classification,
          lastSource: reading.source,
          live:
            status === "offline"
              ? null
              : {
                  at: reading.at,
                  reasons: reading.reasons,
                  rms: reading.rms,
                  bands: reading.bands,
                  source: reading.source,
                },
        };
      }

      const summary = summaries[record.id];
      return {
        ...record,
        status: "offline",
        lastSignal: summary ? new Date(summary.at) : null,
        soundType: null,
        battery: summary?.battery ?? null,
        classification: summary?.classification ?? null,
        lastSource: summary?.source ?? null,
        live: null,
      };
    })
    .sort((a, b) => {
      if (a.status !== b.status) return RANK[a.status] - RANK[b.status];
      return a.name.localeCompare(b.name, "ru");
    });
}

const RANK: Record<DeviceStatus, number> = { alert: 0, online: 1, offline: 2 };

/**
 * Devices with their status, re-evaluated exactly when a status can change.
 *
 * While frames arrive, every publish re-renders anyway. The only transitions
 * that happen on their own are alert → online (the latch expiring) and online
 * → offline (the source going quiet), and both have a known moment — so we
 * schedule a single timer for the earliest one instead of polling.
 */
export function useDevices(
  records: DeviceRecord[],
  readings: Record<string, LiveReading>,
  summaries: SummaryMap,
): Device[] {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const now = Date.now();
    let next = Infinity;
    for (const reading of Object.values(readings)) {
      if (reading.alertUntil > now) next = Math.min(next, reading.alertUntil);
      const offlineAt = reading.at + ONLINE_WINDOW_MS;
      if (offlineAt > now) next = Math.min(next, offlineAt);
    }
    if (!Number.isFinite(next)) return;

    const timer = window.setTimeout(() => setTick((t) => t + 1), next - now + 20);
    return () => window.clearTimeout(timer);
  }, [readings, tick]);

  return useMemo(
    () => compose(records, readings, summaries, Date.now()),
    // `tick` is the whole point: it forces a recompute at the scheduled moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, readings, summaries, tick],
  );
}
