"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Board, BoardsResult } from "@/hooks/useBoards";
import type { PublishFeatures } from "@/hooks/useReadings";
import { bandLabel } from "@/lib/audio/features";
import { playSample, startMicrophone, type SourceHandle } from "@/lib/audio/sources";
import { withBasePath } from "@/lib/basePath";
import { plural } from "@/lib/time";
import {
  SAFETY_LABELS,
  SOUND_CLASSES,
  SOUND_CLASS_LABELS,
  SOUND_SAFETY,
  topSoundClass,
  type Device,
} from "@/lib/types";

/**
 * Ниже этого уровня звука нет вообще — это цифровой ноль, а не тихая комната:
 * у любого живого микрофона есть собственный шум около −60 дБ.
 */
const SILENT_INPUT_DB = -95;

/** One entry of public/audio/samples.json, written by scripts/gen-audio.mjs. */
interface SampleFile {
  file: string;
  name: string;
  /** Set for the built-in synthesised sounds. */
  title?: string | null;
  expected: string | null;
  expectedLabel: string | null;
}

interface SensorPanelProps {
  devices: Device[];
  boards: BoardsResult;
  /** The device the laptop's own sound (microphone, files) reports as. */
  sensorDeviceId: string;
  onSensorDeviceChange: (id: string) => void;
  /** That device, carrying its live readings. */
  target: Device | null;
  /** Where every frame of features goes. */
  publish: PublishFeatures;
  onSelectDevice: (id: string) => void;
  /** Tells the parent whether the microphone is on, for the header pill. */
  onMicChange: (on: boolean) => void;
}

const buttonClass =
  "rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-300 ease-apple active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40";

const selectClass =
  "w-full rounded-xl bg-raised px-3 py-2 text-[13px] text-ink outline-none focus:ring-2 focus:ring-accent/60";

/** " · GPS 7 спутников" and the like; nothing for firmware without GPS. */
function gpsNote(board: Board): string {
  if (!board.gps) return "";
  if (board.gps.fix) return ` · GPS ${board.gps.sats} ${plural(board.gps.sats, "спутник", "спутника", "спутников")}`;
  return board.gps.seen ? " · GPS ищет спутники" : " · GPS молчит";
}

