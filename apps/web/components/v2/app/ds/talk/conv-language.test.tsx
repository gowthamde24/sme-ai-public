import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";

import { TalkLiveBody } from "./TalkLive";
import type { TalkLive } from "./use-talk-live";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const TALK_PREFIXES = ["dst.", "tv6.talk.", "bv.chat.plan.", "bv.chat.state.", "bv.chat.err.", "bv.end.", "bv.live."];
/** The page's words: the APP language's (the chrome follows the app; only what is said follows the conversation: owner, 14 Nov). */
const pick = (lang: "en" | "te" | "hi" | "kn") => Object.fromEntries(Object.entries(appDict(lang) as Record<string, string>).filter(([k]) => TALK_PREFIXES.some((p) => k.startsWith(p))));

const live = (over: Partial<TalkLive> = {}): TalkLive => ({
  active: true,
  real: true,
  state: "thinking",
  seconds: 12,
  lines: [],
  plan: { what: "28 మందికి కాల్ చెయ్యాలా?", summary: "ఈ రోజు వచ్చిన కొత్త లీడ్స్‌కి కాల్ చేస్తాను.", time: "", hours: "", cost: "₹274.40", people: 28, messages: 0, minutes: 56, channel: "call", when: { date: "2026-11-14", fromMinute: 18 * 60, toMinute: null }, language: "te" },
  answer: null,
  planStatus: "proposed",
  muted: false,
  start: vi.fn(),
  end: vi.fn(),
  toggleMute: vi.fn(),
  decide: vi.fn(),
  ...over,
});

describe("Talk live: the chrome follows the APP language, what is said follows the conversation", () => {
  const TE = pick("te");
  const EN = pick("en");
  it.each(["card", "bar"] as const)("%s, app in Telugu: a calling plan says 'సరే, కాల్ చెయ్యి' and 'మార్చు'; the time is written from the structured `when` in Telugu; the status line says what it is doing in Telugu", (variant) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T05:00:00Z"));
    render(<TalkLiveBody variant={variant} appLang="te" live={live({ step: "looking" })} words={TE} language="తెలుగు" onType={() => undefined} />);
    expect(screen.getByRole("button", { name: "సరే, కాల్ చెయ్యి" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "మార్చు" })).toBeInTheDocument();
    expect(document.querySelector('[data-part="plan-when"]')).toHaveTextContent("ఈ రోజు సాయంత్రం 6 గంటలకి");
    expect(document.querySelector('[data-part="talk-step"]')).toHaveTextContent("మీ రికార్డులు చూస్తున్నాను…");
    expect(document.querySelector('[data-part="talk-plan"]')).toHaveTextContent("₹274.40");
  });

  it.each(["card", "bar"] as const)("%s, app in English with a TELUGU conversation: the plan's own words stay Telugu, every button, label, time phrase and status line is English", (variant) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T05:00:00Z"));
    render(<TalkLiveBody variant={variant} appLang="en" live={live({ step: "looking" })} words={EN} language="తెలుగు" onType={() => undefined} />);
    expect(screen.getByRole("button", { name: "Yes, call them" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(document.querySelector('[data-part="plan-when"]')).toHaveTextContent("today, 6 pm");
    expect(document.querySelector('[data-part="talk-step"]')).toHaveTextContent(EN["dst.step.looking"]);
    expect(document.querySelector('[data-part="talk-plan"]')).toHaveTextContent("28 మందికి కాల్ చెయ్యాలా?"); // said text, as the API sent it
    expect(document.body.textContent).not.toMatch(/సరే, కాల్ చెయ్యి|మార్చు|చూస్తున్నాను/);
  });

  it("a WhatsApp plan says 'సరే, పంపు'; a plan with no channel says the general 'సరే, చెయ్యి'; no `when` draws no time line (app in Telugu)", () => {
    const { rerender } = render(<TalkLiveBody variant="bar" appLang="te" live={live({ plan: { ...live().plan!, channel: "whatsapp", when: null } })} words={TE} language="తెలుగు" onType={() => undefined} />);
    expect(screen.getByRole("button", { name: "సరే, పంపు" })).toBeInTheDocument();
    expect(document.querySelector('[data-part="plan-when"]')).toBeNull();
    rerender(<TalkLiveBody variant="bar" appLang="te" live={live({ plan: { ...live().plan!, channel: null } })} words={TE} language="తెలుగు" onType={() => undefined} />);
    expect(screen.getByRole("button", { name: "సరే, చెయ్యి" })).toBeInTheDocument();
  });

  it("an error code is said in the app's language, one sentence per code (any other code: the general one)", () => {
    const { rerender } = render(<TalkLiveBody variant="bar" appLang="te" live={live({ turnProblem: "action_expired" })} words={TE} language="తెలుగు" onType={() => undefined} />);
    expect(document.querySelector('[data-part="talk-turn-problem"]')).toHaveTextContent(TE["dst.err.expired"]);
    rerender(<TalkLiveBody variant="bar" appLang="te" live={live({ turnProblem: "something_new" })} words={TE} language="తెలుగు" onType={() => undefined} />);
    expect(document.querySelector('[data-part="talk-turn-problem"]')).toHaveTextContent(TE["dst.err.turn"]);
    rerender(<TalkLiveBody variant="bar" appLang="en" live={live({ turnProblem: "action_expired" })} words={EN} language="తెలుగు" onType={() => undefined} />);
    expect(document.querySelector('[data-part="talk-turn-problem"]')).toHaveTextContent(EN["dst.err.expired"]);
  });
});
