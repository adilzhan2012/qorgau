/*
 * Qorgau — акустический датчик на ESP32-S3: I2S-микрофон + GPS.
 * ------------------------------------------------------------------
 *
 * Что делает плата:
 *   1. пишет звук с микрофона на 16 кГц кадрами по 1024 отсчёта (64 мс);
 *   2. считает БПФ и вытаскивает из кадра 6 чисел + 16 полос спектра;
 *   3. САМА решает, что это за звук, и опасен ли он:
 *        безопасно — природа (листва, ветер, вода), птицы и звери, тишина;
 *        опасно    — лай собаки, машина, бензопила, выстрел;
 *      и показывает это встроенным светодиодом: зелёный / красный;
 *   4. печатает признаки и вердикт одной строкой JSON в USB Serial;
 *   5. представляется по имени (ID) и позволяет сайту это имя поменять;
 *   6. читает GPS и раз в две секунды сообщает, где стоит — сайт сам
 *      ставит устройство на карту.
 *
 * Классификатор здесь — точная копия src/lib/audio/classify.ts на сайте:
 * те же признаки, те же веса. Сайт считает вердикт и сам (для микрофона
 * ноутбука и файлов), а вердикт платы показывает рядом. В настоящем лесу
 * по LoRa уйдёт именно вердикт платы — несколько байт.
 *
 * ID хранится во флеше платы. Прошивать под каждую точку не нужно: на сайте
 * открываете устройство → «Записать ID в плату», и плата с тех пор сама
 * находит своё место на карте на любом ноутбуке.
 *
 * Если правите пороги — правьте в обоих местах, иначе плата и сайт
 * разойдутся во мнениях. Страница /selftest проверяет версию сайта.
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
 *   {"id":"QRG-001","rms":-52.3,...,"top":"nature","conf":87,"danger":false,"bands":[...]}
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

#define FW_VERSION  "1.4"
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
static int      dangerStreak = 0;     // подряд кадров с опасным вердиктом
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
static float computeHarmonic(const float *x, int n) {
  int minLag = SAMPLE_RATE / 600;
  int maxLag = SAMPLE_RATE / 60;
  if (maxLag > n / 2) maxLag = n / 2;
  if (maxLag <= minLag) return 0.0f;

  float mean = 0.0f;
  for (int i = 0; i < n; i++) mean += x[i];
  mean /= (float)n;

  float energy = 0.0f;
  for (int i = 0; i < n; i++) {
    float v = x[i] - mean;
    energy += v * v;
  }
  if (energy <= 1e-9f) return 0.0f;

  float best = 0.0f;
  for (int lag = minLag; lag <= maxLag; lag += 2) {
    float acc = 0.0f, norm = 0.0f;
    for (int i = 0; i + lag < n; i++) {
      float a = x[i] - mean;
      acc += a * (x[i + lag] - mean);
      norm += a * a;
    }
    if (norm <= 1e-9f) continue;
    float r = acc / norm;
    if (r > best) best = r;
  }
  return clamp01(best);
}

/** Спектральная плоскостность: 1 — белый шум, 0 — чистый тон. */
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

// ──────────────────────── Классификатор ───────────────────────────
// Копия src/lib/audio/classify.ts. Каждый класс — взвешенное среднее
// нескольких признаков, затем softmax. Никаких нейросетей: каждый вердикт
// можно объяснить тем, какой признак его вытянул.

enum { CLS_NATURE, CLS_ANIMAL, CLS_DOG, CLS_VEHICLE, CLS_CHAINSAW, CLS_GUNSHOT, CLS_OTHER, CLS_COUNT };
static const char *CLS_NAME[CLS_COUNT]  = {"nature", "animal", "dog", "vehicle", "chainsaw", "gunshot", "other"};
static const bool  CLS_DANGER[CLS_COUNT] = {false, false, true, true, true, true, false};

static const float CLS_SILENCE_DB  = -58.0f;   // тише — это фон, а не событие
static const float CLS_TEMPERATURE = 0.15f;    // softmax: меньше — решительнее
static const int   CLS_ALERT_PCT   = 40;       // уверенность, с которой опасный класс — тревога
static const uint32_t DANGER_HOLD_MS = 8000;   // выстрел длится 200 мс; красный держим дольше

/** Сумма полос [from, to) — доля энергии в этом диапазоне, 0..1. */
static float bandSum(int from, int to) {
  float sum = 0.0f;
  for (int i = from; i < to && i < BAND_COUNT; i++) sum += bands[i];
  return clamp01(sum);
}

/** 1 в точке mu, спадает за sigma. Для признаков, которые должны быть «посередине». */
static float gaussf(float x, float mu, float sigma) {
  float d = (x - mu) / sigma;
  return expf(-0.5f * d * d);
}

/** Взвешенное среднее clamp01(v[i]) с весами w[i]. */
static float wavg(const float *w, const float *v, int n) {
  float sum = 0.0f, total = 0.0f;
  for (int i = 0; i < n; i++) { sum += w[i] * clamp01(v[i]); total += w[i]; }
  return total > 0.0f ? sum / total : 0.0f;
}

