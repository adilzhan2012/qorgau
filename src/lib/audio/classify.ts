import { clamp01 } from "./features";
import { SILENCE_DB, type WindowFeatures } from "./window";
import { SOUND_CLASSES, SOUND_SAFETY, type Classification, type SoundClass } from "@/lib/types";

/**
 * Классификатор. Все источники звука проекта — плата, микрофон ноутбука,
 * проигрывание файла — сходятся в этой функции, поэтому настраивать нужно
 * ровно одно место.
 *
 * Это не нейросеть. Каждый класс — несколько акустических признаков с весами,
 * а проценты получаются софтмаксом. Поэтому любой вердикт можно объяснить
 * словами: `explain()` ниже показывает, что именно решило дело.
 *
 * Признаки — не мгновенные, а за полторы секунды (см. window.ts). Это главное
 * изменение против первой версии: по одному кадру в 64 мс настоящие лесные
 * записи распознавались хуже, чем подбрасыванием монеты, потому что за такое
 * время лай, капля и хлопок неразличимы. Разделяет их поведение во времени —
 * ровность, ритм, доля громкого времени, число резких начал.
 *
 * Термы бывают двух видов:
 *   обычный — складывается в взвешенное среднее;
 *   gate    — умножает результат, то есть это условие обязательное.
 * «Бензопила» без непрерывного звука невозможна, сколько бы ни совпало
 * остального, — это и есть gate.
 */

/** Классы, которые поднимают тревогу. */
export function isAlertClass(name: SoundClass): boolean {
  return SOUND_SAFETY[name] === "danger";
}

/** Софтмакс: меньше — решительнее, больше — осторожнее. */
const TEMPERATURE = 0.15;

/** Сумма полос `bands[from..to)`. Полосы нормированы, так что это доля. */
function energy(bands: number[], from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to && i < bands.length; i += 1) sum += bands[i];
  return clamp01(sum);
}

/** 1 в точке `mu`, спадает за `sigma`. Для признаков «должно быть примерно». */
function gauss(x: number, mu: number, sigma: number): number {
  const d = (x - mu) / sigma;
  return Math.exp(-0.5 * d * d);
}

/** Линейная шкала: 0 при `lo`, 1 при `hi`. Читается лучше, чем деление в тексте. */
function ramp(x: number, lo: number, hi: number): number {
  return clamp01((x - lo) / (hi - lo));
}

interface Term {
  /** Подпись по-русски — её показывает интерфейс в объяснении. */
  label: string;
  weight: number;
  value: number;
  /** Обязательное условие: умножает итог, а не усредняется с остальными. */
  gate?: boolean;
}

type Terms = Record<SoundClass, Term[]>;

/**
 * Признаки каждого класса. Пороги в термах — не на глаз: это квартили,
 * измеренные на корпусе полевых записей (npm run corpus, потом
 * npm run eval -- --dump). Меняете порог — перегоняйте проверку.
 *
 * Диапазоны полос (16 логарифмических от 60 Гц до 8 кГц):
 *   0–5   60–280 Гц     гул двигателя
 *   3–11  150–1700 Гц   корпус бензопилы
 *   6–13  380–3200 Гц   форманты лая
 *   10–16 1.3–8 кГц     птицы, стрёкот, шипение
 */
