"use client";

import { BatteryIcon, StatusPill } from "@/components/BatteryIcon";
import { formatRelativeTime } from "@/lib/time";
import { SOUND_CLASS_LABELS, topSoundClass, type Device } from "@/lib/types";

interface DeviceListProps {
  devices: Device[];
  selectedId: string | null;
  onSelect: (device: Device) => void;
  now: number;
  loading: boolean;
}

export function DeviceList({ devices, selectedId, onSelect, now, loading }: DeviceListProps) {
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

  if (devices.length === 0) {
    return <p className="px-1 py-10 text-center text-[15px] text-muted">Здесь пусто.</p>;
  }

  return (
    <ul className="space-y-3">
      {devices.map((device) => {
        const selected = device.id === selectedId;
        const top = topSoundClass(device.classification);

        return (
          <li key={device.id}>
            <button
              type="button"
              onClick={() => onSelect(device)}
              aria-current={selected}
              className={`w-full rounded-2xl bg-surface p-4 text-left shadow-card transition-all duration-300 ease-apple hover:scale-[1.015] hover:bg-raised/70 hover:shadow-lifted active:scale-[0.99] ${
                selected ? "ring-2 ring-accent" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 truncate text-[15px] font-medium">{device.name}</span>
                <StatusPill status={device.status} compact />
              </div>

              <p className="mt-1.5 truncate text-[13px] text-muted">
                {device.status === "alert" && device.soundType
                  ? device.soundType
                  : formatRelativeTime(device.lastSignal, now)}
              </p>

              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="truncate text-[12px] text-faint">
                  {device.status === "alert"
                    ? formatRelativeTime(device.lastSignal, now)
                    : top
                      ? `${SOUND_CLASS_LABELS[top.name]} ${Math.round(top.value)}%`
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
