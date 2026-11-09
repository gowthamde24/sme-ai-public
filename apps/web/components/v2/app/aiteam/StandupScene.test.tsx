import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Standup } from "@/lib/api/ai-team";
import { standupFixture } from "@/lib/api/ai-team-fixtures";
import { parseStandup } from "@/lib/api/ai-team";

import { StandupScene } from "./StandupScene";

const words = {
  "aiteam.v4.scene": "The stand-up",
  "aiteam.v4.scene.alt": "The assistant with its helpers",
  "aiteam.v4.chip.today": "Today, {time}",
  "aiteam.v4.hear": "Read the stand-up",
  "aiteam.v4.everyone": "Everyone",
  "aiteam.v4.reporting": "{name} is reporting",
  "aiteam.v4.step": "{n} of {m}",
  "aiteam.v4.steps": "Report steps",
  "aiteam.v4.step.go": "Go to {name}",
  "aiteam.standup.pause": "Pause",
  "aiteam.standup.made": "Made at {time}",
  "aiteam.standup.seconds": "{seconds} seconds",
  "aiteam.standup.ask": "Ask a follow-up",
  "aiteam.standup.ask.text": "Tell me more about the stand-up of {date}.",
  "aiteam.standup.again": "Make it again ({left} left today)",
  "aiteam.standup.make": "Make it now",
  "aiteam.standup.making": "Making…",
  "aiteam.standup.limit": "No more today.",
  "aiteam.standup.failed": "Couldn't make it.",
  "aiteam.standup.none": "Today's stand-up comes at opening time.",
  "aiteam.standup.none.past": "There was no stand-up that day.",
  "aiteam.standup.noaudio": "No sound for this one.",
  "aiteam.standup.audiofail": "The sound couldn't play.",
  "aiteam.standup.draft": "draft",
  "aiteam.standup.draft.why": "Draft",
};
const names = { caller: "Caller", order_desk: "Order Desk", lead_finder: "Lead Finder", lead_catcher: "Lead Catcher", followups: "Follow-up Desk", quote_writer: "Quote Writer" };
const ORBS = ["lead_catcher", "lead_finder", "caller", "followups", "quote_writer", "order_desk"] as const;
const standup = (o: Partial<Standup> = {}): Standup => ({ ...parseStandup(standupFixture({ date: "2026-11-09", language: "en" })), ...o });
const scene = (s: Standup | null, extra: Partial<React.ComponentProps<typeof StandupScene>> = {}) => (
  <StandupScene base="/app/tenants/t" date="2026-11-09" isToday initial={s} words={words} helperNames={names} orbs={ORBS} remake={null} dayLabel="Mon, 9 November" timeLabel="09:00" {...extra} />
);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the stand-up scene", () => {
  it("names the helper that is reporting, which step of how many, and shows its words", () => {
    render(scene(standup()));
    expect(screen.getByText("Caller is reporting")).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    expect(document.querySelector("[data-part=words]")).toHaveTextContent("Good morning.");
    expect(screen.getByText("Today, 09:00")).toBeInTheDocument();
    for (const h of ORBS) expect(document.querySelector(`[data-orb=${h}]`)).not.toBeNull();
    expect(document.querySelector("[data-orb=caller]")).toHaveAttribute("data-speaking");
  });
  it("the bar steps through the report, and the speaker with it", () => {
    render(scene(standup()));
    fireEvent.click(screen.getByRole("button", { name: "Go to Order Desk" }));
    expect(screen.getByText("Order Desk is reporting")).toBeInTheDocument();
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    expect(document.querySelector("[data-orb=order_desk]")).toHaveAttribute("data-speaking");
    expect(document.querySelector("[data-orb=caller]")).not.toHaveAttribute("data-speaking");
    fireEvent.click(screen.getByRole("button", { name: "Go to Everyone" }));
    expect(screen.getByText("Everyone is reporting")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to Everyone" })).toHaveAttribute("aria-current", "step");
  });
  it("Read the stand-up steps through the words at reading speed: the step changes with it, the word being read is marked, pause keeps the place; nothing is fetched or heard", () => {
    render(scene(standup()));
    fireEvent.click(screen.getByRole("button", { name: /Read the stand-up/ }));
    expect(screen.getByRole("button", { name: /Pause/ })).toHaveAttribute("aria-pressed", "true");
    act(() => void vi.advanceTimersByTime(1500));
    expect(document.querySelector("[data-part=words] mark")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Pause/ }));
    const where = screen.getByText(/is reporting/).textContent;
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.getByText(/is reporting/).textContent).toBe(where); // paused: it stays
    fireEvent.click(screen.getByRole("button", { name: /Read the stand-up/ }));
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByRole("button", { name: /Read the stand-up/ })).toHaveAttribute("aria-pressed", "false"); // the end: back to the start
    expect(screen.getByText("Caller is reporting")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelector("audio")).toBeNull();
  });
  it("picking a step on the bar while reading goes there and stops the reading", () => {
    render(scene(standup()));
    fireEvent.click(screen.getByRole("button", { name: /Read the stand-up/ }));
    fireEvent.click(screen.getByRole("button", { name: "Go to Everyone" }));
    expect(screen.getByText("Everyone is reporting")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Read the stand-up/ })).toHaveAttribute("aria-pressed", "false");
  });
  it("there is always the button to read it, and never a note about sound", () => {
    render(scene(standup({ audio: null })));
    expect(screen.getByRole("button", { name: /Read the stand-up/ })).toBeEnabled();
    expect(screen.queryByText(/sound/i)).toBeNull();
  });

  it("before the stand-up exists it says when it comes; a past day says there was none", () => {
    const { unmount } = render(scene(null, { timeLabel: null }));
    expect(screen.getByText("Today's stand-up comes at opening time.")).toBeInTheDocument();
    expect(document.querySelector("[data-part=steps]")).toBeNull();
    unmount();
    render(scene(null, { isToday: false, timeLabel: null }));
    expect(screen.getByText("There was no stand-up that day.")).toBeInTheDocument();
  });
  it("a past day's chip carries the day, a draft carries the mark, and the follow-up link keeps the date", () => {
    render(scene(standup({ draft: true }), { isToday: false, date: "2026-11-05", dayLabel: "Thu, 5 November" }));
    expect(screen.getByText("Thu, 5 November, 09:00")).toBeInTheDocument();
    expect(document.querySelector("[data-part=draft]")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Ask a follow-up" }).getAttribute("href")).toContain("05%2F11");
  });
  it("Make it again replaces the report and goes back to the first step; at the limit it says so", async () => {
    const next = standup({ lines: [{ text: "Fresh words.", source: "yesterday.calls" }], leftToday: 1 });
    const remake = vi.fn(async () => ({ ok: true as const, standup: next }));
    render(scene(standup({ leftToday: 2 }), { remake }));
    fireEvent.click(screen.getByRole("button", { name: "Go to Everyone" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Make it again \(2 left today\)/ })));
    expect(remake).toHaveBeenCalledWith("2026-11-09");
    expect(document.querySelector("[data-part=words]")).toHaveTextContent("Fresh words.");
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    cleanup();
    render(scene(standup({ leftToday: 0 }), { remake }));
    expect(screen.getByText("No more today.")).toBeInTheDocument();
  });
  it("the helpers are never drawn without their names, and a business with fewer helpers draws fewer orbs", () => {
    render(scene(standup(), { orbs: ["lead_catcher", "caller"] }));
    expect(document.querySelectorAll("[data-orb]").length).toBe(2);
    expect(screen.getAllByText("Caller").length).toBeGreaterThan(0);
  });
});
