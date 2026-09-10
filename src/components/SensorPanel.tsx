"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { SampleFile } from "@/app/api/samples/route";
import { connectSerial, isSerialSupported, type SerialHandle } from "@/lib/audio/serialSensor";
import { playSample, startMicrophone, type SourceHandle } from "@/lib/audio/sources";
import { bandLabel } from "@/lib/audio/features";
import {
  SOUND_CLASSES,
  SOUND_CLASS_LABELS,
  SOURCE_LABELS,
  topSoundClass,
  type Device,
} from "@/lib/types";

type Mode = "idle" | "mic" | "serial";

interface SensorPanelProps {
  devices: Device[];
  sensorDeviceId: string;
  onSensorDeviceChange: (id: string) => void;
  /** The device the sensor reports as, carrying its live readings. */
  target: Device | null;
}

/**
 * The control surface for the demo: pick a trap, feed it sound, watch the site
 * decide. The microphone, the ESP32 over USB and the sample files all post the
 * same features to /api/ingest, so this panel is only choosing which one runs.
 */
export function SensorPanel({
  devices,
  sensorDeviceId,
  onSensorDeviceChange,
  target,
}: SensorPanelProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [open, setOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<SampleFile[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  // Resolved after mount: `navigator.serial` does not exist during SSR, and
  // deciding on it while rendering makes the server and client disagree.
  const [serialSupported, setSerialSupported] = useState(false);

  useEffect(() => setSerialSupported(isSerialSupported()), []);

  const audioRef = useRef<SourceHandle | null>(null);
  const serialRef = useRef<SerialHandle | null>(null);
  const sampleRef = useRef<SourceHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/samples")
      .then((response) => response.json() as Promise<{ samples: SampleFile[] }>)
      .then((data) => {
        if (!cancelled) setSamples(data.samples ?? []);
      })
      .catch(() => {
        if (!cancelled) setSamples([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Release the microphone and the port if the page goes away mid-demo.
  useEffect(
    () => () => {
      audioRef.current?.stop();
      serialRef.current?.stop();
      sampleRef.current?.stop();
    },
    [],
  );

  const stopAll = useCallback(() => {
    audioRef.current?.stop();
    audioRef.current = null;
    serialRef.current?.stop();
    serialRef.current = null;
    setMode("idle");
  }, []);

  const toggleMic = useCallback(async () => {
    setError(null);
    if (mode === "mic") {
      stopAll();
      return;
    }
    stopAll();
    try {
      audioRef.current = await startMicrophone(sensorDeviceId);
      setMode("mic");
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Доступ к микрофону запрещён. Разрешите его в адресной строке браузера."
          : `Микрофон не открылся: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [mode, sensorDeviceId, stopAll]);

  const toggleSerial = useCallback(async () => {
    setError(null);
    if (mode === "serial") {
      stopAll();
      return;
    }
    stopAll();
    try {
      serialRef.current = await connectSerial({
        fallbackDeviceId: sensorDeviceId,
        onError: (message) => setError(`Обрыв связи с платой: ${message}`),
        onClose: () => setMode((current) => (current === "serial" ? "idle" : current)),
      });
      setMode("serial");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(
        message.includes("No port selected")
          ? "Порт не выбран."
          : `Не удалось открыть порт: ${message}`,
      );
    }
  }, [mode, sensorDeviceId, stopAll]);

  const playFile = useCallback(
    async (sample: SampleFile) => {
      setError(null);
      sampleRef.current?.stop();
      setPlaying(sample.url);
      try {
        const handle = await playSample(sample.url, sensorDeviceId);
        sampleRef.current = handle;
        await handle.done;
      } catch (err) {
        setError(`Не удалось проиграть файл: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        sampleRef.current = null;
        setPlaying((current) => (current === sample.url ? null : current));
      }
    },
    [sensorDeviceId],
  );

  const live = target?.live ?? null;
  const classification = target?.classification ?? null;
  const top = topSoundClass(classification);
  const listening = mode !== "idle" || playing !== null;

  return (
    // Top-left: the basemap pill owns the top-right, and the map attribution
    // must stay visible bottom-left — it is the tile licensing condition.
    <div className="glass scrollbar-none absolute inset-x-4 top-16 z-10 max-h-[calc(100%-5rem)] overflow-y-auto rounded-2xl shadow-lifted md:inset-x-auto md:left-4 md:top-4 md:max-h-[calc(100%-2rem)] md:w-[380px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className={`h-2 w-2 shrink-0 rounded-full transition-colors duration-300 ${
              listening ? "animate-pulse bg-accent" : "bg-faint"
            }`}
          />
          <span className="text-[15px] font-medium">Датчик</span>
          <span className="min-w-0 truncate text-[12px] text-muted">
            {mode === "mic"
              ? SOURCE_LABELS.mic
              : mode === "serial"
                ? SOURCE_LABELS.esp32
                : playing
                  ? SOURCE_LABELS.sample
                  : "не слушает"}
          </span>
        </span>
        <svg
          width="11"
          height="7"
          viewBox="0 0 11 7"
          aria-hidden="true"
          className={`shrink-0 text-muted transition-transform duration-300 ease-apple ${
            open ? "" : "rotate-180"
          }`}
        >
          <path d="M1 5.5L5.5 1L10 5.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-white/[0.06] px-4 pb-4 pt-3">
          {/* Which trap the sensor is standing in for */}
          <label className="stat-label mb-1.5 block">Устройство</label>
          <select
            value={sensorDeviceId}
            onChange={(event) => onSensorDeviceChange(event.target.value)}
            className="mb-3 w-full rounded-xl bg-raised px-3 py-2 text-[13px] text-ink outline-none"
          >
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void toggleMic()}
              className={`flex-1 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-300 ease-apple active:scale-[0.98] ${
                mode === "mic" ? "bg-accent text-canvas" : "bg-raised text-ink hover:bg-raised/70"
              }`}
            >
              {mode === "mic" ? "Остановить" : "Микрофон"}
            </button>
            <button
              type="button"
              onClick={() => void toggleSerial()}
              disabled={!serialSupported}
              title={
                serialSupported
                  ? "Подключить ESP32-S3 по USB"
                  : "Web Serial есть только в Chrome и Edge"
              }
              className={`flex-1 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-300 ease-apple active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${
                mode === "serial" ? "bg-accent text-canvas" : "bg-raised text-ink hover:bg-raised/70"
              }`}
            >
              {mode === "serial" ? "Отключить" : "ESP32 по USB"}
            </button>
          </div>

          {error && (
            <p className="mt-2.5 rounded-xl bg-alarm-soft px-3 py-2 text-[12px] leading-relaxed text-alarm">
              {error}
            </p>
          )}

          {/* Verdict */}
          <div className="mt-3 rounded-xl bg-white/[0.04] p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[17px] font-medium tracking-tightest">
                {top ? SOUND_CLASS_LABELS[top.name] : "—"}
              </span>
              <span className="text-[22px] font-semibold tabular-nums">
                {top ? `${top.value}%` : "—"}
              </span>
            </div>

            {live?.reasons.length ? (
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                Почему: {live.reasons.join(", ")}
              </p>
            ) : (
              <p className="mt-1 text-[12px] text-faint">
                Включите микрофон или проиграйте файл — сайт разберёт звук.
              </p>
            )}

            {/* Live spectrum, 16 log bands */}
            <div className="mt-3 flex h-10 items-end gap-[3px]" aria-hidden="true">
              {(live?.bands ?? new Array(16).fill(0)).map((value, index) => {
                const peak = Math.max(...(live?.bands ?? [1]), 0.001);
                const height = Math.max(2, (value / peak) * 100);
                return (
                  <span
                    key={index}
                    title={bandLabel(index)}
                    style={{ height: `${height}%` }}
                    className={`flex-1 rounded-sm transition-all duration-100 ${
                      live ? "bg-accent/70" : "bg-white/10"
                    }`}
                  />
                );
              })}
            </div>

            {live && (
              <p className="mt-1.5 text-[11px] tabular-nums text-faint">
                Уровень {live.rms.toFixed(0)} дБ · 60 Гц … 8 кГц
              </p>
            )}
          </div>

          {/* All six classes */}
          {classification && (
            <ul className="mt-3 space-y-1.5">
              {[...SOUND_CLASSES]
                .sort((a, b) => classification[b] - classification[a])
                .map((name) => (
                  <li key={name} className="flex items-center gap-2.5">
                    <span className="w-[74px] shrink-0 text-[12px] text-muted">
                      {SOUND_CLASS_LABELS[name]}
                    </span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                      <span
                        style={{ width: `${classification[name]}%` }}
                        className={`block h-full rounded-full transition-all duration-200 ${
                          top?.name === name ? "bg-accent" : "bg-white/25"
                        }`}
                      />
                    </span>
                    <span className="w-8 shrink-0 text-right text-[12px] tabular-nums text-muted">
                      {classification[name]}%
                    </span>
                  </li>
                ))}
            </ul>
          )}

          {/* Sample files */}
          <div className="mt-3">
            <p className="stat-label mb-1.5">Тестовые звуки</p>
            {samples.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-faint">
                Положите .wav или .mp3 в <code className="font-mono">public/audio/</code> — они
                появятся здесь сами.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {samples.map((sample) => (
                  <button
                    key={sample.url}
                    type="button"
                    onClick={() => void playFile(sample)}
                    disabled={playing !== null}
                    className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-all duration-300 ease-apple active:scale-95 disabled:opacity-40 ${
                      playing === sample.url
                        ? "bg-accent text-canvas"
                        : "bg-raised text-ink hover:bg-raised/70"
                    }`}
                  >
                    {sample.expectedLabel ?? sample.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
