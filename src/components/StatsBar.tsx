"use client";

import { StatTile } from "@/components/BatteryIcon";

interface StatsBarProps {
  total: number;
  /** Devices something is actually feeding right now, alerts included. */
  online: number;
  alerts: number;
  onAdd: () => void;
}

/**
 * Three Health-style tiles: a bold numeral over a small uppercase caption.
 * Online and alert counts pick up colour only when they mean something.
 */
export function StatsBar({ total, online, alerts, onAdd }: StatsBarProps) {
  return (
    <div className="relative grid grid-cols-3 gap-2 rounded-2xl bg-surface p-4 shadow-card">
      <StatTile value={total} label="Устройств" />
      <StatTile value={online} label="В сети" tone={online > 0 ? "accent" : "ink"} />
      <StatTile value={alerts} label="Тревог" tone={alerts > 0 ? "alarm" : "ink"} />
      <button
        type="button"
        onClick={onAdd}
        aria-label="Добавить устройство"
        title="Добавить устройство"
        className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-accent text-canvas shadow-card transition-all duration-300 ease-apple hover:bg-accent-dim active:scale-90"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
