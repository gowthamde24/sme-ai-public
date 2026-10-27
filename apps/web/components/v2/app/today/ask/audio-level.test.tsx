import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setAnalyser, useAnalyser } from "./audio-level";
import { analyserOf, clearAnalyser, makeContext } from "./audio-source";

const fake = () => ({ id: Math.random() }) as unknown as AnalyserNode;
function Probe({ seen }: { seen: (a: AnalyserNode | null) => void }) {
  seen(useAnalyser());
  return null;
}
afterEach(() => {
  cleanup();
  setAnalyser(null);
  vi.unstubAllGlobals();
});

describe("the sound the circle follows", () => {
  it("is none until a sound puts its analyser, and the circles read it as it changes", () => {
    const seen = vi.fn();
    render(<Probe seen={seen} />);
    expect(seen).toHaveBeenLastCalledWith(null);
    const mic = fake();
    act(() => setAnalyser(mic));
    expect(seen).toHaveBeenLastCalledWith(mic);
    act(() => setAnalyser(null));
    expect(seen).toHaveBeenLastCalledWith(null);
  });
  it("a sound takes away only its own analyser: a newer one is kept", () => {
    const seen = vi.fn();
    render(<Probe seen={seen} />);
    const mic = fake();
    const voice = fake();
    act(() => setAnalyser(mic));
    act(() => setAnalyser(voice));
    act(() => clearAnalyser(mic)); // the microphone is released late
    expect(seen).toHaveBeenLastCalledWith(voice);
    act(() => clearAnalyser(voice));
    expect(seen).toHaveBeenLastCalledWith(null);
    act(() => clearAnalyser(null));
  });
  it("makes a small, smooth analyser fed by the source and not played, and no context where the browser has no Web Audio", () => {
    expect(makeContext()).toBeNull(); // jsdom has none
    const analyser = { fftSize: 0, smoothingTimeConstant: 0 };
    const ctx = { createAnalyser: () => analyser } as unknown as AudioContext;
    const source = { connect: vi.fn() } as unknown as AudioNode;
    expect(analyserOf(ctx, source)).toBe(analyser);
    expect(analyser).toMatchObject({ fftSize: 256, smoothingTimeConstant: 0.6 });
    expect(source.connect).toHaveBeenCalledWith(analyser);
    vi.stubGlobal("AudioContext", class {});
    expect(makeContext()).not.toBeNull();
  });
});
