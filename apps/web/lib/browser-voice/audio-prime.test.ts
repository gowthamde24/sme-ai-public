import { afterEach, describe, expect, it, vi } from "vitest";

import { browserAudio, primeAudio } from "./audio-io";

afterEach(() => vi.unstubAllGlobals());

describe("primeAudio: the audio context and the microphone are asked for IN the tap (Safari, a phone)", () => {
  it("where there is no audio at all (a test, an old browser) it does nothing and never throws", () => {
    expect(() => primeAudio()).not.toThrow();
  });
  it("it makes and resumes the context and asks for the microphone at once; startMic takes those over instead of asking again", async () => {
    const resume = vi.fn(async () => undefined);
    const ctxs: unknown[] = [];
    class Ctx {
      sampleRate = 48_000;
      destination = {};
      constructor() {
        ctxs.push(this);
      }
      resume = resume;
      close = async () => undefined;
      createMediaStreamSource = () => ({ connect: () => undefined, disconnect: () => undefined });
      createAnalyser = () => ({ fftSize: 0, connect: () => undefined });
      createScriptProcessor = () => ({ connect: () => undefined, disconnect: () => undefined, onaudioprocess: null });
      createGain = () => ({ connect: () => undefined });
    }
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [], getAudioTracks: () => [] }));
    vi.stubGlobal("AudioContext", Ctx);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    primeAudio();
    expect(ctxs).toHaveLength(1);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await browserAudio().startMic(() => undefined);
    expect(ctxs).toHaveLength(1); // no second context
    expect(getUserMedia).toHaveBeenCalledTimes(1); // no second question to the person
  });
  it("a refusal made in the tap reaches startMic (so the bar says the microphone is blocked)", async () => {
    class Ctx {
      resume = async () => undefined;
    }
    vi.stubGlobal("AudioContext", Ctx);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => Promise.reject(new Error("NotAllowedError"))) } });
    primeAudio();
    await expect(browserAudio().startMic(() => undefined)).rejects.toThrow("NotAllowedError");
  });
});