function score(w: WindowFeatures): Terms {
  const deepLow = energy(w.bands, 0, 3);
    const body = energy(w.bands, 3, 11);
  const mid = energy(w.bands, 6, 13);
  const speech = energy(w.bands, 5, 12); // 280 – 2400 Гц: форманты голоса
  const high = energy(w.bands, 10, 16);
  const veryHigh = energy(w.bands, 11, 16); // 1.7 – 8 кГц: птицы и стрёкот

  return {
    // Листва, ветер, вода, дождь: звук, который просто идёт и идёт. Отдельных
    // событий в нём нет — ни резких начал, ни пауз, ни перепада громкости.
    // Это же класс по умолчанию: когда ничто другое не подошло, в лесу шумит
    // лес, а не браконьер.
    nature: [
      { label: "звук не прерывается", weight: 3.0, value: ramp(w.duty, 0.5, 0.9) },
      { label: "нет резких начал", weight: 3.0, value: 1 - ramp(w.onsets, 0.12, 0.5) },
      { label: "ровная громкость", weight: 2.5, value: 1 - ramp(w.levelSpan, 0.2, 0.6) },
      { label: "нет высоты тона", weight: 2.5, value: 1 - ramp(w.harmonic, 0.25, 0.55) },
      // Ровный звук с устойчивой высотой тона издаёт механизм, а не лес: без
      // этого терма «природа» выигрывала у бензопилы, потому что всё
      // перечисленное выше («не прерывается, не скачет, без резких начал»)
      // верно и для мотора. Именно терм, а не обязательное условие:
      // обязательным он отдавал бы ветер и костёр классу «транспорт» — так и
      // было, и ложных тревог стало вдвое больше.
      {
        label: "это не мотор",
        weight: 3.0,
        value: 1 - ramp(w.harmonic, 0.25, 0.55) * ramp(w.steady, 0.3, 0.7),
      },
      { label: "энергия по всему спектру", weight: 2.0, value: ramp(w.spread, 0.7, 0.9) },
      // Узкий пик в спектре — это чей-то голос или свист, а не шум леса.
      // Дождь, ветер и вода держат энергию размазанной; птица ставит её
      // столбом в одну полосу.
      { label: "нет узкого пика", weight: 2.0, value: 1 - ramp(w.bandPeak, 0.2, 0.45) },
      // Вес больше, чем у остальных «отсутствий»: ровный гул ниже 150 Гц лес
      // сам по себе не издаёт, и без этого терма шум мотора выигрывал у
      // самого мотора — «не прерывается, не скачет, без тона» верно и для
      // двигателя тоже. Но это терм, а не обязательное условие: сделать его
      // gate — значит отдать ветер и костёр классу «транспорт».
      { label: "нет гула на низах", weight: 3.0, value: 1 - ramp(deepLow, 0.2, 0.42) },
    ],

    // Птицы, стрёкот, крики зверей: энергия выше, чем у остального леса, и
    // собрана в узкие пики — свист, трель, цикада. От шума воды отличается
    // именно узостью: у дождя энергия размазана, у птицы стоит столбом.
    animal: [
      { label: "звук высокий", weight: 3.0, value: ramp(w.centroid, 0.42, 0.62), gate: true },
      { label: "узкие тональные пики", weight: 3.0, value: ramp(w.bandPeak, 0.15, 0.35) },
      { label: "энергия выше 1.3 кГц", weight: 2.5, value: ramp(high, 0.18, 0.4) },
      { label: "частые переходы через ноль", weight: 2.0, value: ramp(w.zcr, 0.08, 0.25) },
      // Птица поёт, а не бьёт: если громкость скакнула на тридцать децибел,
      // это событие, а не пение — и пусть за него отвечают другие классы.
      { label: "громкость не скачет", weight: 2.5, value: 1 - ramp(w.levelSpan, 0.5, 0.9) },
      { label: "тональный пик", weight: 2.0, value: ramp(w.tonal, 0.3, 0.5) },
      { label: "нет гула на низах", weight: 1.5, value: 1 - ramp(deepLow, 0.15, 0.35) },
    ],

    // Человек: речь, смех, кашель, разговор двух браконьеров между собой.
    // Голос — самый прямой признак присутствия человека: лай, мотор и пила
    // говорят о нём косвенно, голос — напрямую.
    //
    // Речь узнаётся не спектром, а его непрерывным движением. У голоса есть
    // основной тон (80–300 Гц) и форманты в полосе 0.3–3 кГц, но главное —
    // он всё время меняется: гласные, согласные, паузы между слогами идут
    // четыре-восемь раз в секунду. Ни один механизм так не делает: мотор и
    // пила стоят на месте, вода шумит ровно.
    voice: [
      { label: "энергия в полосе 0.3–2.4 кГц", weight: 3.0, value: ramp(speech, 0.42, 0.62), gate: true },
      // Голос живёт ниже птиц. Это и есть главное, что их разделяет: у смеха и
      // речи выше 1.7 кГц лежит пятая часть энергии, у птичьего пения —
      // половина, у стрёкота почти всё. Признаки вроде «есть высота тона» тут
      // не помогают: у трели она тоже есть.
      { label: "не выше птичьего пения", weight: 3.0, value: 1 - ramp(veryHigh, 0.22, 0.4), gate: true },
      { label: "спектр всё время движется", weight: 3.0, value: 1 - ramp(w.steady, 0.45, 0.75), gate: true },
      { label: "не одиночный вскрик", weight: 2.5, value: 1 - ramp(w.levelSpan, 0.65, 0.95), gate: true },
      { label: "есть основной тон голоса", weight: 2.5, value: ramp(w.harmonic, 0.25, 0.6) },
      // Речь тянется слогами: занимает две трети времени, а не треть, как лай.
      // Терм, а не условие: смех в упор идёт непрерывно, и отсекать его было бы
      // неправильно.
      { label: "слоги, а не отдельные выкрики", weight: 2.5, value: gauss(w.duty, 0.72, 0.3) },
      { label: "голос средней высоты", weight: 2.0, value: gauss(w.centroid, 0.55, 0.15) },
      { label: "голос, а не удар", weight: 2.0, value: 1 - ramp(w.crest, 0.25, 0.55) },
      { label: "спектр широкий, не свист", weight: 1.5, value: 1 - ramp(w.bandPeak, 0.3, 0.55) },
    ],

    // Лай: отдельные выкрики с паузами. Каждый — резкое начало и глубокий
    // провал громкости следом. Похожих в лесу двое: кудахтанье (тоже выкрики,
    // но тише и без провалов) и капель (тоже провалы, но это щелчки, а не
    // голос). Поэтому обязательны все четыре условия сразу.
    dog: [
      { label: "отдельные выкрики с паузами", weight: 3.0, value: 1 - ramp(w.duty, 0.4, 0.75), gate: true },
      { label: "резкие начала", weight: 3.0, value: ramp(w.onsets, 0.2, 0.6), gate: true },
      { label: "выкрик много громче фона", weight: 3.0, value: ramp(w.levelSpan, 0.5, 0.9), gate: true },
      { label: "голос, а не щелчок", weight: 2.5, value: 1 - ramp(w.crest, 0.1, 0.3), gate: true },
      { label: "энергия в полосе 0.4–3 кГц", weight: 2.5, value: ramp(mid, 0.3, 0.5) },
      { label: "звук средней высоты", weight: 2.0, value: gauss(w.centroid, 0.48, 0.14) },
      { label: "голосовая гармоника", weight: 1.5, value: ramp(w.harmonic, 0.25, 0.6) },
    ],

    // Двигатель: гул на самых низах, который не меняется. Отличать его
    // приходится не от тишины, а от ветра и от костра — они тоже ровные и
    // тоже низкие. Ветер отсекается тем, что его энергия сидит выше 150 Гц,
    // костёр — тем, что он трещит: у огня пики в сорок раз выше среднего.
    vehicle: [
      { label: "гул ниже 150 Гц", weight: 3.5, value: ramp(deepLow, 0.22, 0.38), gate: true },
      { label: "звук непрерывный", weight: 3.0, value: ramp(w.duty, 0.75, 0.95), gate: true },
      { label: "нет резких начал", weight: 3.0, value: 1 - ramp(w.onsets, 0.1, 0.5), gate: true },
      { label: "гудит, а не трещит", weight: 3.0, value: 1 - ramp(w.crest, 0.2, 0.45), gate: true },
      { label: "громкость ровная", weight: 3.0, value: 1 - ramp(w.levelSpan, 0.1, 0.4) },
      { label: "спектр неподвижен", weight: 2.5, value: ramp(w.steady, 0.35, 0.7) },
      { label: "звук низкий", weight: 2.5, value: gauss(w.centroid, 0.3, 0.14) },
      { label: "мало переходов через ноль", weight: 1.5, value: 1 - ramp(w.zcr, 0.04, 0.18) },
    ],

    // Бензопила: непрерывный мотор, но выше по спектру, чем машина, и с
    // выраженной высотой тона — пила визжит. Именно высота тона отделяет её от
    // ветра и дождя, которые тоже непрерывны и тоже шумят.
    chainsaw: [
      { label: "звук непрерывный", weight: 3.0, value: ramp(w.duty, 0.75, 0.95), gate: true },
      { label: "нет резких начал", weight: 3.0, value: 1 - ramp(w.onsets, 0.1, 0.5), gate: true },
      { label: "устойчивая высота тона", weight: 3.0, value: ramp(w.harmonic, 0.22, 0.42), gate: true },
      { label: "спектр неподвижен", weight: 2.5, value: ramp(w.steady, 0.3, 0.6), gate: true },
      { label: "энергия в полосе 0.15–1.7 кГц", weight: 2.5, value: ramp(body, 0.35, 0.55) },
      { label: "шум пилы поверх мотора", weight: 2.0, value: gauss(w.flatness, 0.5, 0.18) },
      { label: "звук средней высоты", weight: 2.0, value: gauss(w.centroid, 0.45, 0.14) },
      // Признака «громко» здесь больше нет, хотя по корпусу он выглядел
      // полезным: все записи пил в ESC-50 сделаны вблизи и потому громкие.
      // Но громкость говорит, как далеко источник, а не что это за источник.
      // Пила за двести метров тихая — и именно её датчик обязан поймать.
      { label: "это не гул мотора", weight: 1.5, value: 1 - ramp(deepLow, 0.25, 0.45) },
    ],

    // Выстрел: одиночный хлопок. Всё окно — тишина, в которой один-два кадра
    // взлетают на два десятка децибел и тут же гаснут. Ровный громкий звук
    // выстрелом быть не может, поэтому «коротко» здесь обязательно. И у
    // хлопка нет высоты тона — этим он отличается от капели, которая звенит.
    gunshot: [
      { label: "резкий удар", weight: 3.5, value: ramp(w.attack, 0.6, 0.95), gate: true },
      { label: "хлопок короче паузы", weight: 3.0, value: 1 - ramp(w.duty, 0.45, 0.8), gate: true },
      { label: "пик много выше фона", weight: 3.0, value: ramp(w.levelSpan, 0.45, 0.8), gate: true },
      { label: "нет высоты тона", weight: 3.0, value: 1 - ramp(w.harmonic, 0.3, 0.6), gate: true },
      // Вокруг хлопка — тишина. Это же сказано в обязательном условии выше, и
      // повторено здесь намеренно: у «природы» обязательных условий нет, и
      // выстрел, у которого совпало всё, обязан её перевесить, а не сравняться.
      { label: "тишина вокруг хлопка", weight: 2.5, value: 1 - ramp(w.duty, 0.15, 0.6) },
      { label: "импульс, а не тон", weight: 2.0, value: ramp(w.crest, 0.15, 0.45) },
      { label: "широкий шумовой спектр", weight: 2.0, value: ramp(w.flatness, 0.2, 0.5) },
      { label: "энергия размазана по спектру", weight: 2.0, value: ramp(w.spread, 0.78, 0.92) },
      { label: "не высокий звук", weight: 1.5, value: 1 - ramp(w.centroid, 0.45, 0.7) },
    ],

    // Фон: ничего заметного. Постоянный небольшой уровень, чтобы «ничего не
    // подошло» не превращалось в случайный класс, плюс два условия тишины.
    //
    // Главное здесь — «ничего не выделяется НАД ФОНОМ», а не «тихо вообще».
    // Раньше тишина считалась от абсолютного уровня по шкале −45…−12 дБFS, и
    // далёкий лай на −47 дБ проигрывал тишине со счётом 55:1 — хотя в ночном
    // парке фон стоит около −60 дБ и такой лай как раз и есть событие.
    // Абсолютная громкость осталась, но по шкале −60…−40: она отвечает на
    // вопрос «есть ли вообще хоть что-то громче фона микрофона», а не «близко
    // ли источник». Датчик обязан слышать пилу за двести метров.
    other: [
      { label: "ничего не выделяется над фоном", weight: 3.0, value: 1 - ramp(w.levelSpan, 0.3, 0.7) },
      { label: "нет резких начал", weight: 2.0, value: 1 - ramp(w.onsets, 0.1, 0.5) },
      { label: "тихо", weight: 3.0, value: 1 - ramp(w.rms, -60, -40) },
      { label: "фоновый уровень", weight: 2.0, value: 0.42 },
    ],
  };
}

