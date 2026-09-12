"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";

import { DeviceForm, type DeviceFormValues } from "@/components/DeviceForm";
import { DeviceList } from "@/components/DeviceList";
import { DeviceMap, type LatLng } from "@/components/DeviceMap";
import { DevicePanel } from "@/components/DevicePanel";
import { Header, type ConnectionState } from "@/components/Header";
import { SegmentedControl } from "@/components/SegmentedControl";
import { SensorPanel } from "@/components/SensorPanel";
import { StatsBar } from "@/components/StatsBar";
import { useBoards, type Board } from "@/hooks/useBoards";
import { useDeviceStore } from "@/hooks/useDeviceStore";
import { useDevices } from "@/hooks/useDevices";
import { useNow } from "@/hooks/useNow";
import { useReadings } from "@/hooks/useReadings";
import { PARK_CENTER } from "@/lib/devices/store";
import { distanceMeters } from "@/lib/geo";
import { plural } from "@/lib/time";
import type { Device, DeviceFilter } from "@/lib/types";

/** Soft glass notice shown over the map, gone by itself after a moment. */
function MapNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    // The centring transform sits on the wrapper: the fade-up animation owns
    // `transform` on the card and would cancel it.
    <div className="absolute inset-x-4 top-16 z-10 md:left-1/2 md:right-auto md:top-4 md:w-[420px] md:-translate-x-1/2">
      <div className="glass animate-fade-up rounded-2xl px-5 py-4 shadow-lifted">
        <p className="text-[15px] font-medium">{title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{children}</p>
      </div>
    </div>
  );
}

interface Notice {
  title: string;
  text: string;
}

interface FormState {
  mode: "add" | "edit";
  initial: DeviceFormValues;
}

const NOTICE_MS = 7000;

/** Below this the marker stays put; typical GPS jitter is 2–5 m. */
const GPS_MOVE_METERS = 8;

