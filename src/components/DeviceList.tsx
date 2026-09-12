"use client";

import { BatteryIcon, StatusPill } from "@/components/BatteryIcon";
import { formatRelativeTime } from "@/lib/time";
import type { Board } from "@/hooks/useBoards";
import {
  SAFETY_LABELS,
  SOUND_CLASS_LABELS,
  SOUND_SAFETY,
  topSoundClass,
  type Device,
  type DeviceFilter,
} from "@/lib/types";

interface DeviceListProps {
  devices: Device[];
  /** Connected boards, to show which devices have a GPS behind them. */
  boards: Board[];
  /** How many exist before filtering, to tell "nothing matches" from "nothing at all". */
  total: number;
  filter: DeviceFilter;
  selectedId: string | null;
  onSelect: (device: Device) => void;
  onAdd: () => void;
  onRestoreDefaults: () => void;
  now: number;
  loading: boolean;
}

const EMPTY_FILTER: Record<DeviceFilter, string> = {
  all: "Здесь пусто.",
  alert: "Тревог нет.",
  online: "Сейчас никто не в сети. Подключите плату или включите микрофон.",
  offline: "Все устройства в сети.",
};

export function DeviceList({
  devices,
  boards,
  total,
  filter,
  selectedId,
  onSelect,
  onAdd,
  onRestoreDefaults,
  now,
  loading,
}: DeviceListProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-[96px] animate-pulse rounded-2xl bg-white/[0.04]"
            style={{ animationDelay: `${index * 90}ms` }}
          />
        ))}
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="animate-fade-up px-1 py-10 text-center">
        <p className="text-[15px] font-medium">Устройств пока нет</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          Добавьте точку на карте — или просто подключите плату по USB, и она появится сама.
        </p>
        <button
          type="button"
          onClick={onAdd}
          className="mt-5 rounded-full bg-accent px-5 py-2.5 text-[13px] font-medium text-canvas transition-all duration-300 ease-apple hover:bg-accent-dim active:scale-95"
        >
          Добавить устройство
        </button>
        <button
          type="button"
          onClick={onRestoreDefaults}
          className="mt-3 block w-full text-[12px] text-faint transition-colors duration-300 ease-apple hover:text-muted"
        >
          Вернуть шесть точек в Иле-Алатау
        </button>
      </div>
    );
  }

  if (devices.length === 0) {
    return (
      <p className="px-1 py-10 text-center text-[14px] leading-relaxed text-muted">
        {EMPTY_FILTER[filter]}
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {devices.map((device) => {
        const selected = device.id === selectedId;
        const top = topSoundClass(device.classification);
        const alert = device.status === "alert";
        const gps = boards.find((board) => board.deviceId === device.id && board.state === "listening")?.gps;

        return (
          <li key={device.id}>
            <button
              type="button"
              onClick={() => onSelect(device)}
              aria-current={selected}
              className={`w-full rounded-2xl bg-surface p-4 text-left shadow-card transition-all duration-300 ease-apple hover:scale-[1.015] hover:bg-raised/70 hover:shadow-lifted active:scale-[0.99] ${
                selected ? "ring-2 ring-accent" : ""
              } ${device.status === "offline" ? "opacity-80" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 truncate text-[15px] font-medium">{device.name}</span>
                <StatusPill status={device.status} compact />
              </div>

              <p className="mt-1.5 truncate text-[13px] text-muted">
                {alert && device.soundType
                  ? device.soundType
                  : top && device.status === "online"
                    ? `${SOUND_CLASS_LABELS[top.name]} ${Math.round(top.value)}% · ${SAFETY_LABELS[SOUND_SAFETY[top.name]]}`
                    : formatRelativeTime(device.lastSignal, now)}
              </p>

              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="truncate font-mono text-[11px] uppercase tracking-[0.06em] text-faint">
                  {alert
                    ? formatRelativeTime(device.lastSignal, now)
                    : device.status === "online"
                      ? gps
                        ? gps.fix
                          ? `GPS · ${gps.sats} спут.`
                          : gps.seen
                            ? "GPS ищет спутники"
                            : "GPS молчит"
                        : "слушает сейчас"
                      : top
                        ? `${device.id} · ${SOUND_CLASS_LABELS[top.name]} ${Math.round(top.value)}%`
                        : device.id}
                </span>
                <BatteryIcon level={device.battery} />
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
