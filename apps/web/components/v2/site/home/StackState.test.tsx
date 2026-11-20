import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { siteDict } from "@/i18n/site";
import { SITE_LANGS } from "@/i18n/site-lang";

import { ChatStack } from "./ChatStack";
import { FOUND_KEYS, STACK } from "./chat-stack";
import { FoundCard, StackProvider } from "./StackState";

const setsFor = (lang: (typeof SITE_LANGS)[number]) => {
  const d = siteDict(lang) as Record<string, string>;
  return FOUND_KEYS.map((rows) => rows.map(([l, v]) => ({ l: d[l], v: d[v] })));
};

describe("the found-out card of the home page's chat stack", () => {
  it.each(SITE_LANGS)("%s: every chat has its own card set, of the same length (three rows), none equal to another's", (lang) => {
    const sets = setsFor(lang);
    expect(sets).toHaveLength(STACK.length);
    for (const rows of sets) {
      expect(rows).toHaveLength(3);
      for (const r of rows) {
        expect(r.l, `${lang} label`).toBeTruthy();
        expect(r.v, `${lang} value`).toBeTruthy();
      }
    }
    const flat = sets.map((rows) => rows.map((r) => `${r.l}=${r.v}`).join("|"));
    expect(new Set(flat).size).toBe(STACK.length);
  });
  it("the English sets say what each conversation is about", () => {
    const [te, hi, kn, en] = setsFor("en").map((rows) => rows.map((r) => r.v).join(" / "));
    expect(te).toBe("EAMCET weekend batch / A Class 12 student / Demo class, Saturday 10 am");
    expect(hi).toBe("2BHK in Kondapur / Up to 80 lakh / Site visit, Saturday 11 am");
    expect(kn).toBe("A doctor's appointment / Tomorrow morning / Tomorrow, 10:30 am");
    expect(en).toBe("Ready for pickup / At the counter / Today, after 6 pm");
  });
});

describe("the phone (call, then chat) and the card run on ONE clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const mount = () => {
    const sets = setsFor("en");
    return render(
      <StackProvider chats={STACK}>
        <ChatStack chats={STACK} chips={["te", "hi", "kn", "en"]} captions={["1", "2", "3", "4"]} sub="Business account" placeholder="Message" />
        <FoundCard heading="What it found out" sets={sets} />
      </StackProvider>,
    );
  };
  const q = (c: HTMLElement, sel: string) => c.querySelector(sel);
  const state = (c: HTMLElement) => {
    const st = q(c, '[data-part="chat-stack"]')!;
    return { lang: st.getAttribute("data-lang"), phase: st.getAttribute("data-phase"), set: q(c, ".h3-found-set[data-on]")?.getAttribute("data-set"), rows: c.querySelectorAll(".h3-found-row[data-row]").length, out: st.hasAttribute("data-out"), cardOut: q(c, '[data-part="found-out"]')!.hasAttribute("data-out") };
  };

  it("starts with the first conversation's chat whole and its card (the still state: Telugu coaching)", () => {
    const { container } = mount();
    expect(state(container)).toMatchObject({ lang: "te", phase: "chat", set: "0", rows: 3 });
    expect(container.querySelectorAll(".pp-b")).toHaveLength(4);
  });
  it("each language runs call -> call ended -> chat -> fade, then the next; the card follows the same conversation (empty during the call, filling with the chat), and fades with it; a full cycle takes 12 to 16 s each", async () => {
    const { container } = mount();
    const seen: string[] = [];
    const starts: Record<string, number> = {};
    for (let t = 0; t < 70000; t += 100) {
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      const s = state(container);
      const key = `${s.lang}:${s.phase}`;
      if (seen[seen.length - 1] !== key) {
        seen.push(key);
        if (s.phase === "call") starts[`${s.lang}${seen.length}`] = t;
      }
      // at every moment the card's set is the one of the conversation on the phone, and it fades exactly when the phone does
      expect(["te:0", "hi:1", "kn:2", "en:3"]).toContain(`${s.lang}:${s.set}`);
      expect(s.cardOut).toBe(s.out);
      if (s.phase === "call" || s.phase === "ended") expect(s.rows).toBe(0);
      if (s.phase === "chat") expect(s.rows).toBeLessThanOrEqual(3);
    }
    expect(seen.slice(0, 9)).toEqual(["te:call", "te:ended", "te:chat", "te:out", "hi:call", "hi:ended", "hi:chat", "hi:out", "kn:call"]);
    const t0 = Object.values(starts);
    expect(t0[1] - t0[0]).toBeGreaterThanOrEqual(12000);
    expect(t0[1] - t0[0]).toBeLessThanOrEqual(16000);
  });
  it("the clock stands still while the phone is off screen", async () => {
    let cb: (es: { isIntersecting: boolean }[]) => void = () => undefined;
    vi.stubGlobal("IntersectionObserver", class { constructor(f: typeof cb) { cb = f; } observe() {} disconnect() {} unobserve() {} });
    const { container } = mount();
    await act(async () => { vi.advanceTimersByTime(3000); });
    const before = JSON.stringify(state(container)) + container.querySelectorAll(".pp-line").length;
    await act(async () => { cb([{ isIntersecting: false }]); });
    await act(async () => { vi.advanceTimersByTime(20000); });
    expect(JSON.stringify(state(container)) + container.querySelectorAll(".pp-line").length).toBe(before);
    await act(async () => { cb([{ isIntersecting: true }]); });
    await act(async () => { vi.advanceTimersByTime(20000); });
    expect(JSON.stringify(state(container)) + container.querySelectorAll(".pp-line").length).not.toBe(before);
  });
});
