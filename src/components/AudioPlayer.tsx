"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDuration } from "@/lib/time";

interface AudioPlayerProps {
  src: string;
  /** Used to seed the waveform so it stays stable across renders. */
  seed?: string;
}

const BAR_COUNT = 48;

/** Deterministic pseudo-waveform — a real one would need to decode the file. */
function buildWaveform(seed: string): number[] {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const bars: number[] = [];
  let state = hash >>> 0;
  for (let i = 0; i < BAR_COUNT; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const noise = state / 0xffffffff;
    // Gentle envelope so the clip reads as a recording, not a random picket fence.
    const envelope = Math.sin((i / (BAR_COUNT - 1)) * Math.PI) * 0.6 + 0.4;
    bars.push(0.22 + noise * 0.78 * envelope);
  }
  return bars;
}

export function AudioPlayer({ src, seed }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);

  const waveform = useMemo(() => buildWaveform(seed ?? src), [seed, src]);
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  // A new clip resets the transport.
  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setFailed(false);
  }, [src]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      void audio.play().catch(() => setFailed(true));
    } else {
      audio.pause();
    }
  }, []);

  const seekTo = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      const audio = audioRef.current;
      if (!track || !audio || !duration) return;

      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      audio.currentTime = ratio * duration;
      setCurrentTime(audio.currentTime);
    },
    [duration],
  );

  return (
    <div className="rounded-2xl bg-white/[0.04] p-4">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          setDuration(Number.isFinite(value) ? value : 0);
        }}
        onError={() => setFailed(true)}
      />

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={toggle}
          disabled={failed}
          aria-label={playing ? "Пауза" : "Проиграть запись"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-canvas shadow-sm transition-all duration-300 ease-apple hover:scale-[1.04] active:scale-95 disabled:opacity-30 disabled:hover:scale-100"
        >
          {playing ? (
            <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor" aria-hidden="true">
              <rect x="0" y="0" width="4.5" height="16" rx="1.6" />
              <rect x="9.5" y="0" width="4.5" height="16" rx="1.6" />
            </svg>
          ) : (
            <svg width="15" height="17" viewBox="0 0 15 17" fill="currentColor" aria-hidden="true">
              <path d="M14.1 7.2a1.5 1.5 0 0 1 0 2.6L2.3 16.6A1.5 1.5 0 0 1 0 15.3V1.7A1.5 1.5 0 0 1 2.3.4l11.8 6.8Z" />
            </svg>
          )}
        </button>

        <div className="min-w-0 flex-1">
          {/* Waveform doubles as the scrubber */}
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="Перемотка записи"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(currentTime)}
            aria-valuetext={formatDuration(currentTime)}
            onClick={(event) => seekTo(event.clientX)}
            onKeyDown={(event) => {
              const audio = audioRef.current;
              if (!audio || !duration) return;
              if (event.key === "ArrowRight") {
                audio.currentTime = Math.min(duration, audio.currentTime + 2);
                setCurrentTime(audio.currentTime);
              } else if (event.key === "ArrowLeft") {
                audio.currentTime = Math.max(0, audio.currentTime - 2);
                setCurrentTime(audio.currentTime);
              } else if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                toggle();
              }
            }}
            className="flex h-9 cursor-pointer items-center gap-[2.5px] rounded-md"
          >
            {waveform.map((height, index) => {
              const played = index / BAR_COUNT < progress;
              return (
                <span
                  key={index}
                  style={{ height: `${Math.round(height * 100)}%` }}
                  className={`flex-1 rounded-full transition-colors duration-200 ease-apple ${
                    played ? "bg-accent" : "bg-white/20"
                  }`}
                />
              );
            })}
          </div>

          <div className="mt-1.5 flex justify-between text-[12px] tabular-nums text-faint">
            <span>{formatDuration(currentTime)}</span>
            <span>{failed ? "Недоступно" : formatDuration(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
