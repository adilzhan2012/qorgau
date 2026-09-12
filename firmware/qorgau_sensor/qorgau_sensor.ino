/*
 * Qorgau — акустический датчик на ESP32-S3: I2S-микрофон + GPS.
 * ------------------------------------------------------------------
 *
 * Что делает плата:
 *   1. пишет звук с микрофона на 16 кГц кадрами по 1024 отсчёта (64 мс);
 *   2. считает БПФ и вытаскивает из кадра 10 чисел + 16 полос спектра;
 *   3. копит последние 24 кадра — полторы секунды — и считает по ним то, чего
 *      у одного кадра нет: ровность, долю громкого времени, перепад громкости,
 *      число резких начал. По кадру в 64 мс лай, капля и хлопок неразличимы;
 *   4. САМА решает, что это за звук, и опасен ли он:
 *        безопасно — природа (листва, ветер, вода), птицы и звери, тишина;
 *        опасно    — лай собаки, машина, бензопила, выстрел;
 *      и показывает это встроенным светодиодом: зелёный / красный;
 *   5. печатает признаки и вердикт одной строкой JSON в USB Serial;
 *   6. представляется по имени (ID) и позволяет сайту это имя поменять;
 *   7. читает GPS и раз в две секунды сообщает, где стоит — сайт сам
 *      ставит устройство на карту.
 *
 * Классификатор здесь — точная копия src/lib/audio/window.ts и classify.ts на
 * сайте: те же признаки, те же веса, те же пороги. Сайт считает вердикт и сам
 * (для микрофона ноутбука и файлов), а вердикт платы показывает рядом. В
 * настоящем лесу по LoRa уйдёт именно вердикт платы — несколько байт.
 *
 * Что копия остаётся копией, проверяется машиной, а не глазами: `npm run
 * fw-check` вырезает из этого файла кусок между метками «ОБЩЕЕ С САЙТОМ»,
 * собирает его обычным g++ и сравнивает вердикты с браузерными на трёхстах
 * случайных наборах признаков.
 *
 * ID хранится во флеше платы. Прошивать под каждую точку не нужно: на сайте
 * открываете устройство → «Записать ID в плату», и плата с тех пор сама
 * находит своё место на карте на любом ноутбуке.
 *
 * Если правите пороги — правьте в обоих местах, иначе плата и сайт
 * разойдутся во мнениях. Пороги подобраны не на слух: они измерены на корпусе
 * полевых записей (`npm run corpus`, затем `npm run eval`), и менять их стоит
 * тоже по нему — иначе легко починить один звук и сломать пять.
 *
 * ВАЖНО про Arduino UNO: подключить к нему INMP441 нельзя. У ATmega328P нет
 * блока I2S, всего 2 КБ ОЗУ и 16 МГц — БПФ на 1024 точки туда не поместится.
 * Микрофон работает только с ESP32-S3.
 *
 * ── Микрофон: INMP441 или ICS-43434 (одинаковая распиновка) ─────────
 *      VDD  → 3V3            SCK (BCLK) → GPIO4
 *      GND  → GND            WS  (LRCL) → GPIO5
 *      L/R  → GND            SD  (DOUT) → GPIO6
 *   Ножка L/R выбирает, в каком из двух слотов I2S микрофон отдаёт данные.
 *   В каком именно — зависит и от микрофона, и от версии драйвера, и в
 *   интернете на этот счёт спорят. Поэтому плата читает ОБА слота и сама
 *   берёт тот, где есть сигнал; L/R можно посадить хоть на GND, хоть на 3V3.
 *   Оба микрофона — цифровые I2S MEMS с одним и тем же интерфейсом, подходит
 *   любой. Если подключить оба сразу на одну шину (SCK, WS, SD общие) с
 *   разным L/R — плата возьмёт тот, что громче в момент старта.
 *   Если у вас распаяно иначе — поменяйте три строки PIN_* ниже.
 *
 * ── GPS: любой UART-модуль с NMEA (NEO-6M, NEO-M8N, ATGM336H…) ──────
 *      VCC  → 3V3 (или 5V, если на модуле есть стабилизатор — обычно есть)
 *      GND  → GND
 *      TX   → GPIO18   (модуль ГОВОРИТ → плата слушает: это RX платы)
 *      RX   → GPIO17   (можно не подключать: мы модулю ничего не шлём)
 *   Скорость 9600 — заводская у всех перечисленных. Первый захват спутников
 *   под открытым небом занимает 1–5 минут; в помещении GPS не работает.
 *   Без GPS плата работает как раньше — просто не сообщает координаты.
 *
 * ── Как загрузить ──────────────────────────────────────────────────
 *   Инструменты → Плата → ESP32 Arduino → «ESP32S3 Dev Module»
 *   USB CDC On Boot → Enabled      (иначе Serial не будет виден)
 *   PSRAM → «OPI PSRAM»            (у платы N8R2 память есть)
 *   Инструменты → Порт → ваш COM-порт
 *
 * ── Как проверить, что работает ────────────────────────────────────
 *   Откройте Монитор порта на 115200. Сначала плата сама проверит микрофон и
 *   напишет, что не так с распиновкой, если что-то не так. Затем пойдут строки вида
 *   {"id":"QRG-001","rms":-52.3,...}. Затем на сайте нажмите
 *   «Подключить плату ESP32» и выберите тот же порт — один раз, дальше плата
 *   будет подключаться сама.
 *   ВНИМАНИЕ: Монитор порта надо ЗАКРЫТЬ перед подключением из браузера —
 *   COM-порт может держать только одна программа.
 *
 * ── Что печатает плата ─────────────────────────────────────────────
 *   {"hello":"qorgau","fw":"1.2","id":"QRG-001","mic":"ok"}   при старте и по запросу
 *   {"id":"QRG-001","rms":-52.3,...,"crest":0.12,...,"top":"nature","conf":87,"danger":false,"bands":[...]}
 *                                                                ~15 раз в секунду
 *   {"gps":{"fix":true,"lat":43.05613,"lng":76.98481,"sats":7,"hdop":1.1,"alt":1650}}
 *   {"gps":{"fix":false,"sats":2}}                              раз в 2 секунды
 *   {"gps":{"fix":false,"seen":false}}   модуль молчит: проверьте TX→GPIO18 и питание
 *
 * ── Команды с сайта (строка JSON в порт) ───────────────────────────
 *   {"get":"hello"}            → плата отвечает hello
 *   {"set":{"id":"QRG-007"}}   → сохраняет новый ID во флеш и отвечает hello
 */

#include <ctype.h>
#include <math.h>
#include <string.h>
#include <Preferences.h>

// ─────────────────────────── Настройки ───────────────────────────

#define FW_VERSION  "1.5"
#define DEFAULT_ID  "QRG-001"   // ID до того, как сайт запишет свой
#define PIN_BCLK    4           // SCK на модуле микрофона
#define PIN_LRCL    5           // WS
#define PIN_DOUT    6           // SD

// Встроенный RGB-светодиод (WS2812). На ESP32-S3-DevKitC-1 это GPIO48, на
// части плат — GPIO38. -1 — не использовать. Зелёный — безопасно, красный —
// опасно, синий — тишина, жёлтый мигает — GPS ещё ищет спутники.
#define PIN_LED      48
#define LED_BRIGHT   28         // 0..255; больше — слепит

// GPS по UART1. PIN_GPS_RX — куда приходит TX модуля. -1 — GPS не подключён.
#define PIN_GPS_RX   18
#define PIN_GPS_TX   17
#define GPS_BAUD     9600
#define GPS_REPORT_MS 2000      // как часто сообщать координаты сайту
#define GPS_SILENT_MS 5000      // сколько молчания считать «модуль не отвечает»

