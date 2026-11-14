import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { BIG_PLAN_PEOPLE, parsePlanExtras, type PlanExtras } from "@/lib/api/plan-extras";
import { confirmMessage, parsePlan } from "@/lib/browser-voice/protocol";

import { TalkLiveBody } from "./TalkLive";
import type { TalkLive } from "./use-talk-live";

afterEach(cleanup);

const TALK_PREFIXES = ["dst.", "tv6.talk.", "bv.chat.plan.", "bv.chat.state.", "bv.chat.err.", "bv.end.", "bv.live."];
const pick = (lang: "en" | "te") => Object.fromEntries(Object.entries(appDict(lang) as Record<string, string>).filter(([k]) => TALK_PREFIXES.some((p) => k.startsWith(p))));
const TE = pick("te");
const EN = pick("en");

const BIG_EXTRAS: PlanExtras = {
  audience: { kind: "all_leads", label: "అందరూ leads", count: 255 },
  consent: { callable: 230, skipped: 25, skippedSample: ["Padmaja", "Ravi"], reasonCounts: { no_consent: 25 } },
  dailyCap: null,
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

  it("the card says WHICH group, how many have consent (only they are called) and how many must be asked first, with their first names; no limit line while the API's daily_cap is null", () => {
    draw(live(plan(255, BIG_EXTRAS)));
    expect(document.querySelector('[data-part="plan-audience"]')).toHaveTextContent("అందరూ leads");
    expect(document.querySelector('[data-part="plan-consent"]')).toHaveTextContent("230 మందికి consent ఉంది, వాళ్ళకే కాల్ చేస్తాం");
    expect(document.querySelector('[data-part="plan-ask-first"]')).toHaveTextContent("25 మందిని ముందు అడగాలి");
    expect(document.querySelector('[data-part="plan-skipped"]')).toHaveTextContent("Padmaja");
    expect(document.querySelector('[data-part="plan-cap"]')).toBeNull();
  });

  it("a SMALL plan shows the same consent and ask-first lines (consent is strict at any size) and still has no second step", () => {
    const small = live(plan(14, { ...BIG_EXTRAS, audience: { kind: "new_enquiries", label: "కొత్త enquiries", count: 14 }, consent: { callable: 11, skipped: 3, skippedSample: ["Ravi"], reasonCounts: { no_consent: 3 } } }));
    draw(small);
    expect(document.querySelector('[data-part="plan-consent"]')).toHaveTextContent("11 మందికి consent ఉంది, వాళ్ళకే కాల్ చేస్తాం");
    expect(document.querySelector('[data-part="plan-ask-first"]')).toHaveTextContent("3 మందిని ముందు అడగాలి");
    fireEvent.click(screen.getByRole("button", { name: "సరే, కాల్ చెయ్యి" }));
    expect(small.decide).toHaveBeenCalledWith("yes");
    expect(document.querySelector('[data-part="plan-second-step"]')).toBeNull();
  });

  it("a plan whose everyone has consent says so and has no ask-first line", () => {
    draw(live(plan(14, { ...BIG_EXTRAS, consent: { callable: 14, skipped: 0, skippedSample: [], reasonCounts: {} } })));
    expect(document.querySelector('[data-part="plan-consent"]')).toHaveTextContent("14 మందికి consent ఉంది");
    expect(document.querySelector('[data-part="plan-ask-first"]')).toBeNull();
  });

  it("'WhatsApp లో అడుగు' is drawn only when a route is given (askConsent), and calls it; the daily limit line appears only when the API sends a non-null daily_cap", () => {
    draw(live(plan(255, BIG_EXTRAS)));
    expect(document.querySelector('[data-part="plan-ask-wa"]')).toBeNull();
    cleanup();
    const ask = vi.fn(async () => ({ ok: true as const, result: { how: "whatsapp" as const, asked: 25, queued: 25, blocked: 0, blockedReasons: {}, templateStatus: null, newAction: null, newTaskId: null } }));
    draw(live(plan(255, { ...BIG_EXTRAS, dailyCap: { limit: 100, used: 20, remaining: 80 } }), { askConsent: ask }));
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp లో అడుగు" }));
    expect(ask).toHaveBeenCalledWith("whatsapp");
    expect(document.querySelector('[data-part="plan-cap"]')).toHaveTextContent("80");
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

  it("the second question is OUR words in the app's language with the count; the API's `second_confirm_text` is not shown (owner, 14 Nov)", () => {
    draw(live(plan(255, { ...BIG_EXTRAS })));
    fireEvent.click(screen.getByRole("button", { name: "సరే, కాల్ చెయ్యి" }));
    expect(document.querySelector('[data-part="plan-second-step"]')).toHaveTextContent("నిజంగా 255 మందికి కాల్ చెయ్యనా?");
    expect(parsePlanExtras({ needs_second_confirm: true, second_confirm_text: "from the API" })).not.toHaveProperty("secondConfirmText");
  });

  it("second_yes_required (the API refused a plain yes) is not an error: the second question opens for any plan, 'back' closes it", () => {
    const l = live(plan(14), { secondAsked: true });
    draw(l);
    expect(document.querySelector('[data-part="plan-second-step"]')).toBeInTheDocument();
    expect(document.querySelector('[data-part="talk-plan-error"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "వద్దు, వెనక్కి" }));
    expect(document.querySelector('[data-part="plan-second-step"]')).toBeNull();
    expect(l.decide).not.toHaveBeenCalled();
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
    const x = parsePlanExtras({ audience: { kind: "all_leads", label: "అందరూ leads", count: 255 }, consent: { callable: 230, skipped: 25, skipped_sample: [{ contact_id: "c1", name: "A", reason: "no_consent" }, "B", 3, { x: 1 }], reason_counts: { no_consent: 25, "Bad Key": 1, other: "x" } }, daily_cap: { limit: 100, used: 20, remaining: 80 }, needs_second_confirm: true, second_confirm_text: "నిజంగా 255 మందికి కాల్ చెయ్యనా?" });
    expect(x.audience).toEqual({ kind: "all_leads", label: "అందరూ leads", count: 255 });
    expect(x.consent).toEqual({ callable: 230, skipped: 25, skippedSample: ["A", "B"], reasonCounts: { no_consent: 25 } });
    expect(x.dailyCap).toEqual({ limit: 100, used: 20, remaining: 80 });
    expect(parsePlanExtras({ daily_cap: null }).dailyCap).toBeNull();
    expect(x.needsSecondConfirm).toBe(true);
    expect(parsePlanExtras({ consent: { callable: -1, skipped: 2 }, daily_cap: { limit: "x" }, second_confirm_text: "  " })).toMatchObject({ consent: null, dailyCap: null });
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

describe.each(["card", "bar"] as const)("'ask first' and today's limit on the plan card in Talk live (%s), app in English", (variant) => {
  const draw = (l: TalkLive) => render(<TalkLiveBody variant={variant} live={l} words={EN} language="తెలుగు" onType={() => undefined} />);
  const answer = { ok: true as const, result: { how: "whatsapp" as const, asked: 20, queued: 20, blocked: 0, blockedReasons: {}, templateStatus: null, newAction: null, newTaskId: null } };
  const SMALL: PlanExtras = { audience: null, consent: { callable: 10, skipped: 4, skippedSample: ["Asha"], reasonCounts: { no_consent: 3, opted_out: 1 } }, dailyCap: { limit: 100, used: 23, remaining: 77 }, needsSecondConfirm: false };

  it("a SMALL plan too (consent is strict for every plan): only the people with UNKNOWN consent are 'ask first' (3, not the 4 skipped), the buttons are drawn only with the ask, and the limit line shows when the API sends it", () => {
    const ask = vi.fn(async () => answer);
    draw(live(plan(14, SMALL), { askConsent: ask }));
    expect(document.querySelector('[data-part="plan-ask-first"]')).toHaveTextContent("3 need asking first, they are not called.");
    expect(screen.getByRole("button", { name: "Ask by WhatsApp" })).toBeInTheDocument();
    expect(document.querySelector('[data-part="plan-cap"]')).toHaveTextContent("77 calls left for today (limit 100)");
    expect(document.querySelector('[data-part="plan-second-step"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ask by WhatsApp" }));
    expect(ask).toHaveBeenCalledWith("whatsapp");
  });

  it("nobody with unknown consent (only withdrawn, no phone ...) = no buttons: they are never asked; no ask given = no buttons either", () => {
    const ask = vi.fn(async () => answer);
    draw(live(plan(14, { ...SMALL, consent: { callable: 10, skipped: 2, skippedSample: [], reasonCounts: { opted_out: 2 } } }), { askConsent: ask }));
    expect(screen.queryByRole("button", { name: "Ask by WhatsApp" })).toBeNull();
    cleanup();
    draw(live(plan(14, SMALL)));
    expect(screen.queryByRole("button", { name: "Ask by WhatsApp" })).toBeNull();
  });

  it("a yes that would pass today's limit says how many calls the plan has and how many are left, in the app's language", () => {
    draw(live(plan(120, SMALL), { turnProblem: "daily_cap_exceeded" }));
    expect(document.querySelector('[data-part="talk-turn-problem"]')).toHaveTextContent("this plan has 120 calls and 77 are left of 100 today");
    cleanup();
    draw(live(plan(120, SMALL), { planError: "dst.err.cap" }));
    expect(document.body.textContent).toContain("this plan has 120 calls and 77 are left of 100 today");
  });
});
