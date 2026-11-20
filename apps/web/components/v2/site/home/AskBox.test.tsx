import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AskBox, type AskJob } from "./AskBox";

const jobs: AskJob[] = [
  { chip: "Book site visits", who: "New property enquiries", says: "Can you visit this Saturday?", when: "Right away", keys: ["site visit"] },
  { chip: "Order ready", who: "Customers whose order is ready", says: "Your order is ready.", when: "As soon as it is ready", keys: ["order"] },
];
const words = { label: "Tell it", placeholder: "e.g.", go: "Set this up", who: "Who", says: "What it says", when: "When", cost: "Cost", costValue: "Calls are charged at your plan's rate", plan: "Plan" };
let seeIt: () => void;

beforeEach(() => {
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
    const { container } = render(<AskBox words={words} jobs={jobs} href="/signup" />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.value).toBe("");
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
    const { container } = render(<AskBox words={words} jobs={jobs} href="/signup" />);
    act(() => seeIt());
    act(() => void vi.advanceTimersByTime(4000));
    fireEvent.click(container.querySelector('[data-chip="2"]')!);
    act(() => void vi.advanceTimersByTime(4000));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Order ready");
    expect(container.textContent).toContain("Customers whose order is ready");
  });
  it("reduced motion: the final state at once", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { container } = render(<AskBox words={words} jobs={jobs} href="/signup" />);
    act(() => seeIt());
    act(() => void vi.advanceTimersByTime(10));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Book site visits");
    expect(container.querySelectorAll(".h3-plan-row[data-in]")).toHaveLength(4);
  });
  it("typing your own words picks a sample card by keyword and sends nothing", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { container } = render(<AskBox words={words} jobs={jobs} href="/signup" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "tell people the order is ready" } });
    expect(container.querySelectorAll(".h3-plan-row[data-in]")).toHaveLength(4);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
