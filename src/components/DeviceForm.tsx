"use client";

import { useEffect, useMemo, useState } from "react";

import type { LatLng } from "@/components/DeviceMap";
import { isValidId, isValidLat, isValidLng, normaliseId } from "@/lib/devices/store";

export interface DeviceFormValues {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface DeviceFormProps {
  mode: "add" | "edit";
  initial: DeviceFormValues;
  /** Ids already in the roster; the one being edited is fine to keep. */
  takenIds: string[];
  /** True while the map is in pick mode: the form folds down out of the way. */
  picking: boolean;
  /** The last point clicked on the map in pick mode. */
  draft: LatLng | null;
  /** Called with the form's current point, so the map can show it as the draft. */
  onStartPick: (current: LatLng | null) => void;
  onStopPick: () => void;
  onSubmit: (values: DeviceFormValues) => void;
  onCancel: () => void;
}

const inputClass =
  "w-full rounded-xl bg-raised px-3 py-2.5 text-[14px] text-ink outline-none transition-shadow duration-300 ease-apple placeholder:text-faint focus:ring-2 focus:ring-accent/60";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="stat-label mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

/**
 * Add or edit a device: a name, an id the board can be told, and a point on
 * the map. The point can be typed, taken from the laptop's own location, or
 * clicked on the map — while clicking, the form folds into a bar along the
 * bottom so the map is fully visible.
 */
export function DeviceForm({
  mode,
  initial,
  takenIds,
  picking,
  draft,
  onStartPick,
  onStopPick,
  onSubmit,
  onCancel,
}: DeviceFormProps) {
  const [id, setId] = useState(initial.id);
  const [name, setName] = useState(initial.name);
  const [lat, setLat] = useState(initial.lat.toFixed(5));
  const [lng, setLng] = useState(initial.lng.toFixed(5));
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  // A click on the map lands in the coordinate fields.
  useEffect(() => {
    if (!draft) return;
    setLat(draft.lat.toFixed(5));
    setLng(draft.lng.toFixed(5));
  }, [draft]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") (picking ? onStopPick : onCancel)();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [picking, onStopPick, onCancel]);

  const taken = useMemo(() => new Set(takenIds.map((t) => t.toUpperCase())), [takenIds]);

  const cleanId = normaliseId(id);
  const latNum = Number(lat.replace(",", "."));
  const lngNum = Number(lng.replace(",", "."));

  const idError =
    mode === "edit"
      ? null
      : !isValidId(cleanId)
        ? "Латинские буквы, цифры и дефис, до 24 знаков"
        : taken.has(cleanId)
          ? "Такой ID уже есть"
          : null;
  const latError = lat.trim() && isValidLat(latNum) ? null : "От −90 до 90";
  const lngError = lng.trim() && isValidLng(lngNum) ? null : "От −180 до 180";
  const valid = !idError && !latError && !lngError;

  const locate = () => {
    if (!navigator.geolocation) {
      setNotice("Браузер не отдаёт местоположение.");
      return;
    }
    setLocating(true);
    setNotice(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(position.coords.latitude.toFixed(5));
        setLng(position.coords.longitude.toFixed(5));
        setLocating(false);
      },
      (error) => {
        setLocating(false);
        setNotice(
          error.code === error.PERMISSION_DENIED
            ? "Доступ к местоположению запрещён. Укажите точку на карте."
            : "Местоположение не определилось. Укажите точку на карте.",
        );
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!valid) return;
    onSubmit({ id: cleanId, name: name.trim() || cleanId, lat: latNum, lng: lngNum });
  };

  if (picking) {
    return (
      <div className="fixed inset-x-4 bottom-4 z-50 md:inset-x-auto md:left-1/2 md:w-[420px] md:-translate-x-1/2">
        <div className="glass flex animate-fade-up items-center justify-between gap-3 rounded-2xl px-4 py-3 shadow-lifted">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">{name.trim() || cleanId || "Новое устройство"}</p>
          <p className="truncate font-mono text-[12px] tabular-nums text-muted">
            {draft ? `${draft.lat.toFixed(5)}, ${draft.lng.toFixed(5)}` : "нажмите на карту, где стоит устройство"}
          </p>
        </div>
        <button
          type="button"
          onClick={onStopPick}
          className="shrink-0 rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-canvas transition-all duration-300 ease-apple hover:bg-accent-dim active:scale-95"
        >
          Готово
        </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        onClick={onCancel}
        aria-hidden="true"
        className="fixed inset-0 z-40 animate-fade-in bg-black/45"
      />
      {/* The centring transform lives on this wrapper: the fade-up animation
          owns `transform` on the form itself and would override it. */}
      <div className="fixed inset-x-0 bottom-0 z-50 md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-[440px] md:-translate-x-1/2 md:-translate-y-1/2">
        <form
          onSubmit={submit}
          role="dialog"
          aria-modal="true"
          aria-label={mode === "add" ? "Новое устройство" : "Изменить устройство"}
          className="glass scrollbar-none max-h-[calc(100dvh-1rem)] animate-fade-up overflow-y-auto rounded-t-4xl px-6 pb-8 pt-5 shadow-lifted md:rounded-3xl md:p-7"
        >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[22px] font-semibold tracking-tightest">
              {mode === "add" ? "Новое устройство" : "Изменить устройство"}
            </h2>
            <p className="mt-1 text-[13px] text-muted">
              {mode === "add"
                ? "Точка на карте, к которой можно привязать плату."
                : `ID ${initial.id} остаётся — его знает плата.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Закрыть"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-muted transition-all duration-300 ease-apple hover:bg-white/20 hover:text-ink active:scale-90"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <Field label="Название">
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Например, Кордон у моста"
              className={inputClass}
              maxLength={60}
            />
          </Field>

          {mode === "add" && (
            <Field
              label="ID устройства"
              hint="Так плата представляется по USB. Его можно записать в плату с сайта."
            >
              <input
                value={id}
                onChange={(event) => setId(event.target.value)}
                onBlur={() => setTouched(true)}
                spellCheck={false}
                className={`${inputClass} font-mono uppercase ${touched && idError ? "ring-2 ring-alarm/60" : ""}`}
                maxLength={24}
              />
              {touched && idError && <span className="mt-1 block text-[11px] text-alarm">{idError}</span>}
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Широта">
              <input
                value={lat}
                onChange={(event) => setLat(event.target.value)}
                inputMode="decimal"
                className={`${inputClass} font-mono tabular-nums ${touched && latError ? "ring-2 ring-alarm/60" : ""}`}
              />
            </Field>
            <Field label="Долгота">
              <input
                value={lng}
                onChange={(event) => setLng(event.target.value)}
                inputMode="decimal"
                className={`${inputClass} font-mono tabular-nums ${touched && lngError ? "ring-2 ring-alarm/60" : ""}`}
              />
            </Field>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                onStartPick(!latError && !lngError ? { lat: latNum, lng: lngNum } : null)
              }
              className="flex-1 rounded-xl bg-raised px-3 py-2.5 text-[13px] font-medium transition-all duration-300 ease-apple hover:bg-raised/70 active:scale-[0.98]"
            >
              Указать на карте
            </button>
            <button
              type="button"
              onClick={locate}
              disabled={locating}
              className="flex-1 rounded-xl bg-raised px-3 py-2.5 text-[13px] font-medium transition-all duration-300 ease-apple hover:bg-raised/70 active:scale-[0.98] disabled:opacity-50"
            >
              {locating ? "Определяю…" : "Я здесь"}
            </button>
          </div>

          {notice && (
            <p className="rounded-xl bg-warn-soft px-3 py-2 text-[12px] leading-relaxed text-warn">{notice}</p>
          )}
        </div>

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl px-3 py-2.5 text-[14px] font-medium text-muted transition-colors duration-300 ease-apple hover:text-ink"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={touched && !valid}
            className="flex-[2] rounded-xl bg-accent px-3 py-2.5 text-[14px] font-medium text-canvas transition-all duration-300 ease-apple hover:bg-accent-dim active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {mode === "add" ? "Добавить" : "Сохранить"}
          </button>
        </div>
        </form>
      </div>
    </>
  );
}
