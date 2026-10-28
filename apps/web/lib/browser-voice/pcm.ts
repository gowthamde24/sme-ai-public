import { IN_RATE } from "./protocol";

/** The sound the API wants and gives (PCM 16-bit little-endian), and the arithmetic around it. Pure: no browser objects. */

/** One microphone frame (floats -1..1 at the context's own rate) to 16 kHz mono PCM16: the average of the samples that fall into each output sample. */
export function toPcm16At16k(input: Float32Array, inRate: number): ArrayBuffer {
  const ratio = inRate / IN_RATE;
  const n = Math.max(0, Math.floor(input.length / ratio));
  const out = new DataView(new ArrayBuffer(n * 2));
  for (let i = 0; i < n; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.max(from + 1, Math.min(input.length, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = from; j < to; j++) sum += input[j];
    const s = Math.max(-1, Math.min(1, sum / (to - from)));
    out.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out.buffer;
}

/** The API's voice (PCM16 LE bytes) to floats for the speakers. An odd trailing byte is dropped. */
export function fromPcm16(bytes: ArrayBuffer): Float32Array {
  const view = new DataView(bytes);
  const out = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

/** The loudness of a frame (root mean square, 0..1). */
export function level(input: Float32Array): number {
  if (input.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
  return Math.sqrt(sum / input.length);
}