/** A board and what its device is hearing, on one row. */
function BoardRow({
  board,
  devices,
  onBind,
  onDisconnect,
  onOpen,
}: {
  board: Board;
  devices: Device[];
  onBind: (deviceId: string) => void;
  onDisconnect: () => void;
  onOpen: () => void;
}) {
  const device = devices.find((d) => d.id === board.deviceId) ?? null;
  const top = topSoundClass(device?.classification ?? null);
  const quiet = board.state === "listening" && board.lastAt > 0 && Date.now() - board.lastAt > 3000;

  return (
    <li className="rounded-xl bg-white/[0.04] p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          disabled={!device}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              board.state === "error"
                ? "bg-alarm"
                : board.state === "connecting" || quiet
                  ? "bg-warn"
                  : "animate-pulse bg-accent"
            }`}
          />
          <span className="min-w-0">
            <span className="block truncate font-mono text-[12px] text-ink">
              {board.boardId ?? board.label}
            </span>
            <span className="block truncate text-[11px] text-faint">
              {board.state === "error"
                ? "ошибка"
                : board.state === "connecting"
                  ? "открываю порт…"
                  : board.boardId === null
                    ? "жду первый кадр…"
                    : quiet
                      ? "кадры не идут"
                      : `${board.frames} кадров${board.battery !== null ? ` · ${board.battery}%` : ""}${gpsNote(board)}`}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-2">
          {/* The board's own verdict when it has one — that is what a LoRa
              packet would carry — otherwise the site's. */}
          {board.state === "listening" && (board.verdict || (device && top)) && (
            <span className="text-right">
              <span
                className={`block text-[12px] font-medium ${
                  board.verdict?.danger ? "text-alarm" : ""
                }`}
              >
                {SOUND_CLASS_LABELS[board.verdict ? board.verdict.top : top!.name]}
              </span>
              <span className="block text-[11px] tabular-nums text-muted">
                {board.verdict ? board.verdict.conf : top!.value}% ·{" "}
                {SAFETY_LABELS[SOUND_SAFETY[board.verdict ? board.verdict.top : top!.name]]}
              </span>
            </span>
          )}
          <button
            type="button"
            onClick={onDisconnect}
            aria-label="Отключить плату"
            title="Отключить"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-muted transition-all duration-300 ease-apple hover:bg-white/20 hover:text-ink active:scale-90"
          >
            <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {board.error && (
        <p className="mt-2 rounded-lg bg-alarm-soft px-2.5 py-1.5 text-[11px] leading-relaxed text-alarm">
          {board.error}
        </p>
      )}

      {board.state === "listening" && (
        <label className="mt-2 flex items-center gap-2 text-[11px] text-faint">
          <span className="shrink-0">→</span>
          <select
            value={board.deviceId ?? ""}
            onChange={(event) => onBind(event.target.value)}
            className={`${selectClass} py-1.5 text-[12px]`}
          >
            {board.deviceId === null && <option value="">выберите устройство</option>}
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {d.id}
              </option>
            ))}
          </select>
        </label>
      )}
    </li>
  );
}

/**
 * The control surface for the demo: plug in boards, pick which device the
 * laptop's own sound stands in for, feed it, and watch the site decide. Every
 * source produces the same features and goes through the same `publish`.
 */
export function SensorPanel({
  devices,
  boards,
  sensorDeviceId,
  onSensorDeviceChange,
  target,
  publish,
  onSelectDevice,
  onMicChange,
}: SensorPanelProps) {
  const [micOn, setMicOn] = useState(false);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<SampleFile[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const micRef = useRef<SourceHandle | null>(null);
  const sampleRef = useRef<SourceHandle | null>(null);

  useEffect(() => onMicChange(micOn), [micOn, onMicChange]);

  useEffect(() => {
    let cancelled = false;
    void fetch(withBasePath("/audio/samples.json"))
      .then((response) => response.json() as Promise<SampleFile[]>)
      .then((data) => {
        if (!cancelled) setSamples(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setSamples([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Release the microphone if the page goes away mid-demo.
  useEffect(
    () => () => {
      micRef.current?.stop();
      sampleRef.current?.stop();
    },
    [],
  );

  const stopMic = useCallback(() => {
    micRef.current?.stop();
    micRef.current = null;
    setMicOn(false);
  }, []);

  // The microphone follows the selected device: switching the select while it
  // is on should not keep feeding the old one.
  useEffect(() => {
    if (!micRef.current) return;
    stopMic();
  }, [sensorDeviceId, stopMic]);

  const toggleMic = useCallback(async () => {
    setError(null);
    if (micRef.current) {
      stopMic();
      return;
    }
    try {
      micRef.current = await startMicrophone(sensorDeviceId, (features) =>
        publish(sensorDeviceId, "mic", features),
      );
      setMicOn(true);
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Доступ к микрофону запрещён. Разрешите его в адресной строке браузера."
          : `Микрофон не открылся: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [sensorDeviceId, stopMic, publish]);

  const connectBoard = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      await boards.connect();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/No port selected|NotFoundError/i.test(message)) {
        setError(`Не удалось открыть порт: ${message}`);
      }
    } finally {
      setConnecting(false);
    }
  }, [boards]);

  const playFile = useCallback(
    async (sample: SampleFile) => {
      setError(null);
      sampleRef.current?.stop();
      setPlaying(sample.file);
      try {
        const handle = await playSample(
          withBasePath(`/audio/${encodeURIComponent(sample.file)}`),
          sensorDeviceId,
          (features) => publish(sensorDeviceId, "sample", features),
        );
        sampleRef.current = handle;
        await handle.done;
      } catch (err) {
        setError(`Не удалось проиграть файл: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        sampleRef.current = null;
        setPlaying((current) => (current === sample.file ? null : current));
      }
    },
    [sensorDeviceId, publish],
  );

  const live = target?.live ?? null;
  const classification = target?.classification ?? null;
  const top = topSoundClass(classification);
  const listeningBoards = boards.boards.filter((b) => b.state === "listening").length;
  const listening = listeningBoards > 0 || micOn || playing !== null;

  const summary =
    listeningBoards > 0
      ? `${listeningBoards} ${plural(listeningBoards, "плата", "платы", "плат")}${micOn ? " + микрофон" : ""}`
      : micOn
        ? "микрофон ноутбука"
        : playing
          ? "проигрывание файла"
          : "не слушает";

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
          <span className="text-[15px] font-medium">Датчики</span>
          <span className="min-w-0 truncate text-[12px] text-muted">{summary}</span>
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
          {/* ── Boards over USB ─────────────────────────────────────── */}
          <div className="mb-1.5 flex items-baseline justify-between">
            <p className="stat-label">Платы по USB</p>
            {boards.supported && boards.boards.length > 0 && (
              <span className="text-[11px] text-faint">подключаются сами</span>
            )}
          </div>

          {boards.boards.length > 0 && (
            <ul className="mb-2 space-y-1.5">
              {boards.boards.map((board) => (
                <BoardRow
                  key={board.key}
                  board={board}
                  devices={devices}
                  onBind={(deviceId) => boards.bind(board.key, deviceId)}
                  onDisconnect={() => boards.disconnect(board.key)}
                  onOpen={() => board.deviceId && onSelectDevice(board.deviceId)}
                />
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => void connectBoard()}
            disabled={!boards.supported || connecting}
            title={
              boards.supported
                ? "Выбрать COM-порт платы ESP32-S3"
                : "Web Serial есть только в Chrome и Edge"
            }
            className={`${buttonClass} w-full bg-raised text-ink hover:bg-raised/70`}
          >
            {connecting
              ? "Выбор порта…"
              : boards.boards.length > 0
                ? "Подключить ещё плату"
                : "Подключить плату ESP32"}
          </button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
            {boards.supported
              ? "Выбрать порт нужно один раз. Дальше плата подключается сама, как только её воткнули, и находит своё устройство по ID."
              : "Web Serial есть только в Chrome и Edge."}
          </p>

          {/* ── The laptop's own sound ─────────────────────────────── */}
          <div className="mt-4 border-t border-white/[0.06] pt-3">
            <label className="stat-label mb-1.5 block">Микрофон и файлы → устройство</label>
            <select
              value={sensorDeviceId}
              onChange={(event) => onSensorDeviceChange(event.target.value)}
              disabled={devices.length === 0}
              className={`${selectClass} mb-2`}
            >
              {devices.length === 0 && <option value="">сначала добавьте устройство</option>}
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void toggleMic()}
              disabled={!target}
              className={`${buttonClass} w-full ${
                micOn ? "bg-accent text-canvas" : "bg-raised text-ink hover:bg-raised/70"
              }`}
            >
              {micOn ? "Выключить микрофон" : "Микрофон ноутбука"}
            </button>
          </div>

          {error && (
            <p className="mt-2.5 rounded-xl bg-alarm-soft px-3 py-2 text-[12px] leading-relaxed text-alarm">
              {error}
            </p>
          )}

          {/* ── Verdict for the selected device ─────────────────────── */}
          <div className="mt-3 rounded-xl bg-white/[0.04] p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[17px] font-medium tracking-tightest">
                {live && top ? SOUND_CLASS_LABELS[top.name] : target ? target.name : "—"}
                {live && top && (
                  <span
                    className={`ml-2 align-middle text-[11px] font-semibold uppercase tracking-[0.06em] ${
                      SOUND_SAFETY[top.name] === "danger" ? "text-alarm" : "text-accent"
                    }`}
                  >
                    {SAFETY_LABELS[SOUND_SAFETY[top.name]]}
                  </span>
                )}
              </span>
              <span className="text-[22px] font-semibold tabular-nums">
                {live && top ? `${top.value}%` : "—"}
              </span>
            </div>

            {live?.reasons.length ? (
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                Почему: {live.reasons.join(", ")}
              </p>
            ) : (
              <p className="mt-1 text-[12px] text-faint">
                {target
                  ? "Подключите плату, включите микрофон или проиграйте файл — сайт разберёт звук."
                  : "Добавьте устройство, чтобы было к чему привязать звук."}
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

            {/*
              Уровень на самом дне шкалы — это не тихая комната, а полное
              отсутствие звука: у любого живого микрофона есть собственный шум.
              Значит, источник выбран не тот, выключен или отдаёт нули. Молча
              показывать «Тишина 99%» в этом случае — врать: плата в такой
              ситуации пишет в порт, что микрофон молчит, сайт теперь тоже.
            */}
            {live && live.rms <= SILENT_INPUT_DB && (
              <p className="mt-2 rounded-lg bg-alarm-soft px-3 py-2 text-[12px] leading-relaxed text-alarm">
                Звук не приходит: уровень на нуле. Проверьте, что выбран нужный микрофон и он не
                выключен в системе, дайте сайту доступ к микрофону и попробуйте ещё раз. С платой —
                что она шлёт кадры и что Монитор порта закрыт.
              </p>
            )}
          </div>

          {/* All six classes */}
          {live && classification && (
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
                    key={sample.file}
                    type="button"
                    onClick={() => void playFile(sample)}
                    disabled={playing !== null || !target}
                    className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-all duration-300 ease-apple active:scale-95 disabled:opacity-40 ${
                      playing === sample.file
                        ? "bg-accent text-canvas"
                        : "bg-raised text-ink hover:bg-raised/70"
                    }`}
                  >
                    {sample.title ?? sample.expectedLabel ?? sample.name}
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
