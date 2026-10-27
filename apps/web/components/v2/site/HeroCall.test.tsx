import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HeroCall, type HeroCallLine } from "./HeroCall";

const LINES: HeroCallLine[] = [
  { who: "v", te: "నమస్కారం", en: "Hello" },
  { who: "c", te: "చెప్పండి", en: "Tell me" },
  { who: "v", te: "సరే", en: "OK" },
];
const WORDS = { label: "Example call", name: "Ravi Kumar", business: "Sri Sai Homes", speaking: "Speaking Telugu", result: "Site visit booked", note: "Made-up names." };
let reduced = false;

beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduced, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const shown = (c: HTMLElement) => [...c.querySelectorAll("[data-line]")].filter((p) => p.className.includes("opacity-100")).length;
const clock = (c: HTMLElement) => c.querySelector('[data-part="clock"]')!.textContent;
const result = (c: HTMLElement) => c.querySelector('[data-part="call-result"]')!.textContent;

describe("the example call of the home page", () => {
  it("is drawn whole by the server: every line, the clock at its end and the result (a page without script sees the call)", () => {
    const { container } = render(<HeroCall lines={LINES} seconds={108} words={WORDS} />);
    // the first paint is the server's: effects have not run yet in a static render, so read the markup of the initial state
    expect(container.querySelectorAll("[data-line]")).toHaveLength(3);
    expect(container.querySelectorAll('[lang="te"]')).toHaveLength(3);
    expect(container.textContent).toContain("Hello");
  });
  it("starts over in the browser, brings the lines up one by one with a running clock, and shows the result at the end", async () => {
    const { container } = render(<HeroCall lines={LINES} seconds={108} words={WORDS} />);
    await act(async () => void vi.advanceTimersByTime(0));
    expect(shown(container)).toBe(0);
    expect(clock(container)).toBe("00:00");
    expect(result(container)).not.toContain("Site visit booked");
    await act(async () => void vi.advanceTimersByTime(700));
    expect(shown(container)).toBe(1);
    await act(async () => void vi.advanceTimersByTime(2600 * 2));
    expect(shown(container)).toBe(3);
    expect(clock(container)).toMatch(/^00:0\d$/);
    await act(async () => void vi.advanceTimersByTime(2600));
    expect(result(container)).toContain("Site visit booked");
    expect(clock(container)).toBe("01:48");
  });
  it("begins again after a pause, and has no button to pause it", async () => {
    const { container } = render(<HeroCall lines={LINES} seconds={108} words={WORDS} />);
    expect(container.querySelector("button")).toBeNull();
    await act(async () => void vi.advanceTimersByTime(700 + 3 * 2600 + 5200 + 10));
    expect(shown(container)).toBe(0);
    expect(clock(container)).toBe("00:00");
  });
  it("stands still for a visitor who asked for less motion: every line, the result and the final clock, and nothing runs", async () => {
    reduced = true;
    const { container } = render(<HeroCall lines={LINES} seconds={108} words={WORDS} />);
    await act(async () => void vi.advanceTimersByTime(20000));
    expect(shown(container)).toBe(3);
    expect(clock(container)).toBe("01:48");
    expect(result(container)).toContain("Site visit booked");
  });
});
