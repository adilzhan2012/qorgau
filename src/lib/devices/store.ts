import type { DeviceRecord } from "@/lib/types";

/**
 * The roster lives in the browser's localStorage.
 *
 * The site is published as static files and has no backend, so this is the
 * only place a device the user adds can actually persist. It survives reloads
 * and stays on the laptop that runs the demo — which is also where the boards
 * are plugged in, so it is the right laptop.
 */

const STORAGE_KEY = "qorgau.devices.v1";

/** Ile-Alatau National Park, south of Almaty — where the first traps would go. */
export const PARK_CENTER = { lat: 43.11, lng: 76.98 };

/**
 * Six real places in the park, seeded the first time the site opens so the
 * map is not empty. They are ordinary records: rename, move or delete them.
 * None of them reports anything until a sensor is pointed at it.
 */
export const DEFAULT_DEVICES: DeviceRecord[] = [
  { id: "QRG-001", name: "Большое Алматинское ущелье", lat: 43.0561, lng: 76.9848 },
  { id: "QRG-002", name: "Медеу, гребень", lat: 43.1571, lng: 77.0574 },
  { id: "QRG-003", name: "Долина Кимасар", lat: 43.1348, lng: 77.0812 },
  { id: "QRG-004", name: "Бутаковский водопад", lat: 43.1689, lng: 77.1204 },
  { id: "QRG-005", name: "Плато Кок-Жайляу", lat: 43.1402, lng: 77.0208 },
  { id: "QRG-006", name: "Проходное ущелье", lat: 43.0912, lng: 76.8931 },
].map((record) => ({ ...record, createdAt: 0, origin: "manual" as const }));

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/;

export function normaliseId(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function isValidLat(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLng(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

/** QRG-007 after QRG-006; skips anything already taken. */
export function nextDeviceId(existing: DeviceRecord[]): string {
  const taken = new Set(existing.map((device) => device.id.toUpperCase()));
  let n = 1;
  for (const device of existing) {
    const match = /^QRG-(\d+)$/i.exec(device.id);
    if (match) n = Math.max(n, Number(match[1]) + 1);
  }
  let candidate = `QRG-${String(n).padStart(3, "0")}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `QRG-${String(n).padStart(3, "0")}`;
  }
  return candidate;
}

function toRecord(raw: unknown): DeviceRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? normaliseId(o.id) : "";
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  if (!isValidId(id) || !isValidLat(lat) || !isValidLng(lng)) return null;

  return {
    id,
    name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : id,
    lat,
    lng,
    createdAt: Number.isFinite(Number(o.createdAt)) ? Number(o.createdAt) : 0,
    origin: o.origin === "board" ? "board" : "manual",
  };
}

/**
 * Reads the roster. Returns null when nothing has been stored yet — the caller
 * decides whether that means "seed the defaults" or "the user deleted them all".
 */
export function loadDevices(): DeviceRecord[] | null {
  if (typeof window === "undefined") return null;
  let text: string | null;
  try {
    text = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (text === null) return null;

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return null;
    const seen = new Set<string>();
    const records: DeviceRecord[] = [];
    for (const item of parsed) {
      const record = toRecord(item);
      if (record && !seen.has(record.id)) {
        seen.add(record.id);
        records.push(record);
      }
    }
    return records;
  } catch {
    return null;
  }
}

export function saveDevices(devices: DeviceRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(devices));
  } catch {
    // Private mode or a full quota: the roster still works for this session.
  }
}

/** The key other tabs see change, so they can reload the roster. */
export const DEVICES_STORAGE_KEY = STORAGE_KEY;
