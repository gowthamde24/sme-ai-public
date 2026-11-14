import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { BIG_PLAN_PEOPLE, parsePlanExtras, type PlanExtras } from "@/lib/api/plan-extras";
import { CONV_WORD_SETS } from "@/lib/conversation/word-sets";
import { confirmMessage, parsePlan } from "@/lib/browser-voice/protocol";

import { TalkLiveBody } from "./TalkLive";
import type { TalkLive } from "./use-talk-live";

afterEach(cleanup);

const pick = (lang: "en" | "te") => Object.fromEntries(Object.entries(appDict(lang) as Record<string, string>).filter(([k]) => CONV_WORD_SETS.talk.some((p) => k.startsWith(p))));
const TE = pick("te");
const EN = pick("en");

const BIG_EXTRAS: PlanExtras = {
  audience: { kind: "all_leads", label: "అందరూ leads", count: 255 },
  consent: { callable: 230, skipped: 25, skippedSample: ["P•••• N.", "R•••• K."] },
  dailyCap: { limit: 300, used: 20, remaining: 280 },
  needsSecondConfirm: false,
};
const plan = (people: number, extras?: PlanExtras) => ({ what: `${people} మందికి కాల్`, summary: "అందరికీ call చేస్తాను.", time: "", hours: "", cost: "₹2,499", people, messages: 0, minutes: people * 2, channel: "call" as const, ...(extras ? { extras } : {}) });
const live = (p: ReturnType<typeof plan>, over: Partial<TalkLive> = {}): TalkLive => ({
  active: true,
  real: true,
  state: "thinking",
  seconds: 5,
  lines: [],
  plan: p,
  answer: null,
  planStatus: "proposed",
  muted: false,
  start: vi.fn(),
  end: vi.fn(),
  toggleMute: vi.fn(),
  decide: vi.fn(),
  ...over,
});

describe.each(["card", "bar"] as const)("a big plan in Talk live (%s)", (variant) => {
  const draw = (l: TalkLive, words = TE) => render(<TalkLiveBody variant={variant} live={l} words={words} language="తెలుగు" onType={() => undefined} />);

  it("more than 50 people: the count and the ₹ are large; the first tap only opens 'నిజంగా 255 మందికి కాల్ చెయ్యనా?' and sends nothing; the second tap sends yes with the second confirmation; back returns", () => {
    const l = live(plan(255, BIG_EXTRAS));
    draw(l);
    expect(document.querySelector('[data-part="plan-big-figures"]')).toHaveTextContent("255 మంది");
    expect(document.querySelector('[data-part="plan-big-figures"]')).toHaveTextContent("₹2,499");
    fireEvent.click(screen.getByRole("button", { name: "సరే, కాల్ చెయ్యి" }));
    expect(l.decide).not.toHaveBeenCalled();
    expect(document.querySelector('[data-part="plan-second-step"]')).toHaveTextContent("నిజంగా 255 మందికి కాల్ చెయ్యనా?");
    fireEvent.click(screen.getByRole("button", { name: "వద్దు, వెనక్కి" }));
    expect(document.querySelector('[data-part="plan-second-step"]')).toBeNull();
    expect(l.decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "సరే, కాల్ చెయ్యి" }));
    fireEvent.click(screen.getByRole("button", { name: "అవును, కాల్ చెయ్యి" }));
    expect(l.decide).toHaveBeenCalledTimes(1);
    expect(l.decide).toHaveBeenCalledWith("yes", true);
  });

  it("the card says WHICH group, how many have consent and who is skipped (only the callable ones are contacted), and what is left of today's limit", () => {
    draw(live(plan(255, BIG_EXTRAS)));
    expect(document.querySelector('[data-part="plan-audience"]')).toHaveTextContent("అందరూ leads");
    expect(document.querySelector('[data-part="plan-consent"]')).toHaveTextContent("230");
    expect(document.querySelector('[data-part="plan-consent"]')).toHaveTextContent("25");
    expect(document.querySelector('[data-part="plan-skipped"]')).toHaveTextContent("P•••• N.");
    expect(document.querySelector('[data-part="plan-cap"]')).toHaveTextContent("280");
  });

  it("50 people is NOT big (one tap, as before); the API's needs_second_confirm makes even a small plan ask twice", () => {
    const small = live(plan(BIG_PLAN_PEOPLE));
    draw(small);
    fireEvent.click(screen.getByRole("button", { name: "సరే, కాల్ చెయ్యి" }));
    expect(small.decide).toHaveBeenCalledWith("yes");
    expect(document.querySelector('[data-part="plan-second-step"]')).toBeNull();
    cleanup();
    const forced = live(plan(14, { ...BIG_EXTRAS, needsSecondConfirm: true }));
    draw(forced);
    fireEvent.click(screen.getByRole("button", { name: "సరే, కాల్ చెయ్యి" }));
    expect(forced.decide).not.toHaveBeenCalled();
    expect(document.querySelector('[data-part="plan-second-step"]')).toBeInTheDocument();
  });

  it("a 14-person plan with no extras draws none of the big-plan lines", () => {
    draw(live(plan(14)));
    expect(document.querySelector('[data-part="plan-big-figures"]')).toBeNull();
    expect(document.querySelector('[data-part="plan-extras"]')).toBeNull();
  });

  it("English words read in English", () => {
    draw(live(plan(255, BIG_EXTRAS)), EN);
    fireEvent.click(screen.getByRole("button", { name: "Yes, call them" }));
    expect(document.querySelector('[data-part="plan-second-step"]')).toHaveTextContent("Really call 255 people?");
  });
});

