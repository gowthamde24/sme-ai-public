import type { AudioIO } from "./client";
import { fromPcm16, level, toPcm16At16k } from "./pcm";
import { OUT_RATE } from "./protocol";

/**
 * The browser's half of "Talk to your assistant": the microphone (echo cancelling and noise suppression on, one channel), cut into 16 kHz PCM16 frames, and a queue that plays the assistant's 24 kHz voice as it arrives and can be emptied at once (barge-in).
 * Made on the person's tap (a phone's audio context only starts after one). A ScriptProcessor takes the frames: an audio worklet would need a script address the page's content-security-policy does not give. CLIENT ONLY.
 */
export function browserAudio(): AudioIO {
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
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctx();
      await ctx.resume();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
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
      const buffer = ctx.createBuffer(1, floats.length, OUT_RATE);
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
