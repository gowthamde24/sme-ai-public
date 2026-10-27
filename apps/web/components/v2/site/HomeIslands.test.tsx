import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HeroDemo, type DemoSample } from "./HeroDemo";

const samples: DemoSample[] = (["te", "hi", "kn", "en"] as const).map((code) => ({ code, label: `Biz ${code}`, shop: `Shop ${code}`, initials: code.toUpperCase(), caller: `Caller ${code}`, info: `info ${code}`, result: `result ${code}`, msgs: ["m1", "m2", "m3", "m4"].map((m) => `${m} ${code}`) }));
const demo = { tabs: "Example conversations", assist: "AI assistant", calling: "AI is calling {name}", note: "Made-up example.", pause: "Pause", play: "Play" };

/** window.matchMedia for the reduced-motion query only. */
function motion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({ matches: reduce && query.includes("prefers-reduced-motion"), media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false, onchange: null })) as typeof window.matchMedia;
}
const selected = (name?: string) => screen.getAllByRole("tab", name ? { name: new RegExp(name) } : undefined).findIndex((t) => t.getAttribute("aria-selected") === "true");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the hero example", () => {
  const draw = () => render(<HeroDemo samples={samples} words={demo} />);
  it("is a tablist of four tabs with the chat of the chosen one in a tabpanel in that language, and a call card that names the caller", () => {
    motion(false);
    draw();
    expect(screen.getByRole("tablist", { name: "Example conversations" })).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("lang")).toBe("te");
    expect(panel.textContent).toContain("Shop te");
    expect(panel.textContent).toContain("result te");
    expect(screen.getByText("AI is calling Caller te")).toBeTruthy();
    expect(screen.getByText("Made-up example.")).toBeTruthy();
    expect(document.querySelector('[data-orb="speak"]')).not.toBeNull();
  });
  it("moves to the next example every 5 seconds", () => {
    motion(false);
    draw();
    act(() => void vi.advanceTimersByTime(5000));
    expect(selected()).toBe(1);
    expect(screen.getByRole("tabpanel").getAttribute("lang")).toBe("hi");
    act(() => void vi.advanceTimersByTime(5000 * 3));
    expect(selected()).toBe(0);
  });
  it("stops for good when a tab is touched, and the tab chosen stays; the arrow keys, Home and End move between tabs", () => {
    motion(false);
    draw();
    fireEvent.click(screen.getByRole("tab", { name: "Biz kn" }));
    expect(selected()).toBe(2);
    act(() => void vi.advanceTimersByTime(20000));
    expect(selected()).toBe(2);
    const [te, hi, , en] = screen.getAllByRole("tab");
    fireEvent.keyDown(te, { key: "ArrowRight" });
    expect(selected()).toBe(1);
    expect(document.activeElement).toBe(hi);
    fireEvent.keyDown(hi, { key: "End" });
    expect(document.activeElement).toBe(en);
    fireEvent.keyDown(en, { key: "ArrowRight" });
    expect(selected()).toBe(0);
  });
  it("with reduced motion never moves, shows no pause button, and the circle stands still; tapping a tab still works", () => {
    motion(true);
    draw();
    act(() => void vi.advanceTimersByTime(12000));
    expect(selected()).toBe(0);
    expect(screen.queryByRole("button", { name: /Pause|Play/ })).toBeNull();
    expect(document.querySelector('[data-orb="still"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Biz en" }));
    expect(selected()).toBe(3);
  });
});