export function MonitorView() {
  // Everything lives in this page: the roster in localStorage, the readings in
  // memory, the classifier in the bundle. The site is static files, so it
  // opens from a URL with nothing installed — and nothing is faked to get there.
  const store = useDeviceStore();
  const { readings, summaries, events, publish, forget, recording, startRecording, cancelRecording } =
    useReadings();
  const devices = useDevices(store.records, readings, summaries);
  const now = useNow();
  const mapRef = useRef<MapRef | null>(null);

  const [filter, setFilter] = useState<DeviceFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [sensorDeviceId, setSensorDeviceId] = useState("");
  const [micOn, setMicOn] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<LatLng | null>(null);

  // The laptop's own sound needs a device to report as; keep the choice valid
  // as the roster changes, and pick the first one until the user chooses.
  useEffect(() => {
    if (store.records.some((record) => record.id === sensorDeviceId)) return;
    setSensorDeviceId(store.records[0]?.id ?? "");
  }, [store.records, sensorDeviceId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /** Where a new device lands before the user places it: the middle of the view. */
  const viewCenter = useCallback((): LatLng => {
    const center = mapRef.current?.getCenter();
    return center ? { lat: center.lat, lng: center.lng } : PARK_CENTER;
  }, []);

  // A board that introduces itself with an id nobody has heard of becomes a
  // device on the spot. That is the whole "plug it in and it appears" flow:
  // the user then drags it to where the trap actually stands.
  const resolveDevice = useCallback(
    (boardId: string): string => {
      if (store.records.some((record) => record.id === boardId)) return boardId;
      const at = viewCenter();
      const record = store.add({
        id: boardId,
        name: `Датчик ${boardId}`,
        lat: at.lat,
        lng: at.lng,
        origin: "board",
      });
      setNotice({
        title: `Новая плата: ${record.id}`,
        text: "Она появилась в центре карты. Как только её GPS поймает спутники, она сама встанет на место; без GPS откройте её и нажмите «Переставить».",
      });
      return record.id;
    },
    [store, viewCenter],
  );

  const hasDevice = useCallback(
    (id: string) => store.records.some((record) => record.id === id),
    [store.records],
  );

  // GPS moves a device only when it is set to follow, and only by a real
  // distance: consumer GPS wanders a few metres on its own, and a marker that
  // twitches every two seconds is noise, not information.
  const storeRef = useRef(store);
  storeRef.current = store;
  const onFix = useCallback((deviceId: string, point: LatLng) => {
    const record = storeRef.current.records.find((r) => r.id === deviceId);
    if (!record || !record.followGps) return;
    if (distanceMeters(record, point) < GPS_MOVE_METERS) return;
    storeRef.current.update(deviceId, point);
  }, []);

  const boards = useBoards({
    publish,
    resolveDevice,
    hasDevice,
    fallbackDeviceId: sensorDeviceId || null,
    onFix,
  });

  const counts = useMemo(
    () => ({
      all: devices.length,
      alert: devices.filter((device) => device.status === "alert").length,
      online: devices.filter((device) => device.status === "online").length,
      offline: devices.filter((device) => device.status === "offline").length,
    }),
    [devices],
  );

  const listeningBoards = boards.boards.filter((board) => board.state === "listening").length;
  const connection: ConnectionState = listeningBoards > 0 || micOn ? "live" : "idle";
  const connectionDetail =
    listeningBoards > 0
      ? `${listeningBoards} ${plural(listeningBoards, "плата", "платы", "плат")}${micOn ? " + микрофон" : ""}`
      : micOn
        ? "микрофон"
        : undefined;

  const visible = useMemo(
    () => (filter === "all" ? devices : devices.filter((device) => device.status === filter)),
    [devices, filter],
  );

  // Read through the live list so the panel follows realtime updates.
  const selected = useMemo(
    () => devices.find((device) => device.id === selectedId) ?? null,
    [devices, selectedId],
  );

  const selectedBoard = useMemo(
    () => (selected ? (boards.boards.find((board) => board.deviceId === selected.id) ?? null) : null),
    [boards.boards, selected],
  );

  const selectedEvents = useMemo(
    () => (selected ? events.filter((event) => event.deviceId === selected.id).reverse() : []),
    [events, selected],
  );

  const sensorTarget = useMemo(
    () => devices.find((device) => device.id === sensorDeviceId) ?? null,
    [devices, sensorDeviceId],
  );

  const flyTo = useCallback((point: LatLng, zoom?: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: [point.lng, point.lat],
      zoom: zoom ?? Math.max(13.5, map.getZoom()),
      duration: 1400,
      essential: true,
    });
  }, []);

  const select = useCallback(
    (device: Device) => {
      setSelectedId(device.id);
      setListOpen(false);
      flyTo(device);
    },
    [flyTo],
  );

  const selectById = useCallback(
    (id: string) => {
      const device = devices.find((d) => d.id === id);
      if (device) select(device);
    },
    [devices, select],
  );

  // ── Add / edit / move / delete ──────────────────────────────────────

  const openAdd = useCallback(() => {
    const at = viewCenter();
    setForm({ mode: "add", initial: { id: store.suggestId(), name: "", lat: at.lat, lng: at.lng } });
    setDraft(null);
    setPicking(false);
    setListOpen(false);
    setSelectedId(null);
  }, [store, viewCenter]);

  const openEdit = useCallback((device: Device) => {
    setForm({
      mode: "edit",
      initial: { id: device.id, name: device.name, lat: device.lat, lng: device.lng },
    });
    setDraft(null);
    setPicking(false);
    setSelectedId(null);
  }, []);

  const openMove = useCallback(
    (device: Device) => {
      openEdit(device);
      setDraft({ lat: device.lat, lng: device.lng });
      setPicking(true);
    },
    [openEdit],
  );

  const closeForm = useCallback(() => {
    setForm(null);
    setPicking(false);
    setDraft(null);
  }, []);

  const submitForm = useCallback(
    (values: DeviceFormValues) => {
      if (!form) return;
      if (form.mode === "add") {
        try {
          const record = store.add(values);
          setNotice({ title: `${record.name} добавлено`, text: `ID ${record.id}. Подключите плату — она найдёт устройство по этому ID.` });
          setSelectedId(record.id);
          flyTo(record, 13.5);
        } catch (error) {
          setNotice({ title: "Не добавлено", text: error instanceof Error ? error.message : String(error) });
          return;
        }
      } else {
        store.update(form.initial.id, { name: values.name, lat: values.lat, lng: values.lng });
        setSelectedId(form.initial.id);
        flyTo(values);
      }
      closeForm();
    },
    [form, store, flyTo, closeForm],
  );

  const deleteDevice = useCallback(
    (device: Device) => {
      store.remove(device.id);
      forget(device.id);
      setSelectedId(null);
      setNotice({ title: `${device.name} удалено`, text: "Точка и её история убраны с этого ноутбука." });
    },
    [store, forget],
  );

  const writeId = useCallback((board: Board) => boards.writeId(board.key), [boards]);

  const setFollowGps = useCallback(
    (device: Device, follow: boolean) => {
      store.update(device.id, { followGps: follow });
      // Switching it on should show its effect right away, not in two seconds.
      const gps = boards.boards.find((board) => board.deviceId === device.id)?.gps;
      if (follow && gps?.fix && gps.lat !== null && gps.lng !== null) {
        store.update(device.id, { lat: gps.lat, lng: gps.lng });
        flyTo({ lat: gps.lat, lng: gps.lng });
      }
    },
    [store, boards.boards, flyTo],
  );

  const moveToGps = useCallback(
    (device: Device) => {
      const gps = boards.boards.find((board) => board.deviceId === device.id)?.gps;
      if (!gps?.fix || gps.lat === null || gps.lng === null) return;
      store.update(device.id, { lat: gps.lat, lng: gps.lng });
      flyTo({ lat: gps.lat, lng: gps.lng });
    },
    [store, boards.boards, flyTo],
  );

  const pick = useMemo(
    () => (picking ? { draft, onPick: (point: LatLng) => setDraft(point) } : null),
    [picking, draft],
  );

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      <Header connection={connection} detail={connectionDetail} />

      <div className="relative flex min-h-0 flex-1">
        {/* Sidebar — a drawer under md, a column from md up */}
        <aside
          className={`absolute inset-y-0 left-0 z-30 flex w-[85%] max-w-[344px] flex-col bg-canvas transition-transform duration-300 ease-apple
            md:relative md:w-[344px] md:translate-x-0
            ${listOpen ? "translate-x-0 shadow-lifted" : "-translate-x-full md:shadow-none"}`}
        >
          <div className="space-y-3 px-5 pb-4 pt-5">
            <StatsBar
              total={devices.length}
              online={counts.online + counts.alert}
              alerts={counts.alert}
              onAdd={openAdd}
            />
            <SegmentedControl value={filter} onChange={setFilter} counts={counts} />
          </div>
          <div className="scrollbar-none flex-1 overflow-y-auto px-5 pb-8">
            <DeviceList
              devices={visible}
              boards={boards.boards}
              total={devices.length}
              filter={filter}
              selectedId={selectedId}
              onSelect={select}
              onAdd={openAdd}
              onRestoreDefaults={store.restoreDefaults}
              now={now}
              loading={!store.hydrated}
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
          <DeviceMap
            devices={visible}
            selectedId={selectedId}
            onSelect={select}
            mapRef={mapRef}
            pick={pick}
          />

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

          {/* The sensor panel gets out of the way while a point is being picked. */}
          {!picking && (
            <SensorPanel
              devices={devices}
              boards={boards}
              sensorDeviceId={sensorDeviceId}
              onSensorDeviceChange={setSensorDeviceId}
              target={sensorTarget}
              publish={publish}
              recording={recording}
              onStartRecording={startRecording}
              onCancelRecording={cancelRecording}
              onSelectDevice={selectById}
              onMicChange={setMicOn}
            />
          )}

          {notice && !picking && <MapNotice title={notice.title}>{notice.text}</MapNotice>}
        </main>

        <DevicePanel
          device={form ? null : selected}
          board={selectedBoard}
          events={selectedEvents}
          now={now}
          onClose={() => setSelectedId(null)}
          onEdit={openEdit}
          onMove={openMove}
          onDelete={deleteDevice}
          onWriteId={writeId}
          onFollowGps={setFollowGps}
          onMoveToGps={moveToGps}
        />

        {form && (
          <DeviceForm
            key={`${form.mode}-${form.initial.id}`}
            mode={form.mode}
            initial={form.initial}
            takenIds={store.records.map((record) => record.id)}
            picking={picking}
            draft={draft}
            onStartPick={(current) => {
              setDraft(current);
              setPicking(true);
              setListOpen(false);
              if (current) flyTo(current, Math.max(12, mapRef.current?.getZoom() ?? 12));
            }}
            onStopPick={() => setPicking(false)}
            onSubmit={submitForm}
            onCancel={closeForm}
          />
        )}
      </div>
    </div>
  );
}
