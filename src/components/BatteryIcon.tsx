import type { DeviceStatus } from "@/lib/types";

/** Battery colour crosses into warning territory before it turns alarming. */
function batteryTone(level: number) {
  if (level <= 15) return { bar: "bg-alarm", fill: "fill-alarm", text: "text-alarm" };
  if (level <= 35) return { bar: "bg-warn", fill: "fill-warn", text: "text-warn" };
  return { bar: "bg-accent", fill: "fill-white/80", text: "text-ink" };
}

interface BatteryIconProps {
  /** 0–100 */
  level: number;
  className?: string;
}

/** Compact readout for list rows: iOS status-bar shell plus a percentage. */
export function BatteryIcon({ level, className = "" }: BatteryIconProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(level)));
  const tone = batteryTone(clamped);

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <svg width="25" height="12" viewBox="0 0 27 13" fill="none" aria-hidden="true" className="shrink-0">
        <rect x="0.5" y="0.5" width="23" height="12" rx="3.6" className="stroke-white/25" strokeWidth="1" />
        <path d="M25 4.4v4.2a2.4 2.4 0 0 0 0-4.2Z" className="fill-white/25" />
        <rect
          x="2"
          y="2"
          width={Math.max(clamped === 0 ? 0 : 2, (20 * clamped) / 100)}
          height="9"
          rx="2.2"
          className={`${tone.fill} transition-all duration-300 ease-apple`}
        />
      </svg>
      <span className={`text-[13px] font-medium tabular-nums ${tone.text}`}>{clamped}%</span>
    </span>
  );
}

/**
 * Panel readout: a big numeral with a small caption and a thin rail beneath —
 * the Health-app stat card, not a gauge.
 */
export function BatteryStat({ level }: { level: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(level)));
  const tone = batteryTone(clamped);

  return (
    <div className="rounded-2xl bg-white/[0.04] p-4">
      <div className="flex items-baseline gap-1">
        <span className="text-[34px] font-semibold leading-none tracking-tightest tabular-nums">
          {clamped}
        </span>
        <span className="text-[17px] font-medium text-muted">%</span>
      </div>
      <p className="stat-label mt-2">Заряд</p>
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full origin-left rounded-full ${tone.bar} animate-grow transition-all duration-500 ease-apple`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

/** Generic Health-style tile: big numeral over a small uppercase caption. */
export function StatTile({
  value,
  label,
  tone = "ink",
}: {
  value: number | string;
  label: string;
  tone?: "ink" | "accent" | "alarm";
}) {
  const colour =
    tone === "accent" ? "text-accent" : tone === "alarm" ? "text-alarm" : "text-ink";

  return (
    <div className="flex flex-col">
      <span
        className={`text-[26px] font-semibold leading-none tracking-tightest tabular-nums transition-colors duration-300 ease-apple ${colour}`}
      >
        {value}
      </span>
      <span className="stat-label mt-1.5">{label}</span>
    </div>
  );
}

interface StatusPillProps {
  status: DeviceStatus;
  /** Compact drops the dot's breathing room for tight rows. */
  compact?: boolean;
  className?: string;
}

/** Soft tinted pill — a dot plus a word, no border. */
export function StatusPill({ status, compact = false, className = "" }: StatusPillProps) {
  const alert = status === "alert";

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium transition-colors duration-300 ease-apple ${
        compact ? "px-2 py-[3px] text-[11px]" : "px-2.5 py-1 text-[12px]"
      } ${alert ? "bg-alarm-soft text-alarm" : "bg-accent-soft text-accent"} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${alert ? "bg-alarm" : "bg-accent"}`} />
      {alert ? "Тревога" : "В сети"}
    </span>
  );
}

export function StatusDot({ status, className = "" }: { status: DeviceStatus; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2 w-2 shrink-0 rounded-full transition-colors duration-300 ease-apple ${
        status === "alert" ? "bg-alarm" : "bg-accent"
      } ${className}`}
    />
  );
}
