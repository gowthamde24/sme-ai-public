import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { CONV_WORD_SETS } from "@/lib/conversation/word-sets";

import { prefetchConvWords, resetConvWords, useConvWords } from "./conv-words";
import { TalkLiveBody } from "./TalkLive";
import type { TalkLive } from "./use-talk-live";

const BASE = "/app/tenants/22222222-2222-4222-8222-222222222222";
const pick = (lang: "en" | "te" | "hi" | "kn", set: "talk" | "task") => {
  const d = appDict(lang) as Record<string, string>;
  return Object.fromEntries(Object.entries(d).filter(([k]) => CONV_WORD_SETS[set].some((p) => k.startsWith(p))));
};
const EN = { ...pick("en", "talk"), "tv6.cmd.label": "Tell your assistant what to do" }; // the page's words: app language (English) plus the menus
const fetchMock = vi.fn();
beforeEach(() => {
  resetConvWords();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    const q = new URL(url, "http://x");
    const lang = q.searchParams.get("lang") as "te";
    const set = q.searchParams.get("set") as "talk";
    return { ok: true, json: async () => ({ words: pick(lang, set) }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the words of the conversation follow the conversation's language, the app keeps its own", () => {
  it("the app's language: no fetch, the page's words as they are", () => {
    const h = renderHook(() => useConvWords({ base: BASE, code: "en", appLang: "en", words: EN, set: "talk" }));
    expect(h.result.current).toBe(EN);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Telugu in the composer: the Telugu words are fetched from this workspace's route and laid over the app's; the menus' words stay English", async () => {
    const h = renderHook(() => useConvWords({ base: BASE, code: "te", appLang: "en", words: EN, set: "talk" }));
    expect(h.result.current["dst.change"]).toBe("Change"); // until they arrive: the app's words, never empty
    await waitFor(() => expect(h.result.current["dst.change"]).toBe("మార్చు"));
    expect(h.result.current["dst.yes_call"]).toBe("సరే, కాల్ చెయ్యి");
    expect(h.result.current["tv6.cmd.label"]).toBe("Tell your assistant what to do");
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/conv-words?lang=te&set=talk`, { credentials: "same-origin" });
  });

  it("a language with no words yet (ta, ml, mr) reads in English and fetches nothing; a failed fetch keeps the app's words", async () => {
    const h = renderHook(() => useConvWords({ base: BASE, code: "ta", appLang: "en", words: EN, set: "talk" }));
    expect(h.result.current).toBe(EN);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    const k = renderHook(() => useConvWords({ base: BASE, code: "kn", appLang: "en", words: EN, set: "talk" }));
    await act(async () => void (await Promise.resolve()));
    expect(k.result.current["dst.change"]).toBe("Change");
  });

  it("prefetch asks once for each set, and not at all for the app's own language", () => {
    prefetchConvWords(BASE, "hi", "en");
    prefetchConvWords(BASE, "hi", "en");
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([`${BASE}/conv-words?lang=hi&set=talk`, `${BASE}/conv-words?lang=hi&set=task`]);
    prefetchConvWords(BASE, "en", "en");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

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

describe("Talk live drawn in the conversation's words", () => {
  const TE = pick("te", "talk");
  it.each(["card", "bar"] as const)("%s: a calling plan says 'సరే, కాల్ చెయ్యి' and 'మార్చు'; the time is written from the structured `when` ('ఈ రోజు సాయంత్రం 6 గంటలకి'); the status line says what it is doing", (variant) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T05:00:00Z"));
    render(<TalkLiveBody variant={variant} live={live({ step: "looking" })} words={TE} language="తెలుగు" onType={() => undefined} />);
    expect(screen.getByRole("button", { name: "సరే, కాల్ చెయ్యి" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "మార్చు" })).toBeInTheDocument();
    expect(document.querySelector('[data-part="plan-when"]')).toHaveTextContent("ఈ రోజు సాయంత్రం 6 గంటలకి");
    expect(document.querySelector('[data-part="talk-step"]')).toHaveTextContent("మీ రికార్డులు చూస్తున్నాను…");
    expect(document.querySelector('[data-part="talk-plan"]')).toHaveTextContent("₹274.40");
  });

  it("a WhatsApp plan says 'సరే, పంపు'; a plan with no channel says the general 'సరే, చెయ్యి'; no `when` draws no time line", () => {
    const { rerender } = render(<TalkLiveBody variant="bar" live={live({ plan: { ...live().plan!, channel: "whatsapp", when: null } })} words={TE} language="తెలుగు" onType={() => undefined} />);
    expect(screen.getByRole("button", { name: "సరే, పంపు" })).toBeInTheDocument();
    expect(document.querySelector('[data-part="plan-when"]')).toBeNull();
    rerender(<TalkLiveBody variant="bar" live={live({ plan: { ...live().plan!, channel: null } })} words={TE} language="తెలుగు" onType={() => undefined} />);
    expect(screen.getByRole("button", { name: "సరే, చెయ్యి" })).toBeInTheDocument();
  });

  it("an error code is said in the conversation's language, one sentence per code (any other code: the general one)", () => {
    const { rerender } = render(<TalkLiveBody variant="bar" live={live({ turnProblem: "action_expired" })} words={TE} language="తెలుగు" onType={() => undefined} />);
    expect(document.querySelector('[data-part="talk-turn-problem"]')).toHaveTextContent(TE["dst.err.expired"]);
    rerender(<TalkLiveBody variant="bar" live={live({ turnProblem: "something_new" })} words={TE} language="తెలుగు" onType={() => undefined} />);
    expect(document.querySelector('[data-part="talk-turn-problem"]')).toHaveTextContent(TE["dst.err.turn"]);
  });

  it("the same plan in English words reads in English (the app language is not touched by the switch)", () => {
    render(<TalkLiveBody variant="bar" live={live()} words={pick("en", "talk")} language="English" onType={() => undefined} />);
    expect(screen.getByRole("button", { name: "Yes, call them" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
  });
});