// Батарея. -1 — плата на USB и заряд не измеряет (в JSON поля "bat" не будет).
// Для автономной точки: делитель 1:1 (два одинаковых резистора) с плюса
// Li-ion на любой ADC-пин, например GPIO1, и PIN_BATTERY 1.
#define PIN_BATTERY      -1
#define BATTERY_DIVIDER  2.0f   // во сколько раз делитель уменьшает напряжение
#define BATTERY_EMPTY_MV 3300
#define BATTERY_FULL_MV  4200

#define SAMPLE_RATE 16000
#define FRAME_LEN   1024        // 64 мс — столько же берёт браузер
#define FFT_SIZE    1024        // весь кадр: спектр и громкость с одних и тех же 64 мс
#define BAND_COUNT  16
#define BAND_LOW_HZ 60.0f
#define BAND_HI_HZ  8000.0f

// ──────────────────── I2S: две версии ядра ESP32 ──────────────────
// В ядре 3.x старый драйвер объявлен устаревшим и появился класс I2SClass.
// Собираем нужную ветку автоматически, чтобы скетч компилировался и там и там.

#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  #define QORGAU_NEW_I2S 1
  #include <ESP_I2S.h>
  static I2SClass i2s;
#else
  #define QORGAU_NEW_I2S 0
  #include <driver/i2s.h>
#endif

// ─────────────────────────── Буферы ───────────────────────────────

static int32_t rawBuf[FRAME_LEN * 2];  // сырые 32-битные слова из I2S, два слота вперемешку
static int     micSlot = -1;           // в каком слоте живёт микрофон; -1 — ещё не нашли
static float   frame[FRAME_LEN];       // они же в диапазоне -1..1
static float   fftRe[FFT_SIZE];
static float   fftIm[FFT_SIZE];
static float   spectrum[FFT_SIZE / 2];
static float   hann[FFT_SIZE];
static float   bands[BAND_COUNT];
static int     bandFrom[BAND_COUNT];   // границы полос в номерах бинов БПФ
static int     bandTo[BAND_COUNT];

// История громкости: нужна, чтобы понять, насколько резко нарос звук.
#define HISTORY 8
static float levelHistory[HISTORY];
static int   historyCount = 0;

// Кто мы. Читается из флеша при старте, меняется командой с сайта.
static Preferences prefs;
static char deviceId[25] = DEFAULT_ID;
static char micStatus[128] = "ok";    // "ok" или что нашла проверка микрофона
static int  batteryPct = -1;          // -1 — не измеряем
static char cmdBuf[128];              // строка команды с сайта, копится по байту
static int  cmdLen = 0;

// Вердикт: индекс класса и уверенность, плюс защёлка тревоги для светодиода.
static int      lastTop = 6;          // CLS_OTHER
static int      lastConf = 0;
static bool     lastDanger = false;
static int      dangerStreak = 0;     // подряд кадров с ОДНИМ И ТЕМ ЖЕ опасным вердиктом
static int      dangerVote = -1;      // какой это класс (-1 — опасного голоса нет)
static uint32_t dangerUntilMs = 0;    // пока не прошло — светим красным

// GPS: последнее, что сказал модуль.
#if PIN_GPS_RX >= 0
static HardwareSerial GPS(1);
#endif
static char     nmeaBuf[100];
static int      nmeaLen = 0;
static bool     gpsFix = false;
static double   gpsLat = 0.0, gpsLng = 0.0;
static int      gpsSats = 0;
static float    gpsHdop = 0.0f, gpsAlt = 0.0f;
static uint32_t gpsLastByteMs = 0;    // 0 — модуль не сказал ещё ни байта
static uint32_t gpsLastReportMs = 0;

// ───────────────────────── Утилиты ────────────────────────────────

static inline float clamp01(float v) {
  if (!isfinite(v)) return 0.0f;
  return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v);
}

static const float SILENCE_DB = -100.0f;

static float toDb(float amplitude) {
  if (amplitude <= 1e-7f) return SILENCE_DB;
  float db = 20.0f * log10f(amplitude);
  return db < SILENCE_DB ? SILENCE_DB : db;
}

// ─────────────────────────── БПФ ──────────────────────────────────
// Тот же алгоритм, что в src/lib/audio/fft.ts. Библиотека не нужна.

