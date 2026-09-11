"use client";

import type { Device } from "@/lib/types";

interface DeviceMarkerProps {
  device: Device;
  selected: boolean;
}

/**
 * A clean dot with a soft glow ring. Alerting devices get a slow breathing
 * halo — a fade/scale, deliberately not a radar sweep or a blink. Devices
 * nobody is listening to sit grey and unlit, so the map says honestly which
 * of them are real right now.
 */
export function DeviceMarker({ device, selected }: DeviceMarkerProps) {
  const alert = device.status === "alert";
  const offline = device.status === "offline";
  const tone = alert ? "bg-alarm" : offline ? "bg-faint" : "bg-accent";
  const glow = alert
    ? "shadow-[0_0_12px_3px_rgba(232,112,95,0.55)]"
    : offline
      ? "shadow-[0_0_6px_1px_rgba(0,0,0,0.35)]"
      : "shadow-[0_0_12px_3px_rgba(53,208,127,0.45)]";

  return (
    <span className="relative flex h-7 w-7 items-center justify-center">
      {alert && (
        <span className={`absolute inset-0 animate-breathe rounded-full ${tone}`} />
      )}

      {/* Soft halo behind the dot, so it reads on both dark and satellite */}
      {!offline && <span className={`absolute h-5 w-5 rounded-full opacity-25 ${tone}`} />}

      <span
        className={`relative block rounded-full ring-2 transition-all duration-300 ease-apple ${
          offline ? "ring-white/45" : "ring-white/85"
        } ${tone} ${glow} ${
          selected ? "h-[17px] w-[17px]" : "h-[12px] w-[12px]"
        }`}
      />

      {selected && (
        <span
          className={`absolute inset-0 rounded-full ring-2 ${
            alert ? "ring-alarm/45" : offline ? "ring-white/30" : "ring-accent/45"
          }`}
        />
      )}
    </span>
  );
}
