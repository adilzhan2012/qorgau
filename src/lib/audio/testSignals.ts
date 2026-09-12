import type { SoundClass } from "@/lib/types";

/**
 * Синтетические звуки с заранее известным ответом.
 *
 * Живут отдельно от страницы /selftest, потому что их гоняют двое: сама
 * страница в браузере и офлайн-проверка (`npm run eval --selftest`). Иначе
 * одна из копий рано или поздно разошлась бы с другой, и «проверка» проверяла
 * бы не тот код, что работает.
 *
 * Это быстрая проверка «ничего не сломалось», а не измерение качества:
 * синтез всегда чище леса. Качество меряется на полевых записях — см.
 * scripts/fetch-corpus.mjs.
 */

export interface TestCase {
  expect: SoundClass;
  /** Подпись на странице /selftest. */
  name: string;
  /** Имя файла в public/audio: те же сигналы служат демонстрационными. */
  file: string;
  /** `frames` кадров по 1024 отсчёта; по умолчанию 32 — это две секунды. */
  build: (frames?: number) => Float32Array;
}

export const TEST_RATE = 16000;
export const TEST_FRAME = 1024;

function noise(): number {
  return Math.random() * 2 - 1;
}

/**
 * Фон леса под каждым сигналом, около −60 дБFS — тише порога тишины у
 * классификатора, иначе «тишина» сама по себе читалась бы как шум леса.
 *
 * Ни одна запись не бывает цифрово тихой: у микрофона всегда есть свой шум,
 * а у леса — свой. Без фона короткий звук в пустом кадре выглядит пиком на
 * фоне нуля (пик к среднему за двадцать децибел), какого не бывает ни у одной
 * живой записи — по корпусу даже у выстрела это вдвое меньше.
 */
function floor(): number {
  return noise() * 0.0016;
}

function render(frames: number, synth: (t: number) => number): Float32Array {
  const out = new Float32Array(frames * TEST_FRAME);
  for (let i = 0; i < out.length; i += 1) out[i] = synth(i / TEST_RATE);
  return out;
}

/** Отражения от стволов: задержка в секундах и во сколько раз тише. */
const REFLECTIONS: [number, number][] = [
  [0.022, 0.45],
  [0.041, 0.34],
  [0.068, 0.24],
  [0.098, 0.16],
  [0.135, 0.1],
];

