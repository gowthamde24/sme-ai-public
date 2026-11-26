import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";

import { TalkLiveBody } from "./TalkLive";
import type { TalkLive } from "./use-talk-live";

const dict = appDict("en") as Record<string, string>;
const WORDS = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("dst.") || k.startsWith("tv6.talk.")));
const live = (over: Partial<TalkLive> = {}): TalkLive => ({
  active: true,
  state: "speaking",
  seconds: 48,
  lines: [
    { who: "owner", text: "Call everyone who asked about bridal silks, book Saturday visits" },
    { who: "assistant", text: "Sure. This week 11 people asked. I will call them between 10 am and 6 pm." },
  ],
  plan: { what: "Call 11 people · book Saturday visits", time: "about 20 minutes", cost: "about ₹110", hours: "10 am to 8 pm" },
  answer: null,
  muted: false,
  start: vi.fn(),
  end: vi.fn(),
  toggleMute: vi.fn(),
  decide: vi.fn(),
  ...over,
});
afterEach(cleanup);

describe("Talk live inside Today's command bar (variant 'bar', the approved mock)", () => {
  it("draws a red timer and the label (the orb is outside the box), the conversation as a chat (his words on the right, the assistant's on the left, who said it only for screen readers) with the key numbers in orange", () => {
    render(<TalkLiveBody variant="bar" live={live()} words={WORDS} language="తెలుగు" onType={() => undefined} />);
    expect(document.querySelector("[data-orb]")).toBeNull();
    expect(document.querySelector('[data-part="talk-timer"]')).toHaveTextContent("0:48");
    expect(document.querySelector('[data-part="talk-label"]')).toHaveTextContent("LIVE WITH YOUR ASSISTANT · SPEAKING");
    const mine = document.querySelector('[data-who="owner"]') as HTMLElement;
    const theirs = document.querySelector('[data-who="assistant"]') as HTMLElement;
    expect(mine).toHaveClass("items-end"); // the owner's bubble on the right
    expect(theirs).toHaveClass("items-start"); // the assistant's on the left
    expect(mine.querySelector(".sr-only")).toHaveTextContent("You:");
    expect(theirs.querySelector(".sr-only")).toHaveTextContent("Your assistant:");
    expect(screen.queryByText("You", { selector: "small" })).toBeNull(); // no visible YOU / YOUR ASSISTANT label
    expect([...document.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(expect.arrayContaining(["11", "10 am", "6 pm"]));
  });

  it("has an Attach button only when a way to attach is given (a file goes in as a typed message while the call goes on)", () => {
    const onAttach = vi.fn();
    const { unmount } = render(<TalkLiveBody variant="bar" live={live()} words={WORDS} language="తెలుగు" onType={() => undefined} onAttach={onAttach} />);
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    expect(onAttach).toHaveBeenCalledTimes(1);
    unmount();
    render(<TalkLiveBody variant="bar" live={live()} words={WORDS} language="తెలుగు" onType={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Attach" })).toBeNull();
  });

  it("has the plan card inside the bar with Yes, start and Change, then the control row: Just talk, language, Mute, Type, End", () => {
    const l = live();
    const onType = vi.fn();
    render(<TalkLiveBody variant="bar" live={l} words={WORDS} language="తెలుగు" onType={onType} />);
    const plan = document.querySelector('[data-part="talk-plan"]') as HTMLElement;
    expect(plan).toHaveTextContent("Call 11 people · book Saturday visits");
    expect(plan).toHaveTextContent("about 20 minutes · about ₹110 · calling hours 10 am to 8 pm");
    fireEvent.click(screen.getByRole("button", { name: "Yes, start" }));
    expect(l.decide).toHaveBeenCalledWith("yes");
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(l.decide).toHaveBeenCalledWith("change");
    const controls = document.querySelector('[data-part="talk-controls"]') as HTMLElement;
    expect(controls).toHaveTextContent("Just talk. Interrupt any time.");
    expect(document.querySelector('[data-part="talk-language"]')).toHaveTextContent("తెలుగు");
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(l.toggleMute).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    expect(onType).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    expect(l.end).toHaveBeenCalled();
  });

  it("after the owner's answer the plan says what was chosen", () => {
    render(<TalkLiveBody variant="bar" live={live({ answer: "yes" })} words={WORDS} language="English" onType={() => undefined} />);
    expect(document.querySelector('[data-part="talk-answer"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Yes, start" })).toBeNull();
  });

  it("the default (card) look is unchanged", () => {
    render(<TalkLiveBody live={live()} words={WORDS} language="English" onType={() => undefined} />);
    expect(document.querySelector('[data-variant="bar"]')).toBeNull();
    expect(document.querySelector('[data-part="talk-live"]')).toHaveClass("flex-col");
  });

  it("Interrupted is a small tag under the bubble; words still being heard are a lighter, dashed bubble", () => {
    const l = live();
    render(<TalkLiveBody variant="bar" live={{ ...l, lines: [...l.lines, { who: "assistant", text: "The price is", cut: true }, { who: "owner", text: "and the delivery", interim: true }] }} words={{ ...WORDS, "bv.live.interrupted": "Interrupted" }} language="తెలుగు" onType={() => undefined} />);
    expect(document.querySelector('[data-part="interrupted"]')).toHaveTextContent("Interrupted");
    const interim = document.querySelector('[data-interim="true"]') as HTMLElement;
    expect(interim.querySelector("p")).toHaveClass("border-dashed", "opacity-70");
  });

  it("each closed error code of a turn has its own honest sentence (C1, 26 Nov 2026), in all four languages, and 'Nothing was done.' is dropped when the answer already arrived", async () => {
    const { appDict } = await import("@/i18n/app");
    const sentences: Record<string, string> = {
      model_not_configured: "The assistant could not answer just now. Nothing was done.",
      assistant_failed: "The assistant could not answer just now. Nothing was done.",
      model_busy: "The assistant is busy. Try again in a moment.",
      run_limit_reached: "You have reached this hour's limit. Try again later.",
      agents_disabled: "The assistant is switched off for now.",
      token_expiring: "Your sign-in is about to expire. Sign in again.",
      tts_unavailable: "I could not speak that. The answer is shown above.",
    };
    for (const [code, text] of Object.entries(sentences)) {
      const { unmount } = render(<TalkLiveBody variant="bar" live={live({ turnProblem: code, lines: [{ who: "owner", text: "hello" }] })} words={WORDS} language="తెలుగు" onType={() => undefined} />);
      expect(document.querySelector('[data-part="talk-turn-problem"]'), code).toHaveTextContent(text);
      unmount();
    }
    // the answer for this turn already arrived: no "Nothing was done."
    for (const code of ["assistant_failed", "something_new"]) {
      const { unmount } = render(<TalkLiveBody variant="bar" live={live({ turnProblem: code, lines: [{ who: "owner", text: "hello" }, { who: "assistant", text: "Hi" }] })} words={WORDS} language="తెలుగు" onType={() => undefined} />);
      expect(document.querySelector('[data-part="talk-turn-problem"]')?.textContent, code).not.toMatch(/Nothing was done/);
      unmount();
    }
    for (const l of ["te", "hi", "kn"] as const) {
      const d = appDict(l) as Record<string, string>;
      for (const k of ["dst.err.model", "dst.err.model.answered", "dst.err.busy", "dst.err.limit", "dst.err.off", "dst.err.token", "dst.err.tts", "dst.err.turn.answered"]) expect(d[k], `${l} ${k}`).toBeTruthy();
    }
  });
});

