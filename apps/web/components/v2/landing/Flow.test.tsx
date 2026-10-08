import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Flow } from "@/components/v2/landing/Flow";
import { buildFlowLabels } from "@/components/v2/landing/flow-labels";
import { PHASE_MS, SLIDE_MS, TOUCH_PAUSE_MS } from "@/components/v2/landing/motion";
import { landingT } from "@/i18n/landing";

const labels = buildFlowLabels(landingT("en"));
const media = (reduced: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: /reduce/.test(q) ? reduced : false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
};
const strip = (c: HTMLElement) => c.querySelector('[data-mode="strip"]') as HTMLElement;
const swipe = (c: HTMLElement) => c.querySelector('[data-mode="swipe"]') as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  HTMLElement.prototype.scrollTo = vi.fn() as unknown as typeof HTMLElement.prototype.scrollTo;
  media(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the hero flow", () => {
  it("renders both layouts (CSS picks one), each with the six steps and the example label", () => {
    const { container } = render(<Flow labels={labels} />);
    expect(strip(container)).toBeTruthy();
    expect(swipe(container)).toBeTruthy();
    for (const el of [strip(container), swipe(container)]) {
      expect(within(el).getAllByText(labels.example)).toHaveLength(1);
      for (const s of labels.steps) expect(within(el).getAllByText(s).length).toBeGreaterThan(0);
    }
    expect(labels.example).toBe("Example, not real data");
  });
  it("uses no inline style anywhere (every moving part is a class)", () => {
    const { container } = render(<Flow labels={labels} />);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });
  it("starts by itself: the laptop strip moves on after the first phase, no click", () => {
    const { container } = render(<Flow labels={labels} />);
    expect(strip(container).getAttribute("data-phase")).toBe("0");
    expect(strip(container).getAttribute("data-playing")).toBe("true");
    act(() => void vi.advanceTimersByTime(PHASE_MS[0] + 50));
    expect(strip(container).getAttribute("data-phase")).toBe("1");
    expect(strip(container).getAttribute("data-active")).toBe("1");
  });
  it("the pause icon stops it and play resumes it", () => {
    const { container } = render(<Flow labels={labels} />);
    const pause = within(strip(container)).getByRole("button", { name: labels.pause });
    fireEvent.click(pause);
    expect(strip(container).getAttribute("data-playing")).toBe("false");
    act(() => void vi.advanceTimersByTime(PHASE_MS[0] * 3));
    expect(strip(container).getAttribute("data-phase")).toBe("0");
    fireEvent.click(within(strip(container)).getByRole("button", { name: labels.play }));
    expect(strip(container).getAttribute("data-playing")).toBe("true");
  });
  it("the phone row advances by itself, and a touch pauses it for a while, not for ever", () => {
    const { container } = render(<Flow labels={labels} />);
    expect(swipe(container).getAttribute("data-active")).toBe("0");
    act(() => void vi.advanceTimersByTime(SLIDE_MS + 50));
    expect(swipe(container).getAttribute("data-active")).toBe("1");
    fireEvent.touchStart(swipe(container).querySelector("[tabindex='0']")!);
    expect(swipe(container).getAttribute("data-touch-paused")).toBe("true");
    expect(swipe(container).getAttribute("data-playing")).toBe("false");
    act(() => void vi.advanceTimersByTime(TOUCH_PAUSE_MS + 50));
    expect(swipe(container).getAttribute("data-touch-paused")).toBe("false");
  });
  it("under reduced motion it is the static strip: all six steps and cards shown, nothing plays, only a quiet Play motion", () => {
    media(true);
    const { container } = render(<Flow labels={labels} />);
    const s = strip(container);
    expect(s.getAttribute("data-active")).toBe("static");
    expect(s.getAttribute("data-playing")).toBe("false");
    for (let i = 0; i < 6; i++) expect(s.querySelector(`[data-card="${i}"]`)!.className).toContain("opacity-100");
    expect(within(s).queryByRole("button", { name: labels.pause })).toBeNull();
    fireEvent.click(within(s).getByRole("button", { name: labels.motionPlay }));
    expect(s.getAttribute("data-playing")).toBe("true");
    act(() => void vi.advanceTimersByTime(PHASE_MS[0] + 50));
    expect(s.getAttribute("data-phase")).toBe("1");
  });
  it("shows the money-held example only with the example label next to it", () => {
    const { container } = render(<Flow labels={labels} />);
    const money = strip(container).querySelector('[data-card="5"]')!;
    expect(money.textContent).toMatch(/₹7,820\.00/);
    expect(within(strip(container)).getByText(labels.example)).toBeTruthy();
  });
});
