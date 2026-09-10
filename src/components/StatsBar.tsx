"use client";

import { StatTile } from "@/components/BatteryIcon";

interface StatsBarProps {
  total: number;
  online: number;
  alerts: number;
}

/**
 * Three Health-style tiles: a bold numeral over a small uppercase caption.
 * Online and alert counts pick up colour only when they mean something.
 */
export function StatsBar({ total, online, alerts }: StatsBarProps) {
  return (
    <div className="grid grid-cols-3 gap-2 rounded-2xl bg-surface p-4 shadow-card">
      <StatTile value={total} label="Устройств" />
      <StatTile value={online} label="В сети" tone={online > 0 ? "accent" : "ink"} />
      <StatTile value={alerts} label="Тревог" tone={alerts > 0 ? "alarm" : "ink"} />
    </div>
  );
}
