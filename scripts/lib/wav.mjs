/**
 * Чтение WAV без зависимостей: PCM 8/16/24/32-бит и float32, моно или стерео.
 * Всё сводится к одному моно-каналу на 16 кГц — ровно то, что слышит плата.
 */

export function decodeWav(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (read4(view, 0) !== "RIFF" || read4(view, 8) !== "WAVE") {
    throw new Error("это не WAV-файл");
  }

  let format = 1;
  let channels = 1;
  let rate = 16000;
  let bits = 16;
  let data = null;

  // Чанки идут подряд: четыре байта имени, четыре — длины, дальше тело.
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = read4(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = Math.max(1, view.getUint16(body + 2, true));
      rate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === "data") {
      data = { at: body, size: Math.min(size, view.byteLength - body) };
    }
    offset = body + size + (size % 2); // чанки выровнены по чётному байту
  }

  if (!data) throw new Error("в файле нет чанка data");
  return { rate, samples: toMono(view, data, format, channels, bits) };
}

function read4(view, at) {
  return String.fromCharCode(
    view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3),
  );
}

function toMono(view, data, format, channels, bits) {
  const bytes = bits >> 3;
  const total = Math.floor(data.size / bytes);
  const out = new Float32Array(Math.floor(total / channels));

  for (let i = 0; i < out.length; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) {
      sum += sampleAt(view, data.at + ((i * channels + c) * bytes), format, bits);
    }
    out[i] = sum / channels;
  }
  return out;
}

function sampleAt(view, at, format, bits) {
  if (format === 3) return bits === 64 ? view.getFloat64(at, true) : view.getFloat32(at, true);
  if (bits === 8) return (view.getUint8(at) - 128) / 128;
  if (bits === 16) return view.getInt16(at, true) / 32768;
  if (bits === 24) {
    const raw = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16);
    return raw / 8388608;
  }
  if (bits === 32) return view.getInt32(at, true) / 2147483648;
  throw new Error(`не поддерживается: ${bits} бит, формат ${format}`);
}

/** Линейная передискретизация на частоту платы. */
export function resample(samples, from, to) {
  if (from === to) return samples;
  const out = new Float32Array(Math.round((samples.length * to) / from));
  const step = from / to;
  for (let i = 0; i < out.length; i += 1) {
    const at = i * step;
    const left = Math.floor(at);
    const right = Math.min(samples.length - 1, left + 1);
    const frac = at - left;
    out[i] = samples[left] * (1 - frac) + samples[right] * frac;
  }
  return out;
}
