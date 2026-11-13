import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";

import { SCRIPTS, pieces } from "./script";
import { TalkLiveBody } from "./TalkLive";
import { clock, useTalkLive } from "./use-talk-live";

const dict = appDict("en") as Record<string, string>;
const WORDS = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("dst.")));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the key pieces of a line", () => {
  it("colours ₹ amounts, clock times, 'about N minutes' and counts, in order, and loses nothing", () => {
    const text = "Found 14 people. I will call between 10 am and 5 pm for about ₹1,800, in about 40 minutes.";
    const ps = pieces(text);
    expect(ps.map((p) => p.text).join("")).toBe(text);
    expect(ps.filter((p) => p.key).map((p) => p.text)).toEqual(["14", "10 am", "5 pm", "₹1,800", "about 40 minutes"]);
  });
  it("a line with no number is one plain piece", () => {
    expect(pieces("Hello there")).toEqual([{ text: "Hello there", key: false }]);
  });
});

describe("the mock conversation (voice is mocked on staging)", () => {
  it("clock formats seconds", () => {
    expect([0, 5, 65, 600].map(clock)).toEqual(["0:00", "0:05", "1:05", "10:00"]);
  });

  it("plays the script: states, lines in order, then the plan card waits for the owner; nothing runs before start()", () => {
    const { result } = renderHook(() => useTalkLive("command"));
    expect(result.current.active).toBe(false);
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.lines).toEqual([]);
    act(() => result.current.start());
    expect(result.current.active).toBe(true);
    expect(result.current.state).toBe("listening");
    act(() => vi.advanceTimersByTime(1300));
    expect(result.current.lines.map((l) => l.who)).toEqual(["owner"]);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.state).toBe("speaking");
    expect(result.current.lines.map((l) => l.who)).toEqual(["owner", "assistant"]);
    expect(result.current.plan).toBeNull();
    act(() => vi.advanceTimersByTime(3200));
    expect(result.current.plan).toEqual(SCRIPTS.command.find((s) => s.kind === "plan" && "plan" in s && s.plan)?.kind === "plan" ? (SCRIPTS.command.find((s) => s.kind === "plan") as { plan: unknown }).plan : null);
    expect(result.current.answer).toBeNull();
    act(() => result.current.decide("yes"));
    expect(result.current.answer).toBe("yes");
    expect(result.current.seconds).toBeGreaterThanOrEqual(6);
  });

  it("End returns everything to normal and stops the timers; muting hides the owner's later lines only", () => {
    const { result, unmount } = renderHook(() => useTalkLive("practice"));
    act(() => result.current.start());
    act(() => result.current.toggleMute());
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.muted).toBe(true);
    expect(result.current.lines.map((l) => l.who)).toEqual(["assistant"]);
    act(() => result.current.end());
    expect(result.current).toMatchObject({ active: false, seconds: 0, lines: [], plan: null, muted: false });
    act(() => vi.advanceTimersByTime(20_000));
    expect(result.current.lines).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it("leaves no timer behind when the page goes away", () => {
    const { result, unmount } = renderHook(() => useTalkLive("setup"));
    act(() => result.current.start());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the live bar", () => {
  function Harness({ onType = () => undefined }: { onType?: () => void }) {
    const live = useTalkLive("command");
    return (
      <>
        <button type="button" onClick={live.start}>
          begin
        </button>
        {live.active ? <TalkLiveBody live={live} words={WORDS} language="తెలుగు" onType={onType} /> : null}
      </>
    );
  }

  it("shows the label, a red timer, the transcript, the plan card with its two buttons, and the controls", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("begin"));
    expect(document.querySelector('[data-part="talk-label"]')).toHaveTextContent("LIVE WITH YOUR ASSISTANT · LISTENING");
    expect(document.querySelector('[data-part="talk-timer"]')).toHaveTextContent("0:00");
    act(() => vi.advanceTimersByTime(6400));
    expect(document.querySelector('[data-part="talk-label"]')).toHaveTextContent("LISTENING");
    expect(document.querySelector('[data-who="assistant"]')).toHaveTextContent("Found 14 people");
    expect(document.querySelector('[data-who="assistant"] mark')).toHaveTextContent("14");
    const plan = document.querySelector('[data-part="talk-plan"]') as HTMLElement;
    expect(plan).toHaveTextContent("Call 14 people about wedding sarees");
    expect(plan).toHaveTextContent("10 am to 5 pm");
    fireEvent.click(screen.getByRole("button", { name: "Yes, start" }));
    expect(screen.getByRole("status")).toHaveTextContent("Nothing was called");
    expect(screen.getByText("Just talk. Interrupt any time.")).toBeInTheDocument();
    expect(screen.getByText("Test conversation: made up. Nothing is called or sent.")).toBeInTheDocument();
  });

  it("Mute toggles, Type calls out, End closes the bar", () => {
    const onType = vi.fn();
    render(<Harness onType={onType} />);
    fireEvent.click(screen.getByText("begin"));
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(screen.getByRole("button", { name: "Unmute" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    expect(onType).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    expect(document.querySelector('[data-part="talk-live"]')).toBeNull();
  });
});
