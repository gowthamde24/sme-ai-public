import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VijayaOrb } from "./VijayaOrb";

// jsdom has no canvas: a context that counts what is drawn
const draws = vi.fn();
const gradient = { addColorStop: () => undefined };
const ctx = new Proxy({} as Record<string, unknown>, {
  get: (target, key: string) => (key in target ? target[key] : key === "createRadialGradient" || key === "createLinearGradient" ? () => gradient : key === "clearRect" ? draws : () => undefined),
  set: (target, key: string, value) => ((target[key] = value), true),
});
let raf: FrameRequestCallback[] = [];

beforeEach(() => {
  draws.mockClear();
  raf = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => (raf.push(f), raf.length));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Vijaya's orb", () => {
  it("is one decorative canvas that says its state, and fills its parent (or has a wrapper of its own size)", () => {
    const a = render(<VijayaOrb state="thinking" />).container;
    const canvas = a.querySelector("canvas")!;
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(canvas.getAttribute("data-vijaya")).toBe("thinking");
    expect(canvas.hasAttribute("style")).toBe(false);
    const b = render(<VijayaOrb size={60} />).container;
    expect((b.querySelector("canvas")!.parentElement as HTMLElement).style.width).toBe("60px");
  });
  it("draws a frame at once and keeps drawing while it plays", () => {
    render(<VijayaOrb state="speaking" />);
    expect(draws).toHaveBeenCalledTimes(1);
    raf.shift()!(performance.now() + 100);
    expect(draws).toHaveBeenCalledTimes(2);
  });
  it("stands still (one frame, no loop) when it is `still` or the visitor asked for less motion", () => {
    render(<VijayaOrb still />);
    expect(draws).toHaveBeenCalledTimes(1);
    expect(raf).toHaveLength(0);
    cleanup();
    draws.mockClear();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
    render(<VijayaOrb state="speaking" />);
    expect(draws).toHaveBeenCalledTimes(1);
    expect(raf).toHaveLength(0);
  });
  it("reads the loudness from an analyser while listening", () => {
    const getByteTimeDomainData = vi.fn((a: Uint8Array) => a.fill(200));
    render(<VijayaOrb state="listening" analyser={{ getByteTimeDomainData } as unknown as AnalyserNode} />);
    expect(getByteTimeDomainData).toHaveBeenCalled();
  });
  it("does not fail where a canvas cannot be drawn", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(() => render(<VijayaOrb />)).not.toThrow();
  });
});