describe("the big-plan fields of the payload", () => {
  it("parsePlanExtras reads what is usable and nothing else (never invents)", () => {
    expect(parsePlanExtras({})).toEqual({ audience: null, consent: null, dailyCap: null, needsSecondConfirm: false });
    const x = parsePlanExtras({ audience: { kind: "all_leads", label: "అందరూ leads", count: 255 }, consent: { callable: 230, skipped: 25, skipped_sample: [{ name: "A" }, "B", 3, { x: 1 }] }, daily_cap: { limit: 300, used: 20, remaining: 280 }, needs_second_confirm: true });
    expect(x.audience).toEqual({ kind: "all_leads", label: "అందరూ leads", count: 255 });
    expect(x.consent).toEqual({ callable: 230, skipped: 25, skippedSample: ["A", "B"] });
    expect(x.dailyCap).toEqual({ limit: 300, used: 20, remaining: 280 });
    expect(x.needsSecondConfirm).toBe(true);
    expect(parsePlanExtras({ consent: { callable: -1, skipped: 2 }, daily_cap: { limit: "x" } })).toMatchObject({ consent: null, dailyCap: null });
    expect(parsePlanExtras({ consent: { callable: 1, skipped: 2, skipped_sample: Array.from({ length: 30 }, (_, i) => `n${i}`) } }).consent?.skippedSample).toHaveLength(10);
  });

  it("the voice socket's plan carries them, and the second confirmation goes in the confirm message only on a yes", () => {
    const a = parsePlan({ action_id: "55555555-5555-4555-8555-555555555555", title: "T", summary: "S", steps: [], count: 255, channel: "call", estimate: null, audience: { label: "అందరూ leads", kind: "all_leads", count: 255 } });
    expect(a?.extras?.audience?.label).toBe("అందరూ leads");
    const id = "55555555-5555-4555-8555-555555555555";
    expect(JSON.parse(confirmMessage(id, "yes", true))).toEqual({ type: "confirm", action_id: id, decision: "yes", second_confirm: true });
    expect(JSON.parse(confirmMessage(id, "yes"))).toEqual({ type: "confirm", action_id: id, decision: "yes" });
    expect(JSON.parse(confirmMessage(id, "change", true))).toEqual({ type: "confirm", action_id: id, decision: "change" });
  });
});
