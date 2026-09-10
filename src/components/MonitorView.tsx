"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { DeviceList } from "@/components/DeviceList";
import { DeviceMap } from "@/components/DeviceMap";
import { DevicePanel } from "@/components/DevicePanel";
import { Header, type ConnectionState } from "@/components/Header";
import { SegmentedControl } from "@/components/SegmentedControl";
import { SensorPanel } from "@/components/SensorPanel";
import { StatsBar } from "@/components/StatsBar";
import { useDevices } from "@/hooks/useDevices";
import { useNow } from "@/hooks/useNow";
import { DEFAULT_SENSOR_DEVICE } from "@/lib/fallbackDevices";
import type { Device, DeviceFilter } from "@/lib/types";

/** Soft glass notice shown over the map. */
function MapNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass absolute inset-x-4 top-4 z-10 animate-fade-up rounded-2xl px-5 py-4 shadow-lifted md:left-1/2 md:right-auto md:w-[420px] md:-translate-x-1/2">
      <p className="text-[15px] font-medium">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{children}</p>
    </div>
  );
}

export function MonitorView() {
  const { devices, loading, error, stalled, liveConnected } = useDevices();
  const now = useNow();
  const mapRef = useRef<MapRef | null>(null);

  const [filter, setFilter] = useState<DeviceFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [sensorDeviceId, setSensorDeviceId] = useState(DEFAULT_SENSOR_DEVICE);

  const counts = useMemo(
    () => ({
      all: devices.length,
      alert: devices.filter((device) => device.status === "alert").length,
      normal: devices.filter((device) => device.status === "normal").length,
    }),
    [devices],
  );

  // The sensor stream is the connection that matters here: it carries the live
  // readings and works whether or not Firestore is reachable.
  const connection: ConnectionState = liveConnected
    ? "live"
    : error
      ? "offline"
      : "connecting";

  const visible = useMemo(
    () => (filter === "all" ? devices : devices.filter((device) => device.status === filter)),
    [devices, filter],
  );

  // Read through the live list so the panel follows realtime updates.
  const selected = useMemo(
    () => devices.find((device) => device.id === selectedId) ?? null,
    [devices, selectedId],
  );

  const sensorTarget = useMemo(
    () => devices.find((device) => device.id === sensorDeviceId) ?? null,
    [devices, sensorDeviceId],
  );

  const select = useCallback((device: Device) => {
    setSelectedId(device.id);
    setListOpen(false);
    mapRef.current?.flyTo({
      center: [device.lng, device.lat],
      zoom: Math.max(13.5, mapRef.current.getZoom()),
      duration: 1400,
      essential: true,
    });
  }, []);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      <Header connection={connection} />

      <div className="relative flex min-h-0 flex-1">
        {/* Sidebar — a drawer under md, a column from md up */}
        <aside
          className={`absolute inset-y-0 left-0 z-30 flex w-[85%] max-w-[344px] flex-col bg-canvas transition-transform duration-300 ease-apple
            md:relative md:w-[344px] md:translate-x-0
            ${listOpen ? "translate-x-0 shadow-lifted" : "-translate-x-full md:shadow-none"}`}
        >
          <div className="space-y-3 px-5 pb-4 pt-5">
            <StatsBar total={devices.length} online={counts.normal} alerts={counts.alert} />
            <SegmentedControl value={filter} onChange={setFilter} counts={counts} />
          </div>
          <div className="scrollbar-none flex-1 overflow-y-auto px-5 pb-8">
            <DeviceList
              devices={visible}
              selectedId={selectedId}
              onSelect={select}
              now={now}
              loading={loading}
            />
          </div>
        </aside>

        {listOpen && (
          <div
            onClick={() => setListOpen(false)}
            aria-hidden="true"
            className="absolute inset-0 z-20 animate-fade-in bg-black/45 md:hidden"
          />
        )}

        <main className="relative min-w-0 flex-1">
          <DeviceMap devices={visible} selectedId={selectedId} onSelect={select} mapRef={mapRef} />

          {/* Drawer handle, mobile only */}
          <button
            type="button"
            onClick={() => setListOpen(true)}
            className="glass absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-medium shadow-card transition-all duration-300 ease-apple active:scale-95 md:hidden"
          >
            <svg width="13" height="11" viewBox="0 0 13 11" aria-hidden="true">
              <path
                d="M1 1.5h11M1 5.5h11M1 9.5h11"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            Устройства
          </button>

          <SensorPanel
            devices={devices}
            sensorDeviceId={sensorDeviceId}
            onSensorDeviceChange={setSensorDeviceId}
            target={sensorTarget}
          />

          {/* Firestore only supplies the roster, and a local one stands in for
              it, so these are notices rather than blockers. */}
          {error && (
            <MapNotice title="Firestore недоступен">
              Показан встроенный список устройств. Распознавание звука работает.
            </MapNotice>
          )}

          {stalled && !error && (
            <MapNotice title="Firestore не отвечает">
              Показан встроенный список устройств. Распознавание звука работает.
            </MapNotice>
          )}
        </main>

        <DevicePanel device={selected} onClose={() => setSelectedId(null)} now={now} />
      </div>
    </div>
  );
}
