import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HowSteps, type HowStep } from "./HowSteps";
import { LanguageChats, type SampleChat } from "./LanguageChats";

const steps: HowStep[] = ["Answer", "Understand", "Quote", "Follow up", "Collect", "Grow"].map((title, i) => ({ n: String(i + 1), title, text: `${title} text`, you: `You: ${i}` }));
const how = { list: "The six steps", pause: "Pause the steps", play: "Play the steps" };
const chats: SampleChat[] = (["te", "hi", "kn", "en"] as const).map((code) => ({ code, label: code.toUpperCase(), shop: `Shop ${code}`, q: `q ${code}`, a: `a ${code}`, tag: `tag ${code}`, q2: `q2 ${code}` }));
const words = { tabs: "Choose a language", panel: "Sample chat", online: "online", note: "Sample chats.", pause: "Pause the chats", play: "Play the chats" };

/** window.matchMedia for the reduced-motion query only. */
function motion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({ matches: reduce && query.includes("prefers-reduced-motion"), media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false, onchange: null })) as never;
}
const current = () => screen.getAllByRole("listitem").findIndex((li) => li.getAttribute("aria-current") === "step");
const selected = () => screen.getAllByRole("tab").findIndex((t) => t.getAttribute("aria-selected") === "true");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the six steps", () => {
  it("lifts the next step every 2.2 seconds, round and round, with aria-current on exactly one", () => {
    motion(false);
    render(<HowSteps steps={steps} words={how} />);
    expect(current()).toBe(0);
    act(() => void vi.advanceTimersByTime(2200));
    expect(current()).toBe(1);
    act(() => void vi.advanceTimersByTime(2200 * 4));
    expect(current()).toBe(5);
    act(() => void vi.advanceTimersByTime(2200));
    expect(current()).toBe(0);
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });
  it("stops on the pause button and goes on with play", () => {
    motion(false);
    render(<HowSteps steps={steps} words={how} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause the steps" }));
    act(() => void vi.advanceTimersByTime(10000));
    expect(current()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Play the steps" }));
    act(() => void vi.advanceTimersByTime(2200));
    expect(current()).toBe(1);
  });
  it("with reduced motion nothing moves and nothing is marked: all six steps are there and read the same", () => {
    motion(true);
    render(<HowSteps steps={steps} words={how} />);
    act(() => void vi.advanceTimersByTime(20000));
    expect(current()).toBe(-1);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    for (const s of steps) expect(screen.getByText(s.text)).toBeTruthy();
    for (const li of screen.getAllByRole("listitem")) expect(li.className).not.toMatch(/(^|\s)(bg-night|-translate-y-1\.5)/); // the highlight is motion-safe only
  });
});

describe("the sample chats", () => {
  const draw = () => render(<LanguageChats chats={chats} words={words}><h2>Speaks your language</h2></LanguageChats>);
  it("is a tablist of four tabs with the chat of the chosen one in a tabpanel in that language", () => {
    motion(false);
    draw();
    expect(screen.getByRole("tablist", { name: "Choose a language" })).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("lang")).toBe("te");
    expect(panel.textContent).toContain("Shop te");
    expect(screen.getByText("Sample chats.")).toBeTruthy();
    expect(screen.getByText("Speaks your language")).toBeTruthy();
  });
  it("slides to the next language every 4 seconds", () => {
    motion(false);
    draw();
    act(() => void vi.advanceTimersByTime(4000));
    expect(selected()).toBe(1);
    expect(screen.getByRole("tabpanel").getAttribute("lang")).toBe("hi");
    act(() => void vi.advanceTimersByTime(4000 * 3));
    expect(selected()).toBe(0);
  });
  it("stops for good when a tab is touched, and the tab chosen stays", () => {
    motion(false);
    draw();
    fireEvent.click(screen.getByRole("tab", { name: "KN" }));
    expect(selected()).toBe(2);
    act(() => void vi.advanceTimersByTime(20000));
    expect(selected()).toBe(2);
    expect(screen.getByRole("tabpanel").textContent).toContain("Shop kn");
  });
  it("moves with the arrow keys, Home and End (the focus goes with it)", () => {
    motion(false);
    draw();
    const [te, hi, , en] = screen.getAllByRole("tab");
    fireEvent.keyDown(te, { key: "ArrowRight" });
    expect(selected()).toBe(1);
    expect(document.activeElement).toBe(hi);
    fireEvent.keyDown(hi, { key: "End" });
    expect(selected()).toBe(3);
    expect(document.activeElement).toBe(en);
    fireEvent.keyDown(en, { key: "ArrowRight" });
    expect(selected()).toBe(0);
    fireEvent.keyDown(screen.getAllByRole("tab")[0], { key: "ArrowLeft" });
    expect(selected()).toBe(3);
  });
  it("has a pause button, and with reduced motion never slides and shows no pause button", () => {
    motion(false);
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Pause the chats" }));
    act(() => void vi.advanceTimersByTime(12000));
    expect(selected()).toBe(0);
    cleanup();
    motion(true);
    draw();
    act(() => void vi.advanceTimersByTime(12000));
    expect(selected()).toBe(0);
    expect(screen.queryByRole("button", { name: /Pause the chats|Play the chats/ })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "EN" })); // tapping still works
    expect(selected()).toBe(3);
  });
});
