import type { Device } from "./types";

/**
 * The fleet, hard-coded.
 *
 * Firestore is still the source of truth when it answers, but it is a network
 * dependency in the middle of a live demo: an unreachable backend leaves the
 * app on a skeleton for ten seconds and then says "offline". These six show
 * instantly and get overwritten the moment a real snapshot lands.
 *
 * Same ids as scripts/seed.mjs, so the two agree on who is who.
 */
export const FALLBACK_DEVICES: Device[] = [
  {
    id: "QRG-001",
    name: "Большое Алматинское ущелье",
    lat: 43.0561,
    lng: 76.9848,
    status: "normal",
    lastSignal: null,
    soundType: null,
    audioUrl: null,
    battery: 78,
    classification: null,
  },
  {
    id: "QRG-002",
    name: "Медеу, гребень",
    lat: 43.1571,
    lng: 77.0574,
    status: "normal",
    lastSignal: null,
    soundType: null,
    audioUrl: null,
    battery: 92,
    classification: null,
  },
  {
    id: "QRG-003",
    name: "Долина Кимасар",
    lat: 43.1348,
    lng: 77.0812,
    status: "normal",
    lastSignal: null,
    soundType: null,
    audioUrl: null,
    battery: 64,
    classification: null,
  },
  {
    id: "QRG-004",
    name: "Бутаковский водопад",
    lat: 43.1689,
    lng: 77.1204,
    status: "normal",
    lastSignal: null,
    soundType: null,
    audioUrl: null,
    battery: 41,
    classification: null,
  },
  {
    id: "QRG-005",
    name: "Плато Кок-Жайляу",
    lat: 43.1402,
    lng: 77.0208,
    status: "normal",
    lastSignal: null,
    soundType: null,
    audioUrl: null,
    battery: 88,
    classification: null,
  },
  {
    id: "QRG-006",
    name: "Проходное ущелье",
    lat: 43.0912,
    lng: 76.8931,
    status: "normal",
    lastSignal: null,
    soundType: null,
    audioUrl: null,
    battery: 17,
    classification: null,
  },
];

/** The device a browser-side sensor reports as by default. */
export const DEFAULT_SENSOR_DEVICE = "QRG-001";
