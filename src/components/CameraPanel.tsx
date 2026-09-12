"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  detectPeople,
  loadPersonDetector,
  type PersonBox,
} from "@/lib/vision/person";

/**
 * Камера ноутбука: есть в кадре человек или нет.
 *
 * Зачем она здесь, когда звук уже умеет слышать голос. Звук говорит «похоже на
 * человека» и иногда ошибается — кудахтанье и плеск воды попадают в те же
 * признаки. Камера отвечает на тот же вопрос совсем другим способом. Когда
 * оба согласны, это уже не догадка: ложная тревога по звуку и ложная тревога
 * по картинке одновременно — событие настолько редкое, что им можно
 * пренебречь.
 *
 * Кадры не сохраняются и никуда не отправляются. Видео живёт в памяти
 * браузера, модель смотрит на него и забывает: снимок узнаваемого человека —
 * это персональные данные, и для «посмотреть, работает ли» он не нужен.
 */

/** Сколько раз подряд модель должна увидеть человека, прежде чем верить. */
const CONFIRM_FRAMES = 3;

/** Пауза между кадрами: четыре раза в секунду хватает, а ноутбук не греется. */
const FRAME_MS = 250;

export interface CameraPanelProps {
  /** Зовётся, когда камера подтвердила человека: для журнала тревог. */
  onPerson?: (score: number) => void;
}

type State = "off" | "loading" | "watching" | "error";

export function CameraPanel({ onPerson }: CameraPanelProps) {
  const [state, setState] = useState<State>("off");
  const [error, setError] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<PersonBox[]>([]);
  const [seen, setSeen] = useState(false);

  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const streak = useRef(0);
  const reported = useRef(false);

  const stop = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    streak.current = 0;
    reported.current = false;
    setBoxes([]);
    setSeen(false);
    setState("off");
  }, []);

  // Камера не должна остаться включённой, когда со страницы ушли.
  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    setError(null);
    setState("loading");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
      });
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }

      const model = await loadPersonDetector();
      setState("watching");

      timer.current = window.setInterval(() => {
        const element = video.current;
        if (!element || element.readyState < 2) return;
        void detectPeople(model, element)
          .then((found) => {
            setBoxes(found);
            streak.current = found.length > 0 ? streak.current + 1 : 0;

            const confirmed = streak.current >= CONFIRM_FRAMES;
            setSeen(confirmed);
            // О человеке сообщаем один раз за появление, а не четыре раза в
            // секунду: журнал тревог должен читаться человеком.
            if (confirmed && !reported.current) {
              reported.current = true;
              onPerson?.(found[0].score);
            }
            if (!confirmed && streak.current === 0) reported.current = false;
          })
          .catch(() => {
            /* Один неудачный кадр — не повод останавливать камеру. */
          });
      }, FRAME_MS);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(
        /Permission|NotAllowed/i.test(message)
          ? "Браузер не дал доступ к камере. Разрешите его в адресной строке и нажмите ещё раз."
          : /не загрузил/i.test(message)
            ? "Модель не скачалась — камере нужен интернет при первом включении."
            : message,
      );
      setState("error");
      for (const track of stream.current?.getTracks() ?? []) track.stop();
      stream.current = null;
    }
  }, [onPerson]);

  const watching = state === "watching";

  return (
    <div className="mt-4 border-t border-white/[0.06] pt-3">
      <div className="mb-1.5 flex items-baseline justify-between">
        <p className="stat-label">Камера</p>
        {watching && (
          <span className={`text-[11px] ${seen ? "text-alarm" : "text-faint"}`}>
            {seen ? "человек в кадре" : "никого"}
          </span>
        )}
      </div>

      {/* Видео показываем всегда, чтобы не прыгала вёрстка при включении. */}
      <div
        className={`relative overflow-hidden rounded-xl bg-raised transition-shadow ${
          seen ? "shadow-[0_0_0_2px_var(--alarm)]" : ""
        }`}
      >
        <video
          ref={video}
          muted
          playsInline
          className={`block w-full ${watching ? "" : "hidden"}`}
        />

        {watching &&
          boxes.map((box, index) => (
            <span
              key={index}
              style={{
                left: `${(box.x / (video.current?.videoWidth || 640)) * 100}%`,
                top: `${(box.y / (video.current?.videoHeight || 480)) * 100}%`,
                width: `${(box.width / (video.current?.videoWidth || 640)) * 100}%`,
                height: `${(box.height / (video.current?.videoHeight || 480)) * 100}%`,
              }}
              className="pointer-events-none absolute rounded-md border-2 border-alarm"
            >
              <span className="absolute -top-[18px] left-0 rounded bg-alarm px-1.5 text-[10px] font-semibold text-canvas">
                человек {Math.round(box.score * 100)}%
              </span>
            </span>
          ))}

        {!watching && (
          <p className="px-3 py-6 text-center text-[12px] leading-relaxed text-faint">
            {state === "loading"
              ? "Включаю камеру и качаю модель…"
              : "Камера смотрит, есть ли человек в кадре. Кадры не сохраняются и никуда не отправляются."}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => (watching ? stop() : void start())}
        disabled={state === "loading"}
        className={`mt-2 w-full rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-300 ease-apple active:scale-[0.98] disabled:opacity-40 ${
          watching ? "bg-alarm-soft text-alarm" : "bg-raised text-ink hover:bg-raised/70"
        }`}
      >
        {watching ? "Выключить камеру" : state === "loading" ? "Загружаю…" : "Включить камеру"}
      </button>

      {error !== null && (
        <p className="mt-1.5 text-[12px] leading-relaxed text-alarm">{error}</p>
      )}
    </div>
  );
}
