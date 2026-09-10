import { readdir } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { SOUND_CLASS_LABELS, type SoundClass } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".ogg", ".m4a", ".flac", ".aac", ".webm"]);

/**
 * Keyword → class. Checked against the filename, so dropping
 * `gunshot-01.wav` or `лай собаки.mp3` into public/audio is all it takes to
 * add a sample — no code change, which is the point.
 */
const HINTS: Array<[RegExp, SoundClass]> = [
  [/gun|shot|shoot|rifle|выстрел|ружь|стрель/i, "gunshot"],
  [/dog|bark|лай|собак|пёс|пес/i, "dog"],
  [/chain|saw|пила|бензо|пил/i, "chainsaw"],
  [/car|truck|engine|vehicle|мотор|машин|транспорт|двигат/i, "vehicle"],
  [/bird|animal|wolf|птиц|животн|волк|зверь/i, "animal"],
  [/ambient|forest|quiet|фон|лес|тишин/i, "other"],
];

export interface SampleFile {
  /** URL under /audio, ready for <audio src>. */
  url: string;
  name: string;
  /** The class the filename suggests, or null when nothing matched. */
  expected: SoundClass | null;
  expectedLabel: string | null;
}

export async function GET() {
  const dir = path.join(process.cwd(), "public", "audio");

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // The folder is created by the repo, but a fresh clone may not have it.
    return NextResponse.json({ samples: [] });
  }

  const samples: SampleFile[] = entries
    .filter((file) => AUDIO_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "ru"))
    .map((file) => {
      const expected = HINTS.find(([pattern]) => pattern.test(file))?.[1] ?? null;
      return {
        url: `/audio/${encodeURIComponent(file)}`,
        name: path.basename(file, path.extname(file)),
        expected,
        expectedLabel: expected ? SOUND_CLASS_LABELS[expected] : null,
      };
    });

  return NextResponse.json({ samples });
}
