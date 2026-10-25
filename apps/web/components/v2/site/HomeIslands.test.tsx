import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HeroDemo, type DemoSample } from "./HeroDemo";
import { NaturalCalls } from "./NaturalCalls";
import { PlansPreview, type PlanTab } from "./PlansPreview";
import { Workforce, type WorkerCard } from "./Workforce";

const workers: WorkerCard[] = ["Find leads", "Research", "AI calls", "WhatsApp", "Outcome", "Follow-up"].map((name, i) => ({ n: i + 1, name, desc: `desc ${i + 1}`, act: `act ${i + 1}`, early: i === 2 }));
const wf = { live: "In this example: {name}", list: "The six AI workers", pause: "Pause the example", play: "Play the example", done: "Handed over", next: "Up next", early: "Early access" };
const samples: DemoSample[] = (["te", "hi", "kn", "en"] as const).map((code) => ({ code, label: `Biz ${code}`, shop: `Shop ${code}`, initials: code.toUpperCase(), caller: `Caller ${code}`, info: `info ${code}`, result: `result ${code}`, msgs: ["m1", "m2", "m3", "m4"].map((m) => `${m} ${code}`) }));
const demo = { tabs: "Example conversations", assist: "AI assistant", calling: "AI is calling {name}", note: "Made-up example.", pause: "Pause", play: "Play" };

/** window.matchMedia for the reduced-motion query only. */
function motion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({ matches: reduce && query.includes("prefers-reduced-motion"), media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false, onchange: null })) as typeof window.matchMedia;
}
const current = () => screen.getAllByRole("listitem").findIndex((li) => li.getAttribute("aria-current") === "step");
const selected = (name?: string) => screen.getAllByRole("tab", name ? { name: new RegExp(name) } : undefined).findIndex((t) => t.getAttribute("aria-selected") === "true");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the six AI workers", () => {
  it("lights the next worker every 2.6 seconds, round and round, with aria-current on exactly one; earlier ones are handed over", () => {
    motion(false);
    render(<Workforce workers={workers} words={wf} />);
    expect(current()).toBe(0);
    expect(screen.getByText("In this example: Find leads")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(2600));
    expect(current()).toBe(1);
    expect(screen.getAllByText("Handed over")).toHaveLength(1);
    expect(screen.getAllByText("Up next")).toHaveLength(4);
    act(() => void vi.advanceTimersByTime(2600 * 4));
    expect(current()).toBe(5);
    act(() => void vi.advanceTimersByTime(2600));
    expect(current()).toBe(0);
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });
  it("stops on the pause button and goes on with play", () => {
    motion(false);
    render(<Workforce workers={workers} words={wf} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause the example" }));
    act(() => void vi.advanceTimersByTime(10000));
    expect(current()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Play the example" }));
    act(() => void vi.advanceTimersByTime(2600));
    expect(current()).toBe(1);
  });
  it("with reduced motion nothing moves, nothing is marked and there is no pause button; the six cards are all there", () => {
    motion(true);
    render(<Workforce workers={workers} words={wf} />);
    act(() => void vi.advanceTimersByTime(20000));
    expect(current()).toBe(-1);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    for (const w of workers) expect(screen.getByText(w.desc)).toBeTruthy();
    expect(screen.queryByText("Handed over")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("tags the early-access worker and only that one", () => {
    motion(false);
    render(<Workforce workers={workers} words={wf} />);
    expect(screen.getAllByText("Early access")).toHaveLength(1);
    expect(within(screen.getAllByRole("listitem")[2]).getByText("Early access")).toBeTruthy();
  });
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

describe("natural AI calls", () => {
  const langs = [{ code: "te", label: "తెలుగు" }, { code: "en", label: "English" }];
  const styles = [{ key: "warm", label: "Warm" }, { key: "quick", label: "Quick" }];
  const lines = { te: { warm: "warm te", quick: "quick te" }, en: { warm: "warm en", quick: "quick en" } };
  const draw = () => render(<NaturalCalls langs={langs} styles={styles} lines={lines} words={{ langs: "Language", styles: "Way of talking", who: "Vani · AI assistant", note: "Example lines." }} />);
  it("shows the line for the chosen language and way of talking, in that language, and nothing to play", () => {
    draw();
    expect(screen.getByText(/warm te/).getAttribute("lang")).toBe("te");
    fireEvent.click(screen.getByRole("tab", { name: "English" }));
    fireEvent.click(screen.getByRole("tab", { name: "Quick" }));
    expect(screen.getByText(/quick en/).getAttribute("lang")).toBe("en");
    expect(screen.getByText("Quick", { selector: "span" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector('[data-orb="speak"]')).not.toBeNull();
  });
  it("two tablists, each with arrow keys", () => {
    draw();
    expect(screen.getAllByRole("tablist")).toHaveLength(2);
    const [te, en] = screen.getAllByRole("tab", { name: /తెలుగు|English/ });
    fireEvent.keyDown(te, { key: "ArrowRight" });
    expect(en.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(en);
  });
});

describe("the plans", () => {
  const tabs: PlanTab[] = [
    { key: "main", label: "AI workforce", plans: [{ id: "a", name: "Alpha", features: ["f1", "f2"], cta: "Start", href: "/signup" }, { id: "b", name: "Beta", features: ["f3"], cta: "Start", href: "/signup" }] },
    { key: "calls", label: "AI calling only", plans: [{ id: "c", name: "Gamma", features: ["f4"], cta: "Join", href: "/contact" }] },
  ];
  it("shows the cards of the first tab, 'Price at launch' on each, and the other tab's cards after a tap; no plan is 'most popular'", () => {
    render(<PlansPreview tabs={tabs} label="Type of plan" price="Price at launch" />);
    expect(screen.getAllByText("Price at launch")).toHaveLength(2);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.queryByText("Gamma")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "AI calling only" }));
    expect(screen.getByText("Gamma")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Join" }).getAttribute("href")).toBe("/contact");
    expect(screen.getAllByText("Price at launch")).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/popular|₹/i);
  });
});