/**
 * Взвешенное среднее обычных термов, умноженное на обязательные.
 * Провалившийся gate оставляет классу десятую часть — не ноль, чтобы вердикт
 * оставался сравнением, а не запретом.
 */
function totals(terms: Terms): Record<SoundClass, number> {
  const out = {} as Record<SoundClass, number>;
  for (const name of SOUND_CLASSES) {
    let sum = 0;
    let weight = 0;
    let gates = 1;
    for (const term of terms[name]) {
      const value = clamp01(term.value);
      if (term.gate) gates *= 0.1 + 0.9 * value;
      else {
        sum += term.weight * value;
        weight += term.weight;
      }
    }
    out[name] = (weight > 0 ? sum / weight : 0.5) * gates;
  }
  return out;
}

/**
 * Полный разбор: сырой балл каждого класса и все его термы. Нужен для отладки
 * порогов — `npm run eval -- --why` печатает именно это, и видно, какое
 * обязательное условие не пустило верный класс наверх.
 */
export function inspect(w: WindowFeatures): {
  name: SoundClass;
  total: number;
  terms: { label: string; weight: number; value: number; gate: boolean }[];
}[] {
  const terms = score(w);
  const raw = totals(terms);
  return [...SOUND_CLASSES]
    .map((name) => ({
      name,
      total: raw[name],
      terms: terms[name].map((t) => ({
        label: t.label,
        weight: t.weight,
        value: clamp01(t.value),
        gate: t.gate === true,
      })),
    }))
    .sort((a, b) => b.total - a.total);
}

