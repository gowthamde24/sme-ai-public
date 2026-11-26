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
});