static void fftRun() {
  // Перестановка по обратному порядку битов.
  for (int i = 1, j = 0; i < FFT_SIZE; i++) {
    int bit = FFT_SIZE >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      float t = fftRe[i]; fftRe[i] = fftRe[j]; fftRe[j] = t;
      t = fftIm[i]; fftIm[i] = fftIm[j]; fftIm[j] = t;
    }
  }

  for (int len = 2; len <= FFT_SIZE; len <<= 1) {
    float ang = -2.0f * (float)M_PI / (float)len;
    float wr = cosf(ang), wi = sinf(ang);
    for (int i = 0; i < FFT_SIZE; i += len) {
      float cr = 1.0f, ci = 0.0f;
      for (int k = 0; k < len / 2; k++) {
        int a = i + k, b = i + k + len / 2;
        float br = fftRe[b] * cr - fftIm[b] * ci;
        float bi = fftRe[b] * ci + fftIm[b] * cr;
        float ar = fftRe[a], ai = fftIm[a];
        fftRe[a] = ar + br; fftIm[a] = ai + bi;
        fftRe[b] = ar - br; fftIm[b] = ai - bi;
        float nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// ─────────────────────── Признаки кадра ───────────────────────────

/** Среднеквадратичная громкость. */
static float computeRms(const float *x, int n) {
  float sum = 0.0f;
  for (int i = 0; i < n; i++) sum += x[i] * x[i];
  return sqrtf(sum / (float)n);
}

/** Как часто сигнал пересекает ноль. У шипения высоко, у гула низко. */
static float computeZcr(const float *x, int n) {
  int crossings = 0;
  for (int i = 1; i < n; i++) {
    if ((x[i - 1] < 0.0f && x[i] >= 0.0f) || (x[i - 1] >= 0.0f && x[i] < 0.0f)) crossings++;
  }
  return clamp01((float)crossings / (float)(n - 1));
}

/**
 * Есть ли у звука высота тона (60–600 Гц). Автокорреляция: у двигателя и
 * лая пик будет, у выстрела — нет, там шум.
 * Шаг по задержке 2 вместо 1 — вдвое дешевле, на результат почти не влияет.
 */
/**
 * Высота тона: насколько кадр повторяет сам себя на периоде 60–600 Гц.
 *
 * Копия harmonicity() из src/lib/audio/features.ts, вместе с двумя её
 * тонкостями, без которых признак врёт:
 *   1. задержка обязана быть локальным максимумом — у любого плавного шума
 *      автокорреляция просто спадает от первой задержки, и порыв ветра
 *      получался «тональным» не хуже двигателя;
 *   2. считается не высота пика, а насколько он выше средней корреляции:
 *      периодический звук возвращается к себе и снова уходит, а шум немножко
 *      похож на себя при любом сдвиге.
 */
static float computeHarmonic(const float *x, int n) {
  const int step = 2;   // шаг по задержкам: вдвое меньше работы, та же картина
  int minLag = SAMPLE_RATE / 600;
  int maxLag = SAMPLE_RATE / 60;
  if (maxLag > n / 2) maxLag = n / 2;
  if (maxLag <= minLag + 2 * step) return 0.0f;

  float mean = 0.0f;
  for (int i = 0; i < n; i++) mean += x[i];
  mean /= (float)n;

  float energy = 0.0f;
  for (int i = 0; i < n; i++) {
    float v = x[i] - mean;
    energy += v * v;
  }
  if (energy <= 1e-9f) return 0.0f;

  // Корреляции считаем в буфер: локальный максимум иначе не найти.
  const int slots = (maxLag - minLag) / step + 1;
  static float corr[512];
  if (slots > (int)(sizeof(corr) / sizeof(corr[0]))) return 0.0f;

  for (int k = 0; k < slots; k++) {
    int lag = minLag + k * step;
    float acc = 0.0f, norm = 0.0f;
    for (int i = 0; i + lag < n; i++) {
      float a = x[i] - mean;
      acc += a * (x[i + lag] - mean);
      norm += a * a;
    }
    corr[k] = norm > 1e-9f ? acc / norm : 0.0f;
  }

  float peak = 0.0f, average = 0.0f;
  for (int k = 0; k < slots; k++) average += fabsf(corr[k]);
  average /= (float)slots;

  for (int k = 1; k < slots - 1; k++) {
    if (corr[k] > peak && corr[k] >= corr[k - 1] && corr[k] >= corr[k + 1]) peak = corr[k];
  }

  float headroom = 1.0f - average;
  if (headroom < 0.15f) headroom = 0.15f;
  return clamp01((peak - average) / headroom);
}

static float computeFlatness() {
  float logSum = 0.0f, sum = 0.0f;
  int count = 0;
  for (int i = 2; i < FFT_SIZE / 2; i++) {   // первые бины — постоянка и гул
    float v = spectrum[i] + 1e-9f;
    logSum += logf(v);
    sum += v;
    count++;
  }
  if (count == 0 || sum <= 0.0f) return 0.0f;
  return clamp01(expf(logSum / (float)count) / (sum / (float)count));
}

/** Энтропия распределения по полосам: 1 — энергия размазана, 0 — в одной полосе. */
static float computeSpread() {
  float h = 0.0f;
  for (int i = 0; i < BAND_COUNT; i++) {
    if (bands[i] > 1e-9f) h -= bands[i] * logf(bands[i]);
  }
  return clamp01(h / logf((float)BAND_COUNT));
}

/**
 * Энергия по 16 логарифмическим полосам, нормированная так, чтобы сумма = 1.
 * Именно СУММА квадратов по бинам, не среднее: усреднение по широкой верхней
 * полосе размазывает узкий пик, и свист птицы становится похож на шум.
 */
static void computeBands() {
  for (int b = 0; b < BAND_COUNT; b++) {
    float acc = 0.0f;
    for (int i = bandFrom[b]; i <= bandTo[b]; i++) acc += spectrum[i] * spectrum[i];
    bands[b] = sqrtf(acc);
  }
  float total = 0.0f;
  for (int b = 0; b < BAND_COUNT; b++) total += bands[b];
  if (total <= 1e-9f) {
    for (int b = 0; b < BAND_COUNT; b++) bands[b] = 1.0f / (float)BAND_COUNT;
  } else {
    for (int b = 0; b < BAND_COUNT; b++) bands[b] /= total;
  }
}

/**
 * Пик к среднему по форме волны, 0..1 на шкале 6–24 дБ. Синус даёт 3 дБ,
 * белый шум ~12, хлопок — за 20. Одно число, которое говорит «всплеск на
 * тишине», не заглядывая в спектр.
 */
static float computeCrest(const float *x, int n) {
  float peak = 0.0f, sum = 0.0f;
  for (int i = 0; i < n; i++) {
    float v = fabsf(x[i]);
    if (v > peak) peak = v;
    sum += x[i] * x[i];
  }
  float rms = sqrtf(sum / (float)(n > 0 ? n : 1));
  if (rms <= 1e-7f || peak <= 1e-7f) return 0.0f;
  return clamp01((20.0f * log10f(peak / rms) - 6.0f) / 18.0f);
}

/** Центр тяжести спектра по шкале полос, 0..1: гул ~0.1, свист птицы ~0.9. */
static float computeCentroid() {
  float weighted = 0.0f, total = 0.0f;
  for (int b = 0; b < BAND_COUNT; b++) {
    weighted += (float)b * bands[b];
    total += bands[b];
  }
  if (total <= 1e-9f) return 0.0f;
  return clamp01(weighted / total / (float)(BAND_COUNT - 1));
}

/** Насколько самая громкая частота выше средней, 0..1 на шкале 0–60 дБ. */
static float computeTonal() {
  float peak = 0.0f, sum = 0.0f;
  int count = 0;
  for (int i = 2; i < FFT_SIZE / 2; i++) {
    float v = spectrum[i];
    if (v > peak) peak = v;
    sum += v;
    count++;
  }
  if (count == 0 || sum <= 1e-9f || peak <= 1e-9f) return 0.0f;
  return clamp01((20.0f * log10f(peak / (sum / (float)count))) / 60.0f);
}

/** Насколько сдвинулась ФОРМА спектра с прошлого кадра, 0..1. */
static float computeFlux(const float *previous, bool havePrevious) {
  if (!havePrevious) return 0.0f;
  float sum = 0.0f;
  for (int b = 0; b < BAND_COUNT; b++) sum += fabsf(bands[b] - previous[b]);
  return clamp01(sum / 2.0f);
}

// ────────────────────────── Настройка ─────────────────────────────

static void setupTables() {
  for (int i = 0; i < FFT_SIZE; i++) {
    hann[i] = 0.5f * (1.0f - cosf(2.0f * (float)M_PI * i / (FFT_SIZE - 1)));
  }

  const float binHz = (float)SAMPLE_RATE / (float)FFT_SIZE;
  const float ratio = logf(BAND_HI_HZ / BAND_LOW_HZ) / (float)BAND_COUNT;
  for (int b = 0; b < BAND_COUNT; b++) {
    float lo = BAND_LOW_HZ * expf(ratio * b);
    float hi = BAND_LOW_HZ * expf(ratio * (b + 1));
    int from = (int)lroundf(lo / binHz);
    int to   = (int)lroundf(hi / binHz);
    if (from < 1) from = 1;
    if (to > FFT_SIZE / 2 - 1) to = FFT_SIZE / 2 - 1;
    if (to < from) to = from;
    bandFrom[b] = from;
    bandTo[b] = to;
  }
}

static bool setupI2S() {
  // Стерео, а не моно: читаем оба слота и ниже сами находим микрофон.
#if QORGAU_NEW_I2S
  // Ядро 3.x: setPins(bclk, ws, dout, din, mclk)
  i2s.setPins(PIN_BCLK, PIN_LRCL, -1, PIN_DOUT, -1);
  return i2s.begin(I2S_MODE_STD, SAMPLE_RATE,
                   I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_STEREO);
#else
  i2s_config_t cfg = {};
  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
  cfg.sample_rate = SAMPLE_RATE;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;
  cfg.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.intr_alloc_flags = 0;
  cfg.dma_buf_count = 6;
  cfg.dma_buf_len = 256;
  cfg.use_apll = false;

  if (i2s_driver_install(I2S_NUM_0, &cfg, 0, NULL) != ESP_OK) return false;

  i2s_pin_config_t pins = {};
  pins.bck_io_num = PIN_BCLK;
  pins.ws_io_num = PIN_LRCL;
  pins.data_out_num = I2S_PIN_NO_CHANGE;
  pins.data_in_num = PIN_DOUT;
  return i2s_set_pin(I2S_NUM_0, &pins) == ESP_OK;
#endif
}

/** Размах сырых значений в слоте (0 или 1) за последний кадр. 0 — линия мертва. */
static uint32_t slotRange(int slot) {
  int32_t lo = INT32_MAX, hi = INT32_MIN;
  for (int i = 0; i < FRAME_LEN; i++) {
    int32_t v = rawBuf[i * 2 + slot];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return (uint32_t)(hi - lo);
}

/**
 * Находит слот с микрофоном: тот, где данные меняются. Если оба живые
 * (два микрофона на одной шине) — тот, что размашистее. -1 — оба мертвы.
 */
static int pickSlot() {
  uint32_t r0 = slotRange(0), r1 = slotRange(1);
  if (r0 == 0 && r1 == 0) return -1;
  return r1 > r0 ? 1 : 0;
}

/** Читает ровно FRAME_LEN отсчётов и раскладывает их в frame[] как -1..1. */
static bool readFrame() {
  const size_t want = FRAME_LEN * 2 * sizeof(int32_t);
  size_t got = 0;

#if QORGAU_NEW_I2S
  got = i2s.readBytes((char *)rawBuf, want);
#else
  if (i2s_read(I2S_NUM_0, rawBuf, want, &got, portMAX_DELAY) != ESP_OK) return false;
#endif

  if (got < want) return false;

  // Слот выбираем заново, пока не нашли или пока в выбранном тишина по
  // линии — микрофон могли переткнуть, не выключая плату.
  if (micSlot < 0 || slotRange(micSlot) == 0) micSlot = pickSlot();
  const int slot = micSlot < 0 ? 0 : micSlot;

  // INMP441 отдаёт 24 бита, выровненных влево в 32-битном слове.
  // Сдвиг на 8 даёт знаковое 24-битное число, делим на 2^23.
  for (int i = 0; i < FRAME_LEN; i++) {
    frame[i] = (float)(rawBuf[i * 2 + slot] >> 8) / 8388608.0f;
  }
  return true;
}

/**
 * Проверка микрофона при включении, одна секунда.
 *
 * Без неё «микрофон припаян не к тем пинам» и «в комнате тихо» выглядят
 * совершенно одинаково — в обоих случаях просто идут строки с низким уровнем.
 * Здесь мы смотрим на СЫРЫЕ значения из I2S и говорим прямо, что не так.
 */
/**
 * Пока с микрофона идут одни нули, монитор порта должен оставаться читаемым:
 * строки с признаками бессмысленны, их печатаем раз в секунду (сайту хватает,
 * чтобы считать плату «в сети»), а раз в пять секунд — диагноз человеческим
 * языком. Иначе он один раз пролетает при старте и теряется.
 *
 * Возвращает true, если этот кадр стоит печатать.
 */
static bool micDeadThrottle(float rms) {
  static uint32_t deadSinceMs = 0;
  static uint32_t lastFrameMs = 0;
  static uint32_t lastNagMs = 0;
  uint32_t now = millis();

  if (rms > SILENCE_DB + 0.5f) {
    deadSinceMs = 0;
    return true;
  }
  if (deadSinceMs == 0) deadSinceMs = now;
  if (now - deadSinceMs < 2000) return true;   // пара секунд на раскачку

  if (now - lastNagMs >= 5000) {
    lastNagMs = now;
    if (micSlot < 0) {
      strlcpy(micStatus, "линия SD залипла в обоих слотах: проверьте SD→GPIO6, VDD→3V3 и GND", sizeof(micStatus));
    } else {
      snprintf(micStatus, sizeof(micStatus),
               "слот %d живой, но уровень на нуле: проверьте VDD→3V3 и GND", micSlot);
    }
    Serial.printf("{\"error\":\"микрофон молчит — %s\"}\n", micStatus);
  }

  if (now - lastFrameMs < 1000) return false;
  lastFrameMs = now;
  return true;
}

static void micSelfTest() {
  Serial.println("--- Qorgau: проверка микрофона (1 сек) ---");

  float minDb = 1e9f, maxDb = -1e9f;
  int frames = 0;

  for (int i = 0; i < 15; i++) {
    if (!readFrame()) continue;
    frames++;
    float db = toDb(computeRms(frame, FRAME_LEN));
    if (db < minDb) minDb = db;
    if (db > maxDb) maxDb = db;
  }

  Serial.printf("пины: BCLK=%d  WS=%d  SD=%d\n", PIN_BCLK, PIN_LRCL, PIN_DOUT);

  if (frames == 0) {
    Serial.println("ОШИБКА: I2S не отдал ни одного кадра.");
    Serial.println("  Проверьте BCLK и WS — без тактов микрофон молчит.");
    strlcpy(micStatus, "I2S не отдаёт кадры: проверьте BCLK и WS", sizeof(micStatus));
  } else if (micSlot < 0) {
    Serial.println("ОШИБКА: линия SD залипла на одном значении в обоих слотах.");
    Serial.println("  Проверьте SD/DOUT и питание VDD=3V3. Землю не забыли?");
    strlcpy(micStatus, "линия SD залипла: проверьте SD, VDD и GND", sizeof(micStatus));
  } else if (maxDb < -85.0f) {
    Serial.printf("ОШИБКА: данные идут (слот %d), но уровень на нуле (%.0f дБ).\n", micSlot, maxDb);
    Serial.println("  Проверьте питание VDD=3V3 и GND.");
    snprintf(micStatus, sizeof(micStatus), "слот %d живой, но уровень на нуле: проверьте VDD и GND", micSlot);
  } else {
    Serial.printf("OK: микрофон работает, слот %d. Уровень %.0f...%.0f дБ.\n", micSlot, minDb, maxDb);
    Serial.println("  Похлопайте — верхняя цифра должна подскочить к -20 дБ.");
    snprintf(micStatus, sizeof(micStatus), "ok (слот %d)", micSlot);
  }
  Serial.println("------------------------------------------");
}

// ──────────────────── ID, hello и команды с сайта ─────────────────

/** Буквы, цифры, дефис и подчёркивание, 1–24 знака — ровно то, что принимает сайт. */
static bool validId(const char *id) {
  size_t n = strlen(id);
  if (n == 0 || n > 24) return false;
  for (size_t i = 0; i < n; i++) {
    char c = id[i];
    bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
              (c >= '0' && c <= '9') || c == '-' || c == '_';
    if (!ok) return false;
  }
  return true;
}

static void loadDeviceId() {
  prefs.begin("qorgau", true);
  String stored = prefs.getString("id", "");
  prefs.end();
  if (stored.length() > 0 && validId(stored.c_str())) {
    strlcpy(deviceId, stored.c_str(), sizeof(deviceId));
  }
}

static void saveDeviceId(const char *id) {
  prefs.begin("qorgau", false);
  prefs.putString("id", id);
  prefs.end();
  strlcpy(deviceId, id, sizeof(deviceId));
}

/** Так плата представляется: при старте и по запросу сайта. */
static void printHello() {
  Serial.printf("{\"hello\":\"qorgau\",\"fw\":\"%s\",\"id\":\"%s\",\"mic\":\"%s\"}\n",
                FW_VERSION, deviceId, micStatus);
}

/**
 * Разбирает одну строку от сайта. JSON-библиотека не нужна: команд две,
 * и обе узнаются по подстроке.
 */
static void handleCommand(const char *line) {
  if (strstr(line, "\"get\"") && strstr(line, "\"hello\"")) {
    printHello();
    return;
  }

  const char *set = strstr(line, "\"set\"");
  if (set) {
    const char *key = strstr(set, "\"id\"");
    if (!key) return;
    const char *q1 = strchr(key + 4, '"');          // открывающая кавычка значения
    if (!q1) return;
    const char *q2 = strchr(q1 + 1, '"');
    if (!q2) return;
    size_t n = (size_t)(q2 - q1 - 1);
    if (n == 0 || n >= sizeof(deviceId)) return;

    char id[25];
    memcpy(id, q1 + 1, n);
    id[n] = '\0';
    for (size_t i = 0; i < n; i++) id[i] = (char)toupper((unsigned char)id[i]);

    if (!validId(id)) {
      Serial.println("{\"error\":\"ID: только латиница, цифры, дефис, до 24 знаков\"}");
      return;
    }
    saveDeviceId(id);
    printHello();
  }
}

/** Собирает байты из порта в строку и отдаёт готовые строки на разбор. Не блокирует. */
static void pollCommands() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (cmdLen > 0) {
        cmdBuf[cmdLen] = '\0';
        handleCommand(cmdBuf);
        cmdLen = 0;
      }
    } else if (cmdLen < (int)sizeof(cmdBuf) - 1) {
      cmdBuf[cmdLen++] = c;
    } else {
      cmdLen = 0;   // мусор длиннее буфера — выбрасываем
    }
  }
}

// <<< ОБЩЕЕ С САЙТОМ: window.ts + classify.ts — начало >>>
// Всё между этими метками — построчный перевод двух файлов сайта. Скрипт
// npm run fw-check вырезает этот кусок, собирает его обычным g++ и сравнивает
// вердикты с браузерной версией на случайных входах. Метки не трогайте.

// ──────────────────── Окно в полторы секунды ──────────────────────
// Копия src/lib/audio/window.ts. Решение принимается не по кадру в 64 мс —
// за такое время лай, капля и хлопок неразличимы, — а по последним двадцати
// четырём кадрам. Оттуда берутся признаки, которых у кадра нет: ровность,
// доля громкого времени, перепад громкости, число резких начал.

#define WIN_FRAMES 24
static const float FRAME_SECONDS = 0.064f;

static float winRms[WIN_FRAMES];
static float winZcr[WIN_FRAMES];
static float winHarm[WIN_FRAMES];
static float winFlat[WIN_FRAMES];
static float winSpread[WIN_FRAMES];
static float winCentroid[WIN_FRAMES];
static float winTonal[WIN_FRAMES];
static float winCrest[WIN_FRAMES];
static float winFlux[WIN_FRAMES];
static float winBands[WIN_FRAMES][BAND_COUNT];
static int   winCount = 0;   // сколько кадров накоплено, не больше WIN_FRAMES
static int   winHead  = 0;   // куда писать следующий кадр

typedef struct {
  float seconds, rms, peak, floorDb, levelSpan, duty, onsets, attack, steady;
  float bands[BAND_COUNT], bandPeak;
  float zcr, harmonic, flatness, spread, centroid, tonal, crest;
} Window;

static Window win;

static void windowPush(float rms, float zcr, float harmonic, float flatness, float spread,
                       float centroid, float tonal, float crest, float flux) {
  winRms[winHead] = rms;
  winZcr[winHead] = zcr;
  winHarm[winHead] = harmonic;
  winFlat[winHead] = flatness;
  winSpread[winHead] = spread;
  winCentroid[winHead] = centroid;
  winTonal[winHead] = tonal;
  winCrest[winHead] = crest;
  winFlux[winHead] = flux;
  for (int b = 0; b < BAND_COUNT; b++) winBands[winHead][b] = bands[b];

  winHead = (winHead + 1) % WIN_FRAMES;
  if (winCount < WIN_FRAMES) winCount++;
}

/** Индекс i-го по счёту кадра окна (0 — самый старый). */
static inline int winAt(int i) {
  return (winHead - winCount + i + 2 * WIN_FRAMES) % WIN_FRAMES;
}

/** Признаки всего окна. Порядок вычислений — как в summarise() на сайте. */
static void windowSummarise() {
  int n = winCount;
  if (n == 0) return;

  float peak = -1000.0f;
  for (int i = 0; i < n; i++) {
    float db = winRms[winAt(i)];
    if (db > peak) peak = db;
  }

  // Фон окна — двадцатый перцентиль уровня: сортируем копию, благо их 24.
  float sorted[WIN_FRAMES];
  for (int i = 0; i < n; i++) sorted[i] = winRms[winAt(i)];
  for (int i = 1; i < n; i++) {
    float v = sorted[i];
    int j = i - 1;
    while (j >= 0 && sorted[j] > v) { sorted[j + 1] = sorted[j]; j--; }
    sorted[j + 1] = v;
  }
  int floorIndex = (int)lroundf(0.2f * (float)(n - 1));
  float floorDb = sorted[floorIndex];

  // Вес кадра — его энергия: паузы между выкриками не должны размазывать
  // спектр лая в шум, хотя занимают больше времени, чем сам лай.
  float weights[WIN_FRAMES], totalWeight = 0.0f;
  for (int i = 0; i < n; i++) {
    weights[i] = powf(10.0f, winRms[winAt(i)] / 10.0f);
    totalWeight += weights[i];
  }
  if (totalWeight <= 0.0f) totalWeight = 1.0f;

  float zcr = 0, harm = 0, flat = 0, spread = 0, centroid = 0, tonal = 0, flux = 0;
  for (int b = 0; b < BAND_COUNT; b++) win.bands[b] = 0.0f;
  for (int i = 0; i < n; i++) {
    int k = winAt(i);
    float w = weights[i];
    zcr += winZcr[k] * w;
    harm += winHarm[k] * w;
    flat += winFlat[k] * w;
    spread += winSpread[k] * w;
    centroid += winCentroid[k] * w;
    tonal += winTonal[k] * w;
    flux += winFlux[k] * w;
    for (int b = 0; b < BAND_COUNT; b++) win.bands[b] += winBands[k][b] * w;
  }

  float bandTotal = 0.0f;
  for (int b = 0; b < BAND_COUNT; b++) bandTotal += win.bands[b];
  if (bandTotal <= 1e-9f) bandTotal = 1.0f;
  win.bandPeak = 0.0f;
  for (int b = 0; b < BAND_COUNT; b++) {
    win.bands[b] /= bandTotal;
    if (win.bands[b] > win.bandPeak) win.bandPeak = win.bands[b];
  }

  // Подъём громкости считаем по самому окну: у отдельного кадра память
  // короткая, и в записи, которая начинается сразу с лая, первым кадрам
  // просто не с чем сравнивать.
  int loudEnough = 0, onsetCount = 0;
  float steepest = 0.0f;
  for (int i = 0; i < n; i++) {
    float db = winRms[winAt(i)];
    if (db > peak - 12.0f) loudEnough++;
    if (i == 0) continue;
    float before = winRms[winAt(i - 1)];
    for (int back = 2; back <= 4 && i - back >= 0; back++) {
      float earlier = winRms[winAt(i - back)];
      if (earlier < before) before = earlier;
    }
    float rise = db - before;
    if (rise > steepest) steepest = rise;
    if (rise > 10.0f && db > floorDb + 8.0f) onsetCount++;
  }

  float seconds = (float)n * FRAME_SECONDS;
  win.seconds = seconds;
  win.rms = 10.0f * log10f(totalWeight / (float)n);
  win.peak = peak;
  win.floorDb = floorDb;
  win.levelSpan = clamp01((peak - floorDb) / 30.0f);
  win.duty = (float)loudEnough / (float)n;
  win.onsets = clamp01((float)onsetCount / seconds / 5.0f);
  win.attack = clamp01(steepest / 24.0f);
  win.steady = clamp01(1.0f - (flux / totalWeight) * 3.0f);
  win.zcr = zcr / totalWeight;
  win.harmonic = harm / totalWeight;
  win.flatness = flat / totalWeight;
  win.spread = spread / totalWeight;
  win.centroid = centroid / totalWeight;
  win.tonal = tonal / totalWeight;

  // Пик к среднему берём у самого громкого кадра, а не максимальный: у кадра,
  // на границу которого попал край звука, он всегда огромен.
  int loudest = winAt(0);
  for (int i = 1; i < n; i++) {
    int k = winAt(i);
    if (winRms[k] > winRms[loudest]) loudest = k;
  }
  win.crest = winCrest[loudest];
}

// ──────────────────────── Классификатор ───────────────────────────
// Копия src/lib/audio/classify.ts. Каждый класс — несколько акустических
// признаков с весами, затем softmax. Никаких нейросетей: каждый вердикт можно
// объяснить тем, какой признак его вытянул.
//
// Признаки бывают двух видов: обычные складываются во взвешенное среднее, а
// обязательные (gates) его умножают. Бензопила без непрерывного звука
// невозможна, сколько бы ни совпало остального, — это и есть gate.
//
// Пороги здесь — не на глаз: это квартили, измеренные на корпусе полевых
// записей (npm run corpus, затем npm run eval). Правите порог — правьте в
// обоих местах и перегоняйте проверку, иначе плата и сайт разойдутся.

enum { CLS_NATURE, CLS_ANIMAL, CLS_DOG, CLS_VEHICLE, CLS_CHAINSAW, CLS_GUNSHOT, CLS_OTHER, CLS_COUNT };
static const char *CLS_NAME[CLS_COUNT]  = {"nature", "animal", "dog", "vehicle", "chainsaw", "gunshot", "other"};
static const bool  CLS_DANGER[CLS_COUNT] = {false, false, true, true, true, true, false};

static const float CLS_SILENCE_DB  = -58.0f;   // тише — это фон, а не событие
static const float CLS_TEMPERATURE = 0.15f;    // softmax: меньше — решительнее
static const int   CLS_ALERT_PCT   = 45;       // уверенность, с которой опасный класс — тревога
static const uint32_t DANGER_HOLD_MS = 8000;   // выстрел длится 200 мс; красный держим дольше

/** Сколько кадров подряд должны сказать одно и то же, чтобы это была тревога. */
static const int CLS_CONFIRM[CLS_COUNT] = {0, 0, 5, 8, 8, 4, 0};
/** И сколько секунд звука должно накопиться в окне, прежде чем класс считается. */
static const float CLS_EVIDENCE[CLS_COUNT] = {0.0f, 0.0f, 0.5f, 1.0f, 1.0f, 0.25f, 0.0f};

/** Сумма полос [from, to) — доля энергии в этом диапазоне, 0..1. */
static float bandSum(int from, int to) {
  float sum = 0.0f;
  for (int i = from; i < to && i < BAND_COUNT; i++) sum += win.bands[i];
  return clamp01(sum);
}

/** 1 в точке mu, спадает за sigma. Для признаков, которые должны быть «посередине». */
static float gaussf(float x, float mu, float sigma) {
  float d = (x - mu) / sigma;
  return expf(-0.5f * d * d);
}

/** Линейная шкала: 0 при lo, 1 при hi. */
static float rampf(float x, float lo, float hi) {
  return clamp01((x - lo) / (hi - lo));
}

/**
 * Взвешенное среднее обычных признаков, умноженное на обязательные.
 * Провалившийся gate оставляет классу десятую часть — не ноль, чтобы вердикт
 * оставался сравнением, а не запретом.
 */
static float classScore(const float *w, const float *v, int n, const float *gates, int gn) {
  float sum = 0.0f, total = 0.0f;
  for (int i = 0; i < n; i++) { sum += w[i] * clamp01(v[i]); total += w[i]; }
  float score = total > 0.0f ? sum / total : 0.5f;
  for (int i = 0; i < gn; i++) score *= 0.1f + 0.9f * clamp01(gates[i]);
  return score;
}

static void classifyWindow() {
  float deepLow = bandSum(0, 3);    //   60 –  150 Гц  гул двигателя
  float body    = bandSum(3, 11);   //  150 – 1700 Гц  корпус бензопилы
  float mid     = bandSum(6, 13);   //  380 – 3200 Гц  форманты лая
  float high    = bandSum(10, 16);  //  1.3 –    8 кГц птицы, стрёкот, шипение

  float score[CLS_COUNT];
  {
    // Природа: звук, который просто идёт и идёт. Обязательных условий нет —
    // это класс по умолчанию: когда ничто другое не подошло, в лесу шумит лес.
    // Зато есть терм «это не мотор»: ровный звук с высотой тона издаёт
    // механизм, и без этого терма природа выигрывала у бензопилы.
    const float w[] = {3.0f, 3.0f, 2.5f, 2.5f, 3.0f, 2.0f, 2.0f, 3.0f};
    const float v[] = {
      rampf(win.duty, 0.5f, 0.9f),
      1.0f - rampf(win.onsets, 0.12f, 0.5f),
      1.0f - rampf(win.levelSpan, 0.2f, 0.6f),
      1.0f - rampf(win.harmonic, 0.25f, 0.55f),
      1.0f - rampf(win.harmonic, 0.25f, 0.55f) * rampf(win.steady, 0.3f, 0.7f),
      rampf(win.spread, 0.7f, 0.9f),
      1.0f - rampf(win.bandPeak, 0.2f, 0.45f),
      1.0f - rampf(deepLow, 0.2f, 0.42f),
    };
    score[CLS_NATURE] = classScore(w, v, 8, NULL, 0);
  }
  {
    // Птицы и стрёкот: энергия высоко и собрана в узкие пики.
    const float w[] = {3.0f, 2.5f, 2.0f, 2.5f, 2.0f, 1.5f};
    const float v[] = {
      rampf(win.bandPeak, 0.15f, 0.35f),
      rampf(high, 0.18f, 0.4f),
      rampf(win.zcr, 0.08f, 0.25f),
      1.0f - rampf(win.levelSpan, 0.5f, 0.9f),
      rampf(win.tonal, 0.3f, 0.5f),
      1.0f - rampf(deepLow, 0.15f, 0.35f),
    };
    const float g[] = {rampf(win.centroid, 0.42f, 0.62f)};
    score[CLS_ANIMAL] = classScore(w, v, 6, g, 1);
  }
  {
    // Лай: отдельные выкрики с паузами, каждый много громче фона и голосом,
    // а не щелчком. Похожи кудахтанье и капель, поэтому условий сразу четыре.
    const float w[] = {2.5f, 2.0f, 1.5f};
    const float v[] = {
      rampf(mid, 0.3f, 0.5f),
      gaussf(win.centroid, 0.48f, 0.14f),
      rampf(win.harmonic, 0.25f, 0.6f),
    };
    const float g[] = {
      1.0f - rampf(win.duty, 0.4f, 0.75f),
      rampf(win.onsets, 0.2f, 0.6f),
      rampf(win.levelSpan, 0.5f, 0.9f),
      1.0f - rampf(win.crest, 0.1f, 0.3f),
    };
    score[CLS_DOG] = classScore(w, v, 3, g, 4);
  }
  {
    // Двигатель: гул на самых низах, который не меняется. Ветер отсекается
    // тем, что его энергия сидит выше 150 Гц, костёр — тем, что он трещит.
    const float w[] = {3.0f, 2.5f, 2.5f, 1.5f};
    const float v[] = {
      1.0f - rampf(win.levelSpan, 0.1f, 0.4f),
      rampf(win.steady, 0.35f, 0.7f),
      gaussf(win.centroid, 0.3f, 0.14f),
      1.0f - rampf(win.zcr, 0.04f, 0.18f),
    };
    const float g[] = {
      rampf(deepLow, 0.22f, 0.38f),
      rampf(win.duty, 0.75f, 0.95f),
      1.0f - rampf(win.onsets, 0.1f, 0.5f),
      1.0f - rampf(win.crest, 0.2f, 0.45f),
    };
    score[CLS_VEHICLE] = classScore(w, v, 4, g, 4);
  }
  {
    // Бензопила: непрерывный мотор, но выше по спектру, чем машина, и с
    // выраженной высотой тона — пила визжит. Высота тона и отделяет её от
    // ветра и дождя, которые тоже непрерывны и тоже шумят.
    // Признака «громко» здесь нет намеренно: громкость говорит, как далеко
    // источник, а не что это за источник. Пила за двести метров тихая — и
    // именно её датчик обязан поймать.
    const float w[] = {2.5f, 2.0f, 2.0f, 1.5f};
    const float v[] = {
      rampf(body, 0.35f, 0.55f),
      gaussf(win.flatness, 0.5f, 0.18f),
      gaussf(win.centroid, 0.45f, 0.14f),
      1.0f - rampf(deepLow, 0.25f, 0.45f),
    };
    const float g[] = {
      rampf(win.duty, 0.75f, 0.95f),
      1.0f - rampf(win.onsets, 0.1f, 0.5f),
      rampf(win.harmonic, 0.22f, 0.42f),
      rampf(win.steady, 0.3f, 0.6f),
    };
    score[CLS_CHAINSAW] = classScore(w, v, 4, g, 4);
  }
  {
    // Выстрел: одиночный хлопок. Всё окно — тишина, в которой один-два кадра
    // взлетают на два десятка децибел и тут же гаснут.
    const float w[] = {2.5f, 2.0f, 2.0f, 2.0f, 1.5f};
    const float v[] = {
      1.0f - rampf(win.duty, 0.15f, 0.6f),
      rampf(win.crest, 0.15f, 0.45f),
      rampf(win.flatness, 0.2f, 0.5f),
      rampf(win.spread, 0.78f, 0.92f),
      1.0f - rampf(win.centroid, 0.45f, 0.7f),
    };
    const float g[] = {
      rampf(win.attack, 0.6f, 0.95f),
      1.0f - rampf(win.duty, 0.45f, 0.8f),
      rampf(win.levelSpan, 0.45f, 0.8f),
      1.0f - rampf(win.harmonic, 0.3f, 0.6f),
    };
    score[CLS_GUNSHOT] = classScore(w, v, 5, g, 4);
  }
  {
    // Фон: ничего заметного. Главное здесь — «ничего не выделяется НАД
    // ФОНОМ», а не «тихо вообще»: тишина, посчитанная от абсолютного уровня,
    // топила далёкий лай, хотя в ночном парке фон стоит около −60 дБ и такой
    // лай как раз и есть событие. Абсолютная громкость осталась, но по шкале
    // −60…−40 — она отвечает на вопрос «есть ли хоть что-то громче шума
    // микрофона», а не «близко ли источник».
    const float w[] = {3.0f, 2.0f, 3.0f, 2.0f};
    const float v[] = {
      1.0f - rampf(win.levelSpan, 0.3f, 0.7f),
      1.0f - rampf(win.onsets, 0.1f, 0.5f),
      1.0f - rampf(win.rms, -60.0f, -40.0f),
      0.42f,
    };
    score[CLS_OTHER] = classScore(w, v, 4, NULL, 0);
  }

  // Тише порога — это фон парка. Так и говорим, а не гадаем.
  if (win.rms < CLS_SILENCE_DB) {
    for (int i = 0; i < CLS_COUNT; i++) score[i] = (i == CLS_OTHER) ? 1.0f : score[i] * 0.2f;
  }

  float maxScore = score[0];
  for (int i = 1; i < CLS_COUNT; i++) if (score[i] > maxScore) maxScore = score[i];

  float e[CLS_COUNT], sum = 0.0f;
  for (int i = 0; i < CLS_COUNT; i++) { e[i] = expf((score[i] - maxScore) / CLS_TEMPERATURE); sum += e[i]; }

  int top = 0;
  for (int i = 1; i < CLS_COUNT; i++) if (e[i] > e[top]) top = i;

  lastTop = top;
  lastConf = (int)lroundf(e[top] / sum * 100.0f);

  // Тревога — только когда один и тот же опасный класс продержался положенное
  // число кадров подряд (или она уже горит). Кадр — 64 мс, так что четыре
  // кадра это четверть секунды. Одиночный дрогнувший кадр и есть большая
  // часть ложных тревог. Сайт применяет то же правило.
  bool vote = CLS_DANGER[top] && lastConf >= CLS_ALERT_PCT && win.seconds >= CLS_EVIDENCE[top];
  if (vote && top == dangerVote) dangerStreak++;
  else dangerStreak = vote ? 1 : 0;
  dangerVote = vote ? top : -1;

  lastDanger = vote && (dangerStreak >= CLS_CONFIRM[top] || millis() < dangerUntilMs);
  if (lastDanger) dangerUntilMs = millis() + DANGER_HOLD_MS;
}

// <<< ОБЩЕЕ С САЙТОМ: конец >>>

// ─────────────────────────── Светодиод ────────────────────────────

static void led(uint8_t r, uint8_t g, uint8_t b) {
#if PIN_LED >= 0
  #if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
    rgbLedWrite(PIN_LED, r, g, b);
  #else
    neopixelWrite(PIN_LED, r, g, b);
  #endif
#else
  (void)r; (void)g; (void)b;
#endif
}

/** Красный, пока держится тревога; иначе цвет по последнему вердикту. */
static void updateLed() {
#if PIN_LED >= 0
  uint32_t now = millis();
  if (now < dangerUntilMs) {
    led(LED_BRIGHT, 0, 0);
    return;
  }
  #if PIN_GPS_RX >= 0
  // GPS подключён, но захвата ещё нет: мигаем жёлтым раз в секунду.
  if (!gpsFix && gpsLastByteMs != 0 && (now / 500) % 2 == 0) {
    led(LED_BRIGHT, LED_BRIGHT / 2, 0);
    return;
  }
  #endif
  if (lastTop == CLS_OTHER) led(0, 0, LED_BRIGHT / 3);
  else led(0, LED_BRIGHT, 0);
#endif
}

// ──────────────────────────── GPS ─────────────────────────────────
// NMEA разбираем сами: нужны два предложения, библиотека ради них лишняя.
//   $GxRMC,время,A|V,ddmm.mmmm,N|S,dddmm.mmmm,E|W,скорость,курс,дата,...
//   $GxGGA,время,ddmm.mmmm,N|S,dddmm.mmmm,E|W,fix,спутников,HDOP,высота,M,...
// Gx — GP (только GPS), GN (GPS+ГЛОНАСС) и т.п.; префикс нам не важен.

/** ddmm.mmmm → градусы. Пустое поле (нет захвата) даёт 0. */
static double nmeaToDegrees(const char *field, char hemi) {
  double raw = atof(field);
  if (raw == 0.0) return 0.0;
  int deg = (int)(raw / 100.0);
  double minutes = raw - deg * 100.0;
  double result = deg + minutes / 60.0;
  return (hemi == 'S' || hemi == 'W') ? -result : result;
}

/** Режет предложение по запятым на месте. Возвращает число полей. */
static int splitFields(char *line, char *fields[], int maxFields) {
  int n = 0;
  char *p = line;
  fields[n++] = p;
  while (*p && n < maxFields) {
    if (*p == ',' || *p == '*') {
      *p = '\0';
      fields[n++] = p + 1;
    }
    p++;
  }
  return n;
}

static void handleNmea(char *line) {
  if (strlen(line) < 6 || line[0] != '$') return;
  const char *type = line + 3;                 // пропускаем "$GP" / "$GN"
  bool rmc = strncmp(type, "RMC", 3) == 0;
  bool gga = strncmp(type, "GGA", 3) == 0;
  if (!rmc && !gga) return;

  char *f[20];
  int n = splitFields(line, f, 20);

  if (rmc && n >= 7) {
    bool valid = f[2][0] == 'A';
    gpsFix = valid;
    if (valid) {
      gpsLat = nmeaToDegrees(f[3], f[4][0]);
      gpsLng = nmeaToDegrees(f[5], f[6][0]);
    }
  } else if (gga && n >= 10) {
    gpsSats = atoi(f[7]);
    gpsHdop = atof(f[8]);
    gpsAlt  = atof(f[9]);
    // GGA приходит чаще RMC у некоторых модулей; координаты берём и отсюда.
    if (atoi(f[6]) > 0) {
      gpsFix = true;
      gpsLat = nmeaToDegrees(f[2], f[3][0]);
      gpsLng = nmeaToDegrees(f[4], f[5][0]);
    }
  }
}

/** Собирает байты с модуля в предложения. Не блокирует. */
static void pollGps() {
#if PIN_GPS_RX >= 0
  while (GPS.available() > 0) {
    char c = (char)GPS.read();
    gpsLastByteMs = millis();
    if (c == '\n' || c == '\r') {
      if (nmeaLen > 0) {
        nmeaBuf[nmeaLen] = '\0';
        handleNmea(nmeaBuf);
        nmeaLen = 0;
      }
    } else if (nmeaLen < (int)sizeof(nmeaBuf) - 1) {
      nmeaBuf[nmeaLen++] = c;
    } else {
      nmeaLen = 0;
    }
  }
#endif
}

/** Раз в GPS_REPORT_MS — одна строка о том, где мы и видим ли спутники. */
static void reportGps() {
#if PIN_GPS_RX >= 0
  uint32_t now = millis();
  if (now - gpsLastReportMs < GPS_REPORT_MS) return;
  gpsLastReportMs = now;

  bool silent = gpsLastByteMs == 0 || now - gpsLastByteMs > GPS_SILENT_MS;
  if (silent) {
    Serial.println("{\"gps\":{\"fix\":false,\"seen\":false}}");
  } else if (gpsFix) {
    Serial.printf("{\"gps\":{\"fix\":true,\"lat\":%.6f,\"lng\":%.6f,\"sats\":%d,\"hdop\":%.1f,\"alt\":%.0f}}\n",
                  gpsLat, gpsLng, gpsSats, gpsHdop, gpsAlt);
  } else {
    Serial.printf("{\"gps\":{\"fix\":false,\"sats\":%d}}\n", gpsSats);
  }
#endif
}

/** Заряд в процентах по напряжению на делителе. Раз в две секунды — чаще незачем. */
static void pollBattery() {
#if PIN_BATTERY >= 0
  static uint32_t last = 0;
  if (millis() - last < 2000) return;
  last = millis();
  float mv = (float)analogReadMilliVolts(PIN_BATTERY) * BATTERY_DIVIDER;
  float pct = (mv - BATTERY_EMPTY_MV) * 100.0f / (BATTERY_FULL_MV - BATTERY_EMPTY_MV);
  batteryPct = (int)lroundf(pct < 0.0f ? 0.0f : (pct > 100.0f ? 100.0f : pct));
#endif
}

void setup() {
  Serial.begin(115200);
  delay(300);

  setupTables();
  loadDeviceId();
#if PIN_BATTERY >= 0
  analogReadResolution(12);
#endif
#if PIN_GPS_RX >= 0
  // Кадр звука читается 64 мс с блокировкой; на 9600 бод за это время
  // приходит ~60 байт, штатного буфера хватает, но запас не помешает.
  GPS.setRxBufferSize(1024);
  GPS.begin(GPS_BAUD, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
#endif

  if (!setupI2S()) {
    // Не молчим: без этого «нет данных» и «нет микрофона» выглядят одинаково.
    strlcpy(micStatus, "I2S не запустился: проверьте распиновку INMP441", sizeof(micStatus));
    while (true) {
      printHello();
      Serial.println("{\"error\":\"I2S не запустился — проверьте распиновку INMP441\"}");
      pollCommands();   // ID можно записать и в таком состоянии
      delay(2000);
    }
  }

  micSelfTest();
  printHello();
  led(0, 0, LED_BRIGHT / 3);
}

void loop() {
  pollCommands();
  pollGps();
  reportGps();
  pollBattery();
  if (!readFrame()) return;

  // ── громкость и резкость нарастания ──
  float rms = toDb(computeRms(frame, FRAME_LEN));
  bool printFrame = micDeadThrottle(rms);

  float floorDb = rms;
  for (int i = 0; i < historyCount; i++) {
    if (levelHistory[i] < floorDb) floorDb = levelHistory[i];
  }
  // Рост на 24 дБ за полсекунды — это резкий удар, а не плавный звук.
  float attack = clamp01((rms - floorDb) / 24.0f);

  if (historyCount < HISTORY) {
    levelHistory[historyCount++] = rms;
  } else {
    for (int i = 1; i < HISTORY; i++) levelHistory[i - 1] = levelHistory[i];
    levelHistory[HISTORY - 1] = rms;
  }

  float zcr = computeZcr(frame, FRAME_LEN);
  float harmonic = computeHarmonic(frame, FRAME_LEN);

  // ── спектр ──
  for (int i = 0; i < FFT_SIZE; i++) {
    fftRe[i] = frame[i] * hann[i];
    fftIm[i] = 0.0f;
  }
  fftRun();
  for (int i = 0; i < FFT_SIZE / 2; i++) {
    spectrum[i] = sqrtf(fftRe[i] * fftRe[i] + fftIm[i] * fftIm[i]);
  }

  // Форма спектра прошлого кадра нужна, чтобы измерить, насколько она
  // сдвинулась: из этого получается «ровность» окна.
  static float previousBands[BAND_COUNT];
  static bool havePreviousBands = false;

  computeBands();
  float flatness = computeFlatness();
  float spread = computeSpread();
  float centroid = computeCentroid();
  float tonal = computeTonal();
  float crest = computeCrest(frame, FRAME_LEN);
  float flux = computeFlux(previousBands, havePreviousBands);
  for (int b = 0; b < BAND_COUNT; b++) previousBands[b] = bands[b];
  havePreviousBands = true;

  windowPush(rms, zcr, harmonic, flatness, spread, centroid, tonal, crest, flux);
  windowSummarise();
  classifyWindow();
  updateLed();
  if (!printFrame) return;

  // ── одна строка JSON ──
  char line[640];
  int n = snprintf(line, sizeof(line),
      "{\"id\":\"%s\",\"rms\":%.1f,\"zcr\":%.3f,\"attack\":%.3f,"
      "\"harmonic\":%.3f,\"flatness\":%.3f,\"spread\":%.3f,"
      "\"crest\":%.3f,\"centroid\":%.3f,\"tonal\":%.3f,\"flux\":%.3f,",
      deviceId, rms, zcr, attack, harmonic, flatness, spread,
      crest, centroid, tonal, flux);
  if (batteryPct >= 0) {
    n += snprintf(line + n, sizeof(line) - n, "\"bat\":%d,", batteryPct);
  }
  n += snprintf(line + n, sizeof(line) - n, "\"top\":\"%s\",\"conf\":%d,\"danger\":%s,",
                CLS_NAME[lastTop], lastConf, lastDanger ? "true" : "false");
  n += snprintf(line + n, sizeof(line) - n, "\"bands\":[");

  for (int b = 0; b < BAND_COUNT && n < (int)sizeof(line) - 12; b++) {
    n += snprintf(line + n, sizeof(line) - n, "%s%.4f", b ? "," : "", bands[b]);
  }
  snprintf(line + n, sizeof(line) - n, "]}");

  Serial.println(line);
}
