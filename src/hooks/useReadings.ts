"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Features } from "@/lib/audio/features";
import { ListeningWindow } from "@/lib/audio/window";
import {
  MAX_EVENTS,
  loadEvents,
  loadSummaries,
  saveEvents,
  saveSummaries,
  type SummaryMap,
} from "@/lib/live/history";
import {
  makeReading,
  mergeReading,
  type BoardOpinion,
  type LiveReading,
} from "@/lib/live/readings";
import {
  RECORDING_SECONDS,
  SampleRecorder,
  downloadRecording,
} from "@/lib/live/recording";
import type { ReadingSource, SoundClass, SoundEvent } from "@/lib/types";

export interface PublishExtras {
  /** Battery percentage the board sent with the frame, if any. */
  battery?: number | null;
  /** The board's own verdict, if its firmware classifies. */
  board?: BoardOpinion | null;
}

export type PublishFeatures = (
  deviceId: string,
  source: ReadingSource,
  features: Features,
  extras?: PublishExtras,
) => void;

/** Что пишется прямо сейчас, для полоски в интерфейсе. */
export interface RecordingState {
  label: SoundClass;
  deviceId: string;
  frames: number;
  /** 0..1. */
  progress: number;
}

export interface ReadingsResult {
  /** Latest reading per device id, for devices that reported this session. */
  readings: Record<string, LiveReading>;
  /** Last known reading per device from earlier sessions. */
  summaries: SummaryMap;
  /** Alerts, oldest first. */
  events: SoundEvent[];
  publish: PublishFeatures;
  /** Removes everything remembered about a device. */
  forget: (deviceId: string) => void;
  clearEvents: () => void;
  /** Запись образца: null, когда ничего не пишется. */
  recording: RecordingState | null;
  /** Начать запись «вот это — такой-то звук» с указанного устройства. */
  startRecording: (label: SoundClass, deviceId: string) => void;
  cancelRecording: () => void;
}

/** Summaries are written this often at most; frames arrive ~15×/s. */
const SAVE_EVERY_MS = 2000;

let eventCounter = 0;
function eventId(at: number): string {
  eventCounter += 1;
  return `${at.toString(36)}-${eventCounter.toString(36)}`;
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
  const [summaries, setSummaries] = useState<SummaryMap>({});
  const [events, setEvents] = useState<SoundEvent[]>([]);

  const [recording, setRecording] = useState<RecordingState | null>(null);

  const latest = useRef<Record<string, LiveReading>>({});
  // Запись идёт через тот же publish, что и всё остальное: другого места, где
  // видны кадры и с платы, и с микрофона ноутбука, просто нет.
  const recorder = useRef<SampleRecorder | null>(null);
  // A second and a half of memory per device: the classifier looks at a window
  // rather than a frame, and every board has its own.
  const windows = useRef<Record<string, ListeningWindow>>({});
  const summaryRef = useRef<SummaryMap>({});
  const eventsRef = useRef<SoundEvent[]>([]);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    summaryRef.current = loadSummaries();
    eventsRef.current = loadEvents();
    setSummaries(summaryRef.current);
    setEvents(eventsRef.current);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current !== null) return;
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      saveSummaries(summaryRef.current);
      setSummaries({ ...summaryRef.current });
    }, SAVE_EVERY_MS);
  }, []);

  const publish = useCallback<PublishFeatures>(
    (deviceId, source, features, extras) => {
      // Пишем образец, если он про это устройство. Кадры берём до
      // классификации: в файл должно попасть то, что слышал датчик, а не то,
      // что о нём подумал сегодняшний классификатор.
      const active = recorder.current;
      if (active !== null && active.deviceId === deviceId) {
        const done = active.push(features, source);
        setRecording({
          label: active.label,
          deviceId,
          frames: active.frames,
          progress: active.progress,
        });
        if (done) {
          downloadRecording(active.toRecording());
          recorder.current = null;
          setRecording(null);
        }
      }

      const previous = latest.current[deviceId];
      const window = (windows.current[deviceId] ??= new ListeningWindow());
      const merged = mergeReading(
        previous,
        makeReading(
          deviceId,
          source,
          features,
          window.push(features),
          extras?.battery ?? null,
          extras?.board ?? null,
        ),
      );
      latest.current = { ...latest.current, [deviceId]: merged };
      setReadings(latest.current);

      summaryRef.current[deviceId] = {
        at: merged.at,
        classification: merged.classification,
        top: merged.top,
        topValue: merged.topValue,
        source: merged.source,
        battery: merged.battery,
      };
      scheduleSave();

      // An event is an alert starting, or the latched verdict changing class.
      // A louder frame of the same alert updates the event rather than adding
      // a second one — a burst of gunshot frames is one gunshot.
      if (merged.status !== "alert") return;
      const last = eventsRef.current[eventsRef.current.length - 1];
      const wasAlerting = previous !== undefined && previous.status === "alert";
      const sameEvent =
        wasAlerting && last && last.deviceId === deviceId && last.sound === merged.top;

      if (sameEvent) {
        if (merged.topValue > last.value) {
          eventsRef.current = [
            ...eventsRef.current.slice(0, -1),
            { ...last, value: merged.topValue, reasons: merged.reasons },
          ];
        } else {
          return;
        }
      } else {
        eventsRef.current = [
          ...eventsRef.current,
          {
            id: eventId(merged.at),
            deviceId,
            at: merged.at,
            sound: merged.top,
            value: merged.topValue,
            source: merged.source,
            reasons: merged.reasons,
          },
        ].slice(-MAX_EVENTS);
      }
      setEvents(eventsRef.current);
      saveEvents(eventsRef.current);
    },
    [scheduleSave],
  );

  const startRecording = useCallback((label: SoundClass, deviceId: string) => {
    recorder.current = new SampleRecorder(label, deviceId, RECORDING_SECONDS);
    setRecording({ label, deviceId, frames: 0, progress: 0 });
  }, []);

  const cancelRecording = useCallback(() => {
    recorder.current = null;
    setRecording(null);
  }, []);

  const forget = useCallback((deviceId: string) => {
    const { [deviceId]: _dropped, ...rest } = latest.current;
    latest.current = rest;
    setReadings(rest);
    delete windows.current[deviceId];

    delete summaryRef.current[deviceId];
    saveSummaries(summaryRef.current);
    setSummaries({ ...summaryRef.current });

    eventsRef.current = eventsRef.current.filter((event) => event.deviceId !== deviceId);
    saveEvents(eventsRef.current);
    setEvents(eventsRef.current);
  }, []);

  const clearEvents = useCallback(() => {
    eventsRef.current = [];
    saveEvents([]);
    setEvents([]);
  }, []);

  return useMemo(
    () => ({
      readings,
      summaries,
      events,
      publish,
      forget,
      clearEvents,
      recording,
      startRecording,
      cancelRecording,
    }),
    [
      readings,
      summaries,
      events,
      publish,
      forget,
      clearEvents,
      recording,
      startRecording,
      cancelRecording,
    ],
  );
}
