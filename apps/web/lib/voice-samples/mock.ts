import type { SampleQuery } from "./types";

/**
 * The FAKE sample of the test screens (VOICE_SAMPLE_SCREENS=mock): a short two-note sound made here, as a WAV file. It tells the voices apart by their pitch (the female voices higher, the warm tone softer and slower, the crisp one
 * quicker and brighter) and says nothing: it is NOT how the voices sound. Deterministic: the same query is the same bytes. Pure; SERVER ONLY by habit (no browser needs it).
 */
const RATE = 16_000;
const PITCH: Record<SampleQuery["voice"], number> = { female_warm: 330, female_clear: 392, male_calm: 196, male_lively: 247, own_voice: 220 };

export function mockSampleWav(q: SampleQuery): Uint8Array {
  const base = PITCH[q.voice] * (q.tone === "crisp" ? 1.12 : 1);
  const note = q.tone === "crisp" ? 0.28 : 0.45; // seconds each
  const n = Math.round(RATE * note);
  const pcm = new Int16Array(n * 2);
  for (let i = 0; i < pcm.length; i++) {
    const second = i >= n;
    const f = second ? base * 1.25 : base;
    const t = (second ? i - n : i) / RATE;
    const fade = Math.min(1, (second ? i - n : i) / 400, (n - (second ? i - n : i)) / 1200);
    pcm[i] = Math.round(Math.sin(2 * Math.PI * f * t) * 9000 * Math.max(0, fade));
  }
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const v = new DataView(bytes.buffer);
  const tag = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  tag(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  pcm.forEach((s, i) => v.setInt16(44 + i * 2, s, true));
  return bytes;
}
