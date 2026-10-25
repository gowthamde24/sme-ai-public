import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { MOCK_CALL } from "@/lib/calls/mock";

import { LiveCall } from "./LiveCall";
import { LiveNowCard } from "./LiveNowCard";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("call.")));
const call = { ...MOCK_CALL, langName: "తెలుగు" };
const draw = () => render(<LiveCall words={words} call={call} backHref="/app/tenants/t" testMode />);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the live call screen (Call.dc.html)", () => {
  it("shows the way back, the clock counting up, the big circle speaking, the name, the kind and language, and ONE caption line in its own language", () => {
    draw();
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/app/tenants/t");
    expect(screen.getByText("● Live · 01:12")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(3000));
    expect(screen.getByText("● Live · 01:15")).toBeInTheDocument();
    expect(document.querySelector('[data-orb="speak"]')).not.toBeNull();
    expect(document.querySelector(".orb-halo")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ravi Kumar");
    expect(screen.getByText(/Follow-up · తెలుగు/)).toBeInTheDocument();
    const caption = document.querySelector('[data-part="caption"]')!;
    expect(caption.getAttribute("lang")).toBe("te");
    expect(caption.textContent).toContain(MOCK_CALL.caption);
    expect(screen.getByRole("button", { name: "Take over the call" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End call" })).toBeInTheDocument();
  });
  it("says it is a pretend call in test mode", () => {
    draw();
    expect(screen.getByRole("note")).toHaveTextContent("Test mode: this is a pretend call. Nobody is called.");
  });
  it("keeps the transcript behind a link, and shows it in the language of the call", () => {
    draw();
    expect(document.querySelector('[data-part="transcript"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show full transcript" }));
    const lines = document.querySelectorAll('[data-part="transcript"] li');
    expect(lines).toHaveLength(MOCK_CALL.transcript.length);
    expect(lines[0].textContent).toContain("AI assistant");
    expect(lines[1].textContent).toContain("Customer");
    fireEvent.click(screen.getByRole("button", { name: "Hide transcript" }));
    expect(document.querySelector('[data-part="transcript"]')).toBeNull();
  });
  it("taking over stops the AI and says so; the circle stands still", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Take over the call" }));
    expect(screen.getByRole("status")).toHaveTextContent("You have the call now. The AI has stopped talking.");
    expect(document.querySelector('[data-orb="still"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Take over the call" })).toBeNull();
    expect(screen.getByRole("button", { name: "End call" })).toBeInTheDocument();
  });
  it("ending the call says so, stops the clock and leaves a way back", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "End call" }));
    expect(screen.getByRole("status")).toHaveTextContent("The call has ended.");
    act(() => void vi.advanceTimersByTime(10000));
    expect(screen.getByText("ended · 01:12")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Back" })).toHaveLength(2);
  });
  it("has every word in all four languages", () => {
    for (const lang of ["te", "hi", "kn"] as const) {
      const w = appDict(lang) as Record<string, string>;
      for (const k of Object.keys(words)) expect(w[k], `${lang}:${k}`).toBeTruthy();
    }
  });
});

describe("Live now on Today", () => {
  it("names who is called, with the circle speaking and a link to listen", () => {
    render(<LiveNowCard words={words} callee="Ravi Kumar" info="Follow-up · తెలుగు" href="/app/tenants/t/call-list/live" />);
    expect(screen.getByRole("heading", { name: "Calling Ravi Kumar" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Listen" })).toHaveAttribute("href", "/app/tenants/t/call-list/live");
    expect(document.querySelector('[data-orb="speak"]')).not.toBeNull();
  });
});
