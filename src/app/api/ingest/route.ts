import { NextResponse } from "next/server";

import { classify, explain, isAlertClass } from "@/lib/audio/classify";
import { parseFeatures } from "@/lib/audio/features";
import { ALERT_HOLD_MS, publish, type ReadingSource } from "@/lib/live/store";
import { SOUND_CLASS_LABELS, topSoundClass } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCES: ReadingSource[] = ["esp32", "mic", "sample"];

/**
 * The single entry point for every sensor. The ESP32 (over Web Serial or
 * Wi-Fi), the laptop microphone and the sample player all POST the same
 * feature vector here, and the decision is made server-side — the site
 * classifies, the sensor only listens.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Тело запроса — не JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Ожидался объект" }, { status: 400 });
  }
  const payload = body as Record<string, unknown>;

  const deviceId = typeof payload.id === "string" && payload.id.trim() ? payload.id.trim() : null;
  if (!deviceId) {
    return NextResponse.json({ error: "Не указан id устройства" }, { status: 400 });
  }

  const features = parseFeatures(payload);
  if (!features) {
    return NextResponse.json(
      { error: "Не разобрать признаки: нужен массив bands из 16 чисел" },
      { status: 400 },
    );
  }

  const classification = classify(features);
  const top = topSoundClass(classification);
  if (!top) {
    return NextResponse.json({ error: "Классификация не удалась" }, { status: 500 });
  }

  const source: ReadingSource = SOURCES.includes(payload.source as ReadingSource)
    ? (payload.source as ReadingSource)
    : "esp32";

  // An alert needs a confident verdict, not just a winning one — otherwise
  // room tone that leans 22% chainsaw would light up the map.
  const alerting = isAlertClass(top.name) && top.value >= 40;
  const at = Date.now();

  publish({
    deviceId,
    at,
    classification,
    top: top.name,
    topValue: top.value,
    status: alerting ? "alert" : "normal",
    soundType: alerting ? SOUND_CLASS_LABELS[top.name] : null,
    reasons: explain(features, top.name),
    rms: features.rms,
    bands: features.bands,
    source,
    alertUntil: alerting ? at + ALERT_HOLD_MS : 0,
  });

  return NextResponse.json({
    ok: true,
    top: top.name,
    label: SOUND_CLASS_LABELS[top.name],
    value: top.value,
    classification,
    alert: alerting,
  });
}
