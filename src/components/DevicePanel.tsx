"use client";

import { useEffect, useState } from "react";

import { BatteryStat, StatusPill } from "@/components/BatteryIcon";
import type { Board } from "@/hooks/useBoards";
import { formatClock, formatRelativeTime } from "@/lib/time";
import {
  SOUND_CLASSES,
  SOUND_CLASS_LABELS,
  SOURCE_LABELS,
  type Classification,
  type Device,
  type SoundEvent,
} from "@/lib/types";

interface DevicePanelProps {
  device: Device | null;
  /** The ESP32 currently feeding this device, if one is. */
  board: Board | null;
  /** This device's alerts, newest first. */
  events: SoundEvent[];
  now: number;
  onClose: () => void;
  onEdit: (device: Device) => void;
  onMove: (device: Device) => void;
  onDelete: (device: Device) => void;
  onWriteId: (board: Board) => Promise<void>;
}

/** A thin rounded rail with the label beside it and the value muted after it. */
function ConfidenceBar({ label, value, lead }: { label: string; value: number; lead: boolean }) {
  const pct = Math.max(0, Math.min(100, value));

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-[13px] ${lead ? "font-medium text-ink" : "text-muted"}`}>
          {label}
        </span>
        <span className="text-[12px] tabular-nums text-faint">{Math.round(pct)}%</span>
      </div>
      <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className={`h-full origin-left rounded-full transition-all duration-500 ease-apple ${
            lead ? "bg-accent" : "bg-white/25"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ClassificationSection({
  classification,
  stale,
}: {
  classification: Classification;
  stale: boolean;
}) {
  // Strongest class first; it is the one that earns the accent colour.
  const ranked = [...SOUND_CLASSES].sort((a, b) => classification[b] - classification[a]);
  const leader = ranked[0];

  return (
    <div className="mt-6">
      <h3 className="stat-label mb-3">{stale ? "Последнее распознавание" : "Распознавание звука"}</h3>
      <div className={`space-y-3 rounded-2xl bg-white/[0.04] p-4 ${stale ? "opacity-70" : ""}`}>
        {ranked.map((name) => (
          <ConfidenceBar
            key={name}
            label={SOUND_CLASS_LABELS[name]}
            value={classification[name]}
            lead={name === leader}
          />
        ))}
      </div>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] p-4">
      <p className="truncate text-[17px] font-medium tabular-nums">{value}</p>
      <p className="stat-label mt-1.5">{label}</p>
    </div>
  );
}

function ActionButton({
  onClick,
  children,
  tone = "default",
  disabled = false,
}: {
  onClick: () => void;
  children: React.ReactNode;
  tone?: "default" | "danger";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-300 ease-apple active:scale-[0.98] disabled:opacity-40 ${
        tone === "danger"
          ? "bg-alarm-soft text-alarm hover:bg-alarm/20"
          : "bg-raised text-ink hover:bg-raised/70"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * iOS sheet: a bottom sheet on mobile, a side panel on desktop.
 * The last device is kept during the close transition so the panel can
 * animate out with its content intact.
 */
export function DevicePanel({
  device,
  board,
  events,
  now,
  onClose,
  onEdit,
  onMove,
  onDelete,
  onWriteId,
}: DevicePanelProps) {
  const [shown, setShown] = useState<Device | null>(device);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [writing, setWriting] = useState<"idle" | "busy" | "done" | "failed">("idle");

  useEffect(() => {
    if (device) {
      setShown(device);
      return;
    }
    const timer = window.setTimeout(() => setShown(null), 350);
    return () => window.clearTimeout(timer);
  }, [device]);

  // A different device: forget the half-finished delete and the write result.
  useEffect(() => {
    setConfirmDelete(false);
    setWriting("idle");
  }, [device?.id]);

  useEffect(() => {
    if (!device) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [device, onClose]);

  const open = Boolean(device);
  if (!shown) return null;

  const alert = shown.status === "alert";
  const offline = shown.status === "offline";
  const boardNeedsId = board !== null && board.boardId !== null && board.boardId !== shown.id;

  const writeId = async () => {
    if (!board) return;
    setWriting("busy");
    try {
      await onWriteId(board);
      setWriting("done");
    } catch {
      setWriting("failed");
    }
  };

  return (
    <>
      {/* Scrim, mobile only — desktop keeps the map interactive */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/45 transition-opacity duration-300 ease-apple md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        role="dialog"
        aria-modal="false"
        aria-label={`${shown.name} — подробности`}
        className={`glass fixed z-50 flex flex-col shadow-lifted transition-transform duration-300 ease-apple
          inset-x-0 bottom-0 max-h-[86vh] rounded-t-4xl
          md:inset-y-auto md:bottom-auto md:left-auto md:right-6 md:top-[76px] md:max-h-[calc(100vh-100px)] md:w-[392px] md:rounded-3xl
          ${open ? "translate-y-0 md:translate-x-0" : "translate-y-full md:translate-y-0 md:translate-x-[calc(100%+2rem)]"}`}
      >
        {/* Grabber — the iOS sheet affordance */}
        <div className="flex justify-center pt-2.5 md:hidden">
          <span className="h-[5px] w-9 rounded-full bg-white/25" />
        </div>

        <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-4 md:pt-6">
          <div className="min-w-0">
            <h2 className="truncate text-[24px] font-semibold tracking-tightest">{shown.name}</h2>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-faint">
              {shown.id}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-muted transition-all duration-300 ease-apple hover:bg-white/20 hover:text-ink active:scale-90"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="scrollbar-none overflow-y-auto overscroll-contain px-6 pb-8">
          <div className="flex items-center gap-2.5">
            <StatusPill status={shown.status} />
            <span className="truncate text-[13px] text-muted">
              {alert
                ? shown.soundType
                  ? `Обнаружено: ${shown.soundType.toLowerCase()}`
                  : "Обнаружен неопознанный звук"
                : offline
                  ? shown.lastSignal
                    ? `Молчит. Последний сигнал ${formatRelativeTime(shown.lastSignal, now)}`
                    : "Ещё ни разу не выходило на связь"
                  : "Слушает. Ничего необычного."}
            </span>
          </div>

          {/* The board behind this device, and the one thing it may need:
              to be told its own id so it finds this device on any laptop. */}
          {board && (
            <div className="mt-4 rounded-2xl bg-white/[0.04] p-4">
              <p className="stat-label mb-2">Плата</p>
              <p className="text-[13px] leading-relaxed text-muted">
                {board.label}
                {board.firmware && ` · прошивка ${board.firmware}`}
                {board.boardId && (
                  <>
                    {" · представляется как "}
                    <span className="font-mono text-ink">{board.boardId}</span>
                  </>
                )}
              </p>
              {board.mic && board.mic !== "ok" && (
                <p className="mt-2 rounded-xl bg-alarm-soft px-3 py-2 text-[12px] leading-relaxed text-alarm">
                  Микрофон: {board.mic}
                </p>
              )}
              {boardNeedsId && (
                <div className="mt-3">
                  <p className="text-[12px] leading-relaxed text-faint">
                    Плата привязана к этому устройству только на этом ноутбуке. Запишите ID в
                    плату — и она будет находить его везде.
                  </p>
                  <button
                    type="button"
                    onClick={() => void writeId()}
                    disabled={writing === "busy" || writing === "done"}
                    className="mt-2.5 w-full rounded-xl bg-accent px-3 py-2.5 text-[13px] font-medium text-canvas transition-all duration-300 ease-apple hover:bg-accent-dim active:scale-[0.98] disabled:opacity-60"
                  >
                    {writing === "busy"
                      ? "Записываю…"
                      : writing === "done"
                        ? `Записано: ${shown.id}`
                        : writing === "failed"
                          ? "Не удалось — попробовать ещё раз"
                          : `Записать ${shown.id} в плату`}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* What the classifier keyed on. The point of the demo is that the
              verdict can be justified, not just displayed. */}
          {shown.live && shown.live.reasons.length > 0 && (
            <div className="mt-4 rounded-2xl bg-white/[0.04] p-4">
              <p className="stat-label mb-2">Почему такой вывод</p>
              <ul className="space-y-1">
                {shown.live.reasons.map((reason) => (
                  <li key={reason} className="flex gap-2 text-[13px] leading-relaxed text-muted">
                    <span className="text-accent">•</span>
                    {reason}
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[11px] text-faint">
                Источник: {SOURCE_LABELS[shown.live.source]} · уровень{" "}
                {shown.live.rms.toFixed(0)} дБ
              </p>
            </div>
          )}

          {shown.classification && (
            <ClassificationSection classification={shown.classification} stale={offline} />
          )}

          {events.length > 0 && (
            <div className="mt-6">
              <h3 className="stat-label mb-3">Журнал тревог</h3>
              <ul className="divide-y divide-white/[0.06] rounded-2xl bg-white/[0.04] px-4">
                {events.slice(0, 8).map((event) => (
                  <li key={event.id} className="flex items-baseline justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="text-[13px] font-medium">{SOUND_CLASS_LABELS[event.sound]}</span>
                      <span className="ml-2 text-[12px] tabular-nums text-muted">{event.value}%</span>
                      <span className="mt-0.5 block truncate text-[11px] text-faint">
                        {event.reasons.join(", ") || SOURCE_LABELS[event.source]}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] tabular-nums text-faint" title={formatClock(event.at)}>
                      {formatRelativeTime(new Date(event.at), now)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-3">
            <BatteryStat level={shown.battery} />
            <InfoTile label="Последний сигнал" value={formatRelativeTime(shown.lastSignal, now)} />
          </div>

          <div className="mt-3">
            <InfoTile
              label="Координаты"
              value={`${shown.lat.toFixed(4)}, ${shown.lng.toFixed(4)}`}
            />
          </div>

          <div className="mt-6 flex gap-2">
            <ActionButton onClick={() => onEdit(shown)}>Изменить</ActionButton>
            <ActionButton onClick={() => onMove(shown)}>Переставить</ActionButton>
          </div>
          <div className="mt-2 flex gap-2">
            {confirmDelete ? (
              <>
                <ActionButton onClick={() => setConfirmDelete(false)}>Оставить</ActionButton>
                <ActionButton tone="danger" onClick={() => onDelete(shown)}>
                  Удалить навсегда
                </ActionButton>
              </>
            ) : (
              <ActionButton tone="danger" onClick={() => setConfirmDelete(true)}>
                Удалить устройство
              </ActionButton>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
