"use client";

import { useEffect, useState } from "react";
import { AudioPlayer } from "@/components/AudioPlayer";
import { BatteryStat, StatusPill } from "@/components/BatteryIcon";
import { formatRelativeTime } from "@/lib/time";
import {
  SOUND_CLASSES,
  SOUND_CLASS_LABELS,
  SOURCE_LABELS,
  type Classification,
  type Device,
} from "@/lib/types";

interface DevicePanelProps {
  device: Device | null;
  onClose: () => void;
  now: number;
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

function ClassificationSection({ classification }: { classification: Classification }) {
  // Strongest class first; it is the one that earns the accent colour.
  const ranked = [...SOUND_CLASSES].sort((a, b) => classification[b] - classification[a]);
  const leader = ranked[0];

  return (
    <div className="mt-6">
      <h3 className="stat-label mb-3">Распознавание звука</h3>
      <div className="space-y-3 rounded-2xl bg-white/[0.04] p-4">
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

/**
 * iOS sheet: a bottom sheet on mobile, a side panel on desktop.
 * The last device is kept during the close transition so the panel can
 * animate out with its content intact.
 */
export function DevicePanel({ device, onClose, now }: DevicePanelProps) {
  const [shown, setShown] = useState<Device | null>(device);

  useEffect(() => {
    if (device) {
      setShown(device);
      return;
    }
    const timer = window.setTimeout(() => setShown(null), 350);
    return () => window.clearTimeout(timer);
  }, [device]);

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
                : "Слушает. Ничего необычного."}
            </span>
          </div>

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

          {shown.classification && <ClassificationSection classification={shown.classification} />}

          {alert && shown.audioUrl && (
            <div className="mt-6">
              <h3 className="stat-label mb-3">Запись</h3>
              <AudioPlayer src={shown.audioUrl} seed={shown.id} />
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
        </div>
      </aside>
    </>
  );
}
