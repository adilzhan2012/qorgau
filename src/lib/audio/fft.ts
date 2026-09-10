/**
 * Radix-2 FFT, small enough to keep in the repo rather than take a dependency.
 * The firmware runs the same algorithm on the ESP32, so any change here has a
 * twin in firmware/qorgau_sensor/qorgau_sensor.ino.
 */

/** Hann window of the given length, cached per size. */
const windowCache = new Map<number, Float32Array>();

export function hannWindow(size: number): Float32Array {
  const cached = windowCache.get(size);
  if (cached) return cached;

  const w = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  windowCache.set(size, w);
  return w;
}

/**
 * In-place iterative Cooley-Tukey. `re`/`im` must be the same power-of-two
 * length. Bit-reversal first, then log2(n) butterfly passes.
 */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) {
    throw new Error(`fft: length must be a power of two, got ${n}`);
  }

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;

        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;

        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/**
 * Magnitude spectrum of a real signal: the first `size / 2` bins, Hann-windowed.
 * `out` is reused across calls to keep the hot path allocation-free.
 */
export function magnitudeSpectrum(
  samples: Float32Array,
  size: number,
  out: Float32Array,
): Float32Array {
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const w = hannWindow(size);
  const n = Math.min(size, samples.length);

  for (let i = 0; i < n; i += 1) re[i] = samples[i] * w[i];

  fft(re, im);

  const half = size >> 1;
  for (let i = 0; i < half; i += 1) {
    out[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }
  return out;
}