export const TEST_CASES: TestCase[] = [
  {
    expect: "other",
    name: "тишина (фон леса)",
    file: "quiet-demo.wav",
    build: (frames = 32) => render(frames, () => floor()),
  },
  {
    expect: "gunshot",
    name: "выстрел",
    file: "gunshot-demo.wav",
    build: (frames = 32) =>
      render(frames, (t) => {
        const onset = 0.192; // three quiet frames first, so attack has a floor
        if (t < onset) return floor();
        const dt = t - onset;
        // A rifle report heard at distance is mostly broadband crack; the
        // muzzle thump is there but must not dominate the spectrum.
        const crack = noise() * Math.exp(-dt / 0.045);
        const thump = Math.sin(2 * Math.PI * 90 * dt) * Math.exp(-dt / 0.05) * 0.18;
        return (crack + thump) * 0.9 + floor();
      }),
  },
  {
    expect: "dog",
    name: "лай собаки",
    file: "dog-demo.wav",
    build: (frames = 32) => {
      // Один выкрик: короткий подъём, гармонический стек с формантами на
      // 0.6–1.2 кГц (там же, где они у настоящего лая по корпусу записей) и
      // спад за девяносто миллисекунд.
      const bark = (dt: number) => {
        if (dt < 0 || dt > 0.18) return 0;
        // Подъём за тридцать миллисекунд, спад за сто десять: собака не
        // щёлкает, она успевает открыть пасть. С мгновенным фронтом пик к
        // среднему выходил вчетверо больше, чем у живых записей лая.
        const env = (1 - Math.exp(-dt / 0.03)) * Math.exp(-dt / 0.11);
        let v = 0;
        for (let h = 1; h <= 5; h += 1) {
          const gain = h >= 2 && h <= 4 ? 1 : 0.25;
          v += Math.sin(2 * Math.PI * 310 * h * dt) * gain;
        }
        return (v / 4 + noise() * 0.05) * env * 0.7;
      };

      return render(frames, (t) => {
        const onset = 0.192;
        if (t < onset) return floor();
        // Собака лает примерно раз в полсекунды, а не без умолку: по корпусу
        // записей звук занимает около трети времени, остальное — паузы.
        const dt = (t - onset) % 0.55;
        // Лес отражает звук: до микрофона доходит выкрик и несколько
        // отражений от стволов. Без них синтез получается безэховым — пик к
        // среднему вдесятеро больше, чем у любой живой записи лая, и
        // классификатор справедливо считает такое щелчком, а не голосом.
        let v = bark(dt) + floor();
        for (const [delay, gain] of REFLECTIONS) v += gain * bark(dt - delay);
        return v;
      });
    },
  },
  {
    expect: "voice",
    name: "человек (речь)",
    file: "voice-demo.wav",
    build: (frames = 32) =>
      render(frames, (t) => {
        // Гласная: основной тон 130 Гц с формантами на 600, 1100 и 2500 Гц —
        // так устроен голосовой тракт. Каждые четверть секунды форманты
        // сдвигаются, а между слогами проходит короткая пауза: именно это
        // движение спектра и отличает речь от всего остального.
        const syllable = Math.floor(t / 0.28);
        const dt = t - syllable * 0.28;
        if (dt > 0.2) return floor();

        // Слоги чередуются, как «па-ма-ла»: форманты гуляют от слога к слогу.
        const shift = 1 + 0.25 * Math.sin(syllable * 1.7);
        const f0 = 130 * (1 + 0.04 * Math.sin(2 * Math.PI * 4 * t));
        const env = Math.min(1, dt / 0.03) * Math.min(1, (0.2 - dt) / 0.04);

        let v = 0;
        for (let h = 1; h <= 24; h += 1) {
          const hz = f0 * h;
          // Три форманты: чем ближе гармоника к формантной частоте, тем громче.
          const gain =
            Math.exp(-Math.pow((hz - 600 * shift) / 180, 2)) +
            0.7 * Math.exp(-Math.pow((hz - 1100 * shift) / 250, 2)) +
            0.4 * Math.exp(-Math.pow((hz - 2500 * shift) / 500, 2));
          v += Math.sin(2 * Math.PI * hz * t) * gain;
        }
        return (v / 3 + noise() * 0.04) * env * 0.5 + floor();
      }),
  },
  {
    expect: "chainsaw",
    name: "бензопила",
    file: "chainsaw-demo.wav",
    build: (frames = 32) =>
      render(frames, (t) => {
        let v = 0;
        for (let h = 1; h <= 8; h += 1) v += Math.sin(2 * Math.PI * 170 * h * t) / h;
        const am = 0.5 + 0.5 * Math.sin(2 * Math.PI * 120 * t);
        return (v * 0.45 + noise() * 0.12) * am * 0.6;
      }),
  },
  {
    expect: "vehicle",
    name: "машина (гул двигателя)",
    file: "vehicle-demo.wav",
    build: (frames = 32) =>
      render(frames, (t) => {
        let v = 0;
        for (let h = 1; h <= 5; h += 1) v += Math.sin(2 * Math.PI * 70 * h * t) / (h * h);
        return (v * 0.8 + noise() * 0.02) * 0.5;
      }),
  },
  {
    expect: "nature",
    name: "листва на ветру",
    file: "nature-leaves.wav",
    build: (frames = 32) =>
      render(frames, (t) => {
        const gust = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.4 * t + 1);
        return noise() * 0.12 * gust + floor();
      }),
  },
  {
    expect: "nature",
    name: "водопад (громкий ровный шум)",
    file: "nature-waterfall.wav",
    build: (frames = 32) => render(frames, () => noise() * 0.5),
  },
  {
    expect: "animal",
    name: "птица (тональный свист)",
    file: "bird-demo.wav",
    build: (frames = 32) =>
      render(frames, (t) => {
        // Vibrato has to be integrated into the phase — multiplying a varying
        // frequency by t sweeps far wider than intended and reads as noise.
        const phase = 2 * Math.PI * 2600 * t - 180 * Math.cos(2 * Math.PI * 5 * t);
        return (Math.sin(phase) + noise() * 0.03) * 0.35 + floor();
      }),
  },
];
