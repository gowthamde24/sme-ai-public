import type { AudioIO } from "./client";
import { fromPcm16, level, toPcm16At16k } from "./pcm";
import { OUT_RATE } from "./protocol";

/**
 * The browser's half of "Talk to your assistant": the microphone (echo cancelling and noise suppression on, one channel), cut into 16 kHz PCM16 frames, and a queue that plays the assistant's 24 kHz voice as it arrives and can be emptied at once (barge-in).
 * Made on the person's tap (a phone's audio context only starts after one). A ScriptProcessor takes the frames: an audio worklet would need a script address the page's content-security-policy does not give. CLIENT ONLY.
 */
type Primed = { ctx: AudioContext; stream: Promise<MediaStream>; at: number };
let primed: Primed | null = null;
const PRIME_FRESH_MS = 20_000;

/**
 * Call this IN the tap that starts Talk live (before anything is awaited): a browser lets the audio context start, and Safari lets the microphone be asked for, only inside a tap, and the live bar is a lazy chunk that mounts a moment AFTER the tap.
 * It makes the audio context, resumes it and asks for the microphone right away; `startMic` takes them over when the bar is ready (once, and only if they are fresh). Never throws: where there is no audio (a test, an old browser) it does nothing and `startMic` asks as before.
 */
export function primeAudio(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx || !navigator.mediaDevices?.getUserMedia) return;
    primed?.stream.then((st) => st.getTracks().forEach((t) => t.stop())).catch(() => undefined); // an earlier, unused one is let go
    const ctx = new Ctx();
    void ctx.resume().catch(() => undefined);
    const stream = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    stream.catch(() => undefined); // the refusal is read by startMic; this one only keeps it from being "unhandled"
    primed = { ctx, stream, at: Date.now() };
  } catch {
    primed = null;
  }
}
const takePrimed = (): Primed | null => {
  const p = primed;
  primed = null;
  return p && Date.now() - p.at < PRIME_FRESH_MS ? p : null;
};

export function browserAudio(outRate: number = OUT_RATE): AudioIO {
  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let micNode: MediaStreamAudioSourceNode | null = null;
  let proc: ScriptProcessorNode | null = null;
  let micAnalyser: AnalyserNode | null = null;
  let voiceGain: GainNode | null = null;
  let voiceAnalyser: AnalyserNode | null = null;
  let nextAt = 0;
  const active = new Set<AudioBufferSourceNode>();

  return {
    async startMic(onFrame) {
      const taken = takePrimed();
      if (taken) {
        ctx = taken.ctx;
        await ctx.resume();
        stream = await taken.stream;
      } else {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new Ctx();
        await ctx.resume();
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      }
      micNode = ctx.createMediaStreamSource(stream);
      micAnalyser = ctx.createAnalyser();
      micAnalyser.fftSize = 512;
      micNode.connect(micAnalyser);
      proc = ctx.createScriptProcessor(2048, 1, 1);
      const rate = ctx.sampleRate;
      proc.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        onFrame(toPcm16At16k(input, rate), level(input));
      };
      micNode.connect(proc);
      proc.connect(ctx.destination); // a processor runs only when it is connected on; it writes silence
      voiceGain = ctx.createGain();
      voiceAnalyser = ctx.createAnalyser();
      voiceAnalyser.fftSize = 512;
      voiceGain.connect(voiceAnalyser);
      voiceAnalyser.connect(ctx.destination);
    },
    mute(on) {
      stream?.getAudioTracks().forEach((t) => (t.enabled = !on)); // a muted track sends silence: the microphone light stays, nothing is heard
    },
    stopMic() {
      proc?.disconnect();
      micNode?.disconnect();
      stream?.getTracks().forEach((t) => t.stop());
      proc = null;
      micNode = null;
      stream = null;
    },
    play(pcm) {
      if (!ctx || !voiceGain) return;
      const floats = fromPcm16(pcm);
      if (floats.length === 0) return;
      const buffer = ctx.createBuffer(1, floats.length, outRate); // the assistant's voice is 24 kHz; a call taken over (app v4) is 16 kHz
      buffer.copyToChannel(floats as Float32Array<ArrayBuffer>, 0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(voiceGain);
      const at = Math.max(ctx.currentTime + 0.02, nextAt);
      src.start(at);
      nextAt = at + buffer.duration;
      active.add(src);
      src.onended = () => active.delete(src);
    },
    flush() {
      for (const src of active) {
        try {
          src.stop();
        } catch {
          /* already ended */
        }
      }
      active.clear();
      nextAt = 0;
    },
    playing: () => active.size > 0,
    close() {
      this.flush();
      this.stopMic();
      void ctx?.close().catch(() => undefined);
      ctx = null;
    },
    analyser: (which) => (which === "mic" ? micAnalyser : voiceAnalyser),
  };
}
