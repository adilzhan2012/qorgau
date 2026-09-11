"use client";

import type { DeviceFilter } from "@/lib/types";

interface SegmentedControlProps {
  value: DeviceFilter;
  onChange: (value: DeviceFilter) => void;
  counts: Record<DeviceFilter, number>;
}

const OPTIONS: { value: DeviceFilter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "alert", label: "Тревога" },
  { value: "online", label: "В сети" },
  { value: "offline", label: "Молчат" },
];

/**
 * iOS segmented control: a recessed pill track with a single raised pill that
 * slides between the options.
 */
export function SegmentedControl({ value, onChange, counts }: SegmentedControlProps) {
  const index = OPTIONS.findIndex((option) => option.value === value);

  return (
    <div
      role="tablist"
      aria-label="Фильтр устройств"
      className="relative flex rounded-full bg-black/25 p-[3px]"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-[3px] left-0 rounded-full bg-raised shadow-sm transition-transform duration-300 ease-apple"
        style={{
          width: `calc((100% - 6px) / ${OPTIONS.length})`,
          transform: `translateX(calc(${index} * 100% + 3px))`,
        }}
      />
      {OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={`relative z-10 flex-1 rounded-full px-2 py-[7px] text-[12px] font-medium transition-colors duration-300 ease-apple ${
              selected ? "text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
            <span className="ml-1.5 tabular-nums opacity-50">{counts[option.value]}</span>
          </button>
        );
      })}
    </div>
  );
}