/** Софтмакс по классам, в целых процентах, в сумме ровно 100. */
export function classify(w: WindowFeatures): Classification {
  const raw = totals(score(w));

  // Тише порога — это фон парка, а не событие. Честнее сказать «тишина», чем
  // угадывать класс по шуму собственного микрофона.
  if (w.rms < SILENCE_DB) {
    for (const name of SOUND_CLASSES) {
      raw[name] = name === "other" ? 1 : raw[name] * 0.2;
    }
  }

  let max = -Infinity;
  for (const name of SOUND_CLASSES) max = Math.max(max, raw[name]);

  const exp = {} as Record<SoundClass, number>;
  let sum = 0;
  for (const name of SOUND_CLASSES) {
    exp[name] = Math.exp((raw[name] - max) / TEMPERATURE);
    sum += exp[name];
  }

  const percents = {} as Record<SoundClass, number>;
  for (const name of SOUND_CLASSES) percents[name] = (exp[name] / sum) * 100;
  return roundTo100(percents);
}

/** Округление по наибольшему остатку: полоски в интерфейсе всегда дают 100. */
function roundTo100(values: Record<SoundClass, number>): Classification {
  const floors = {} as Record<SoundClass, number>;
  let used = 0;
  for (const name of SOUND_CLASSES) {
    floors[name] = Math.floor(values[name]);
    used += floors[name];
  }

  const order = [...SOUND_CLASSES].sort(
    (a, b) => (values[b] - floors[b]) - (values[a] - floors[a]),
  );
  let remainder = 100 - used;
  for (const name of order) {
    if (remainder <= 0) break;
    floors[name] += 1;
    remainder -= 1;
  }
  return floors;
}

/**
 * Два-три признака, которые вывели класс `name` наверх, сильнейший первым.
 * Именно это превращает демонстрацию из «поверьте проценту» в «вот почему».
 */
export function explain(w: WindowFeatures, name: SoundClass): string[] {
  return [...score(w)[name]]
    .map((t) => ({
      label: t.label,
      // Обязательный признак важнее обычного: если он совпал, он и есть ответ.
      strength: (t.gate ? t.weight * 1.5 : t.weight) * clamp01(t.value),
    }))
    .sort((a, b) => b.strength - a.strength)
    .filter((t) => t.strength > 0.9)
    .slice(0, 3)
    .map((t) => t.label);
}
