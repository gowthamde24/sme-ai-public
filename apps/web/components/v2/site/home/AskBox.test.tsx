import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AskJob } from "./AskBox";

const jobs: AskJob[] = [
  { chip: "Book site visits", who: "New property enquiries", says: "Can you visit this Saturday?", when: "Right away", keys: ["site visit"] },
  { chip: "Order ready", who: "Customers whose order is ready", says: "Your order is ready.", when: "As soon as it is ready", keys: ["order"] },
];
const words = { label: "Tell it", placeholder: "e.g.", go: "Set this up", orb: "Play an example", eg: "Example", who: "Who", says: "What it says", when: "When", cost: "Cost", costValue: "Calls are charged at your plan's rate", plan: "Plan" };
let seeIt: () => void;

// the page's scenes start after the first scroll (use-on-view-once.ts keeps that in the module): a fresh module for each test
let AskBox: typeof import("./AskBox").AskBox;
beforeEach(async () => {
  vi.resetModules();
  ({ AskBox } = await import("./AskBox"));
  vi.useFakeTimers();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: IntersectionObserverCallback) {
        seeIt = () => cb([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("try-it: a live moment played once when seen (no AI, nothing sent)", () => {
  it("is empty before it is seen; then types the first example in about 1.2 s and brings the four lines in one by one", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const { container } = render(<AskBox words={words} jobs={jobs} href="/signup" arrow={null} />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.value).toBe("Book site visits"); // before the first scroll: the final state, as the server drew it
    act(() => void window.dispatchEvent(new Event("scroll")));
    act(() => void vi.advanceTimersByTime(5)); // the visitor scrolled: the block waits empty below the fold
    expect(box.value).toBe("");
    expect(container.querySelectorAll(".h3-plan-row[data-in]")).toHaveLength(0);
    act(() => seeIt());
    act(() => void vi.advanceTimersByTime(600));
    expect(box.value.length).toBeGreaterThan(0);
    expect(box.value.length).toBeLessThan(jobs[0].chip.length);
    act(() => void vi.advanceTimersByTime(700));
    expect(box.value).toBe("Book site visits");
    act(() => void vi.advanceTimersByTime(500));
    expect(container.querySelectorAll(".h3-plan-row[data-in]").length).toBeGreaterThanOrEqual(1);
    act(() => void vi.advanceTimersByTime(2000));
    expect(container.querySelectorAll(".h3-plan-row[data-in]")).toHaveLength(4);
    expect(container.textContent).toContain("Calls are charged at your plan's rate");
  });
  it("tapping a chip afterwards replays it for that chip", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const { container } = render(<AskBox words={words} jobs={jobs} href="/signup" arrow={null} />);
    act(() => void window.dispatchEvent(new Event("scroll")));
    act(() => void vi.advanceTimersByTime(5));
    act(() => seeIt());
    act(() => void vi.advanceTimersByTime(4000));
    fireEvent.click(container.querySelector('[data-chip="2"]')!);
    act(() => void vi.advanceTimersByTime(4000));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Order ready");
    expect(container.textContent).toContain("Customers whose order is ready");
  });
  it("reduced motion (and no script): the final state at once, as the server draws it", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { container } = render(<AskBox words={words} jobs={jobs} href="/signup" arrow={null} />);
    act(() => void vi.advanceTimersByTime(10));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Book site visits");
    expect(container.querySelectorAll(".h3-plan-row[data-in]")).toHaveLength(4);
  });
  it("typing your own words picks a sample card by keyword and sends nothing", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { container } = render(<AskBox words={words} jobs={jobs} href="/signup" arrow={null} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "tell people the order is ready" } });
    expect(container.querySelectorAll(".h3-plan-row[data-in]")).toHaveLength(4);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("the orb plays a scripted example: a pulse with the word Example, then the NEXT sample sentence is typed in and its card fills (no microphone, no network)", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { container } = render(<AskBox words={words} jobs={jobs} href="/signup" arrow={null} />);
    const orb = screen.getByRole("button", { name: "Play an example" });
    expect(orb).toHaveAttribute("title", "Play an example");
    expect(screen.queryByText("Listening…")).toBeNull();
    fireEvent.click(orb);
    expect(screen.getByText("Example")).toBeInTheDocument(); // the pulse's label (never "Listening")
    act(() => void vi.advanceTimersByTime(1300 + 1300));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Order ready"); // the next example (after the first)
    expect(screen.queryByText("Example")).toBeNull();
    act(() => void vi.advanceTimersByTime(3000));
    expect(container.querySelectorAll(".h3-plan-row[data-in]")).toHaveLength(4);
    expect(container.textContent).toContain("Customers whose order is ready");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("orb with reduced motion: no pulse, the sentence just appears", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { container } = render(<AskBox words={words} jobs={jobs} href="/signup" arrow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Play an example" }));
    act(() => void vi.advanceTimersByTime(10));
    expect(screen.queryByText("Example")).toBeNull();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Order ready");
    expect(container.querySelectorAll(".h3-plan-row[data-in]")).toHaveLength(4);
  });
});
