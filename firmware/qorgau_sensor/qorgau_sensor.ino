/*
 * Qorgau — акустический датчик на ESP32-S3 + микрофон INMP441 (I2S).
 * ------------------------------------------------------------------
 *
 * Что делает плата:
 *   1. пишет звук с микрофона на 16 кГц кадрами по 1024 отсчёта (64 мс);
 *   2. считает БПФ и вытаскивает из кадра 6 чисел + 16 полос спектра;
 *   3. печатает всё это одной строкой JSON в USB Serial.
 *
 * Что делает САЙТ: решает, что это за звук. Плата ничего не классифицирует —
 * она только слушает и описывает. Поэтому логику распознавания можно менять
 * в браузере, не перепрошивая плату.
 *
 * ВАЖНО про Arduino UNO: подключить к нему INMP441 нельзя. У ATmega328P нет
 * блока I2S, всего 2 КБ ОЗУ и 16 МГц — БПФ на 512 точек туда не поместится.
 * Микрофон работает только с ESP32-S3.
 *
 * ── Распиновка (INMP441 → ESP32-S3) ────────────────────────────────
 *      VDD  → 3V3            SCK (BCLK) → GPIO4
 *      GND  → GND            WS  (LRCL) → GPIO5
 *      L/R  → GND            SD  (DOUT) → GPIO6
 *   L/R на землю = левый канал, именно его мы и читаем.
 *   Если у вас распаяно иначе — поменяйте три строки PIN_* ниже.
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
 *   «ESP32 по USB» и выберите тот же порт.
 *   ВНИМАНИЕ: Монитор порта надо ЗАКРЫТЬ перед подключением из браузера —
 *   COM-порт может держать только одна программа.
 */

#include <math.h>

// ─────────────────────────── Настройки ───────────────────────────

#define DEVICE_ID   "QRG-001"   // за какое устройство отчитывается плата
#define PIN_BCLK    4           // SCK на модуле INMP441
#define PIN_LRCL    5           // WS
#define PIN_DOUT    6           // SD

#define SAMPLE_RATE 16000
#define FRAME_LEN   1024        // 64 мс — столько же берёт браузер
#define FFT_SIZE    512
#define BAND_COUNT  16
#define BAND_LOW_HZ 60.0f
#define BAND_HI_HZ  8000.0f

// Wi-Fi вместо USB. По умолчанию выключено: на школьной сети устройства
// часто изолированы друг от друга и до ноутбука пакет просто не дойдёт.
#define USE_WIFI 0
#if USE_WIFI
  #define WIFI_SSID "имя_сети"
  #define WIFI_PASS "пароль"
  #define SERVER_URL "http://192.168.0.10:3100/api/ingest"  // IP ноутбука
  #include <WiFi.h>
  #include <HTTPClient.h>
#endif

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

static int32_t rawBuf[FRAME_LEN];      // сырые 32-битные слова из I2S
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
#if QORGAU_NEW_I2S
  // Ядро 3.x: setPins(bclk, ws, dout, din, mclk)
  i2s.setPins(PIN_BCLK, PIN_LRCL, -1, PIN_DOUT, -1);
  return i2s.begin(I2S_MODE_STD, SAMPLE_RATE,
                   I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO);
#else
  i2s_config_t cfg = {};
  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
  cfg.sample_rate = SAMPLE_RATE;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;
  cfg.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;   // L/R модуля посажен на GND
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

/** Читает ровно FRAME_LEN отсчётов и раскладывает их в frame[] как -1..1. */
static bool readFrame() {
  const size_t want = FRAME_LEN * sizeof(int32_t);
  size_t got = 0;

#if QORGAU_NEW_I2S
  got = i2s.readBytes((char *)rawBuf, want);
#else
  if (i2s_read(I2S_NUM_0, rawBuf, want, &got, portMAX_DELAY) != ESP_OK) return false;
#endif

  if (got < want) return false;

  // INMP441 отдаёт 24 бита, выровненных влево в 32-битном слове.
  // Сдвиг на 8 даёт знаковое 24-битное число, делим на 2^23.
  for (int i = 0; i < FRAME_LEN; i++) {
    frame[i] = (float)(rawBuf[i] >> 8) / 8388608.0f;
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
static void micSelfTest() {
  Serial.println("--- Qorgau: проверка микрофона (1 сек) ---");

  float minDb = 1e9f, maxDb = -1e9f;
  int32_t rawMin = INT32_MAX, rawMax = INT32_MIN;
  int frames = 0;

  for (int i = 0; i < 15; i++) {
    if (!readFrame()) continue;
    frames++;
    for (int k = 0; k < FRAME_LEN; k++) {
      if (rawBuf[k] < rawMin) rawMin = rawBuf[k];
      if (rawBuf[k] > rawMax) rawMax = rawBuf[k];
    }
    float db = toDb(computeRms(frame, FRAME_LEN));
    if (db < minDb) minDb = db;
    if (db > maxDb) maxDb = db;
  }

  Serial.printf("пины: BCLK=%d  WS=%d  SD=%d\n", PIN_BCLK, PIN_LRCL, PIN_DOUT);

  if (frames == 0) {
    Serial.println("ОШИБКА: I2S не отдал ни одного кадра.");
    Serial.println("  Проверьте BCLK и WS — без тактов микрофон молчит.");
  } else if (rawMin == rawMax) {
    Serial.printf("ОШИБКА: линия SD залипла на одном значении (%ld).\n", (long)rawMin);
    Serial.println("  Проверьте SD/DOUT и питание VDD=3V3. Землю не забыли?");
  } else if (maxDb < -85.0f) {
    Serial.printf("ОШИБКА: данные идут, но уровень на нуле (%.0f дБ).\n", maxDb);
    Serial.println("  Чаще всего это L/R: он должен быть посажен на GND.");
  } else {
    Serial.printf("OK: микрофон работает. Уровень %.0f...%.0f дБ.\n", minDb, maxDb);
    Serial.println("  Похлопайте — верхняя цифра должна подскочить к -20 дБ.");
  }
  Serial.println("------------------------------------------");
}

void setup() {
  Serial.begin(115200);
  delay(300);

  setupTables();

  if (!setupI2S()) {
    // Не молчим: без этого «нет данных» и «нет микрофона» выглядят одинаково.
    while (true) {
      Serial.println("{\"error\":\"I2S не запустился — проверьте распиновку INMP441\"}");
      delay(2000);
    }
  }

  micSelfTest();

#if USE_WIFI
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
#endif
}

void loop() {
  if (!readFrame()) return;

  // ── громкость и резкость нарастания ──
  float rms = toDb(computeRms(frame, FRAME_LEN));

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

  // ── одна строка JSON ──
  char line[512];
  int n = snprintf(line, sizeof(line),
      "{\"id\":\"%s\",\"rms\":%.1f,\"zcr\":%.3f,\"attack\":%.3f,"
      "\"harmonic\":%.3f,\"flatness\":%.3f,\"spread\":%.3f,\"bands\":[",
      DEVICE_ID, rms, zcr, attack, harmonic, flatness, spread);

  for (int b = 0; b < BAND_COUNT && n < (int)sizeof(line) - 12; b++) {
    n += snprintf(line + n, sizeof(line) - n, "%s%.4f", b ? "," : "", bands[b]);
  }
  snprintf(line + n, sizeof(line) - n, "]}");

  Serial.println(line);

#if USE_WIFI
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(SERVER_URL);
    http.addHeader("Content-Type", "application/json");
    http.POST((uint8_t *)line, strlen(line));
    http.end();
  }
#endif
}
