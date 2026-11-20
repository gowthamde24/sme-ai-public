import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AskBox, type AskJob } from "./AskBox";

const jobs: AskJob[] = [
  { chip: "Book site visits", who: "New property enquiries", says: "Can you visit this Saturday?", when: "Right away", keys: ["site visit"] },
  { chip: "Order ready", who: "Customers whose order is ready", says: "Your order is ready.", when: "As soon as it is ready", keys: ["order"] },
];
const words = { label: "Tell it", placeholder: "e.g.", go: "Set this up", orb: "Play an example", eg: "Example", who: "Who", says: "What it says", when: "When", cost: "Cost", costValue: "Calls are charged at your plan's rate", plan: "Plan" };
const mount = () => render(<AskBox words={words} jobs={jobs} href="/signup" arrow={null} />);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("try-it: still until the visitor acts (no AI, nothing sent)", () => {
  it("shows the first example and its whole card from the start (nothing moves by itself)", () => {
    const { container } = mount();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Book site visits");
    expect(container.querySelectorAll(".h3-plan-row[data-in]")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Book site visits" })).toHaveAttribute("aria-pressed", "true");
    act(() => void vi.advanceTimersByTime(5000));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Book site visits");
  });
  it("tapping a chip types its example in (about 1.2 s) and brings the four lines in one by one", () => {
    const { container } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Order ready" }));
    act(() => void vi.advanceTimersByTime(600));
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.value.length).toBeGreaterThan(0);
    expect(box.value.length).toBeLessThan("Order ready".length);
    act(() => void vi.advanceTimersByTime(4000));
    expect(box.value).toBe("Order ready");
    expect(container.querySelectorAll(".h3-plan-row[data-in]")).toHaveLength(4);
    expect(container.textContent).toContain("Customers whose order is ready");
  });
  it("reduced motion: a chip's sentence just appears", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { container } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Order ready" }));
    act(() => void vi.advanceTimersByTime(10));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Order ready");
    expect(container.querySelectorAll(".h3-plan-row[data-in]")).toHaveLength(4);
  });
  it("the orb plays a scripted example: a pulse with the word Example (never Listening), then the NEXT sentence types in and its card fills; no microphone, no network", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { container } = mount();
    const orb = screen.getByRole("button", { name: "Play an example" });
    expect(orb).toHaveAttribute("title", "Play an example");
    expect(screen.queryByText(/Listening/)).toBeNull();
    fireEvent.click(orb);
    expect(screen.getByText("Example")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(1300 + 1300));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Order ready");
    expect(screen.queryByText("Example")).toBeNull();
    act(() => void vi.advanceTimersByTime(3000));
    expect(container.querySelectorAll(".h3-plan-row[data-in]")).toHaveLength(4);
    expect(container.textContent).toContain("Customers whose order is ready");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("orb with reduced motion: no pulse, the sentence just appears", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { container } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Play an example" }));
    act(() => void vi.advanceTimersByTime(10));
    expect(screen.queryByText("Example")).toBeNull();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Order ready");
    expect(container.querySelectorAll(".h3-plan-row[data-in]")).toHaveLength(4);
  });
  it("typing your own words picks a sample card by keyword and sends nothing", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { container } = mount();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "tell people the order is ready" } });
    expect(container.querySelectorAll(".h3-plan-row[data-in]")).toHaveLength(4);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