static void classifyFrame(float rms, float zcr, float attack, float harmonic,
                          float flatness, float spread) {
  float loud   = clamp01((rms - CLS_SILENCE_DB) / (-12.0f - CLS_SILENCE_DB));
  float rumble = bandSum(0, 4);    //   60 –  204 Гц  гул двигателя
  float body   = bandSum(2, 10);   //  110 – 1277 Гц  бензопила
  float bark   = bandSum(6, 12);   //  376 – 2353 Гц  форманты лая
  float bright = bandSum(10, 16);  // 1277 – 8000 Гц  птицы, шипение, треск

  float score[CLS_COUNT];
  {
    // Природа: ровный широкополосный шум. Признаки шума нарочно «крутые»:
    // бензопила наполовину шум и наполовину тон, мягкое 1-x отдало бы ей треть.
    const float w[] = {3.0f, 3.0f, 2.5f, 1.5f};
    const float v[] = {1.0f - attack, (flatness - 0.4f) / 0.4f, 1.0f - harmonic * 1.5f, spread};
    score[CLS_NATURE] = wavg(w, v, 4);
  }
  {
    const float w[] = {3.0f, 1.5f, 1.5f, 1.0f};
    const float v[] = {bright, 1.0f - flatness, 1.0f - spread, harmonic};
    score[CLS_ANIMAL] = wavg(w, v, 4);
  }
  {
    const float w[] = {3.0f, 1.5f, 2.5f, 1.0f};
    const float v[] = {bark, gaussf(attack, 0.75f, 0.35f), harmonic, gaussf(flatness, 0.3f, 0.25f)};
    score[CLS_DOG] = wavg(w, v, 4);
  }
  {
    const float w[] = {3.5f, 1.5f, 1.5f, 1.0f};
    const float v[] = {rumble, 1.0f - zcr * 5.0f, 1.0f - attack, harmonic};
    score[CLS_VEHICLE] = wavg(w, v, 4);
  }
  {
    const float w[] = {2.5f, 2.0f, 1.5f, 1.5f};
    const float v[] = {body, harmonic, 1.0f - attack, gaussf(spread, 0.72f, 0.22f)};
    score[CLS_CHAINSAW] = wavg(w, v, 4);
  }
  {
    const float w[] = {3.0f, 2.5f, 2.0f, 3.0f, 1.0f};
    const float v[] = {attack, flatness, spread, 1.0f - harmonic, loud};
    score[CLS_GUNSHOT] = wavg(w, v, 5);
  }
  {
    // Постоянный «пол», чтобы никому не приходилось выигрывать по умолчанию,
    // плюс явная награда за тишину.
    const float w[] = {2.2f, 2.5f};
    const float v[] = {0.5f, 1.0f - loud};
    score[CLS_OTHER] = wavg(w, v, 2);
  }

  // Тише порога — это фон. Так и говорим, а не гадаем.
  if (rms < CLS_SILENCE_DB) {
    for (int i = 0; i < CLS_COUNT; i++) score[i] = (i == CLS_OTHER) ? 1.0f : score[i] * 0.25f;
  }

  float maxScore = score[0];
  for (int i = 1; i < CLS_COUNT; i++) if (score[i] > maxScore) maxScore = score[i];

  float e[CLS_COUNT], sum = 0.0f;
  for (int i = 0; i < CLS_COUNT; i++) { e[i] = expf((score[i] - maxScore) / CLS_TEMPERATURE); sum += e[i]; }

  int top = 0;
  for (int i = 1; i < CLS_COUNT; i++) if (e[i] > e[top]) top = i;

  lastTop = top;
  lastConf = (int)lroundf(e[top] / sum * 100.0f);

  // Один кадр — это 64 мс. Выстрел, лай, двигатель тянутся на несколько;
  // один громкий кадр — это щелчок, дверь, птица, начавшая петь посреди
  // кадра. Тревога — только когда два кадра подряд говорят одно и то же
  // (или она уже держится). Сайт применяет то же правило.
  bool vote = CLS_DANGER[top] && lastConf >= CLS_ALERT_PCT;
  dangerStreak = vote ? dangerStreak + 1 : 0;
  lastDanger = vote && (dangerStreak >= 2 || millis() < dangerUntilMs);
  if (lastDanger) dangerUntilMs = millis() + DANGER_HOLD_MS;
}

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

  computeBands();
  float flatness = computeFlatness();
  float spread = computeSpread();

  classifyFrame(rms, zcr, attack, harmonic, flatness, spread);
  updateLed();
  if (!printFrame) return;

  // ── одна строка JSON ──
  char line[512];
  int n = snprintf(line, sizeof(line),
      "{\"id\":\"%s\",\"rms\":%.1f,\"zcr\":%.3f,\"attack\":%.3f,"
      "\"harmonic\":%.3f,\"flatness\":%.3f,\"spread\":%.3f,",
      deviceId, rms, zcr, attack, harmonic, flatness, spread);
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
