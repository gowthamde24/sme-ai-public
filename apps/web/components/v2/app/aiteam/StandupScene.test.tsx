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
  "aiteam.v4.hear": "Hear the stand-up",
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

class FakeAudio {
  static last: FakeAudio | null = null;
  currentTime = 0;
  duration = 40;
  ontimeupdate: (() => void) | null = null;
  onended: (() => void) | null = null;
  constructor(public src: string) {
    FakeAudio.last = this;
  }
  play = vi.fn(async () => undefined);
  pause = vi.fn();
}
beforeEach(() => {
  vi.stubGlobal("Audio", FakeAudio);
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob([new Uint8Array(8)], { type: "audio/wav" }) })));
});
afterEach(() => {
  cleanup();
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
  it("playing follows the sound: the step changes with it and the word being read is marked", async () => {
    render(scene(standup()));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Hear the stand-up/ })));
    const a = FakeAudio.last!;
    expect(a.play).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Pause/ })).toHaveAttribute("aria-pressed", "true");
    act(() => {
      a.currentTime = 39;
      a.ontimeupdate?.();
    });
    expect(screen.getByText("Everyone is reporting")).toBeInTheDocument();
    expect(document.querySelector("[data-part=words] mark")).not.toBeNull();
    act(() => a.onended?.());
    expect(screen.getByRole("button", { name: /Hear the stand-up/ })).toHaveAttribute("aria-pressed", "false");
  });
  it("no sound: the hear button is off and the page says so; the words are still there", () => {
    render(scene(standup({ audio: null })));
    expect(screen.getByRole("button", { name: /Hear the stand-up/ })).toBeDisabled();
    expect(screen.getByText("No sound for this one.")).toBeInTheDocument();
    expect(document.querySelector("[data-part=words]")?.textContent?.length).toBeGreaterThan(10);
  });
  it("a sound that cannot be fetched says so", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    render(scene(standup()));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Hear the stand-up/ })));
    expect(screen.getByRole("alert")).toHaveTextContent("The sound couldn't play.");
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
