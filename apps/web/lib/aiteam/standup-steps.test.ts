import { describe, expect, it } from "vitest";

import { NO_COUNTS } from "@/lib/nav-counts";

import { buildSteps, dayWords, earlierDates, reporterOf, stepAt, todoCards, wordAt, wordsOf } from "./standup-steps";

const L = (text: string, source: string) => ({ text, source });

describe("reporterOf", () => {
  it.each([
    ["yesterday.calls", "caller"],
    ["yesterday.orders", "order_desk"],
    ["yesterday.admissions", "admissions"],
    ["yesterday.leads", "lead_catcher"],
    ["today.followups", "followups"],
    ["now.waiting", "everyone"],
    ["today.first", "everyone"],
    ["something.new", "everyone"],
  ])("%s is said by %s", (source, who) => expect(reporterOf(source)).toBe(who));
});

describe("buildSteps", () => {
  it("groups neighbouring lines of one voice and keeps the stand-up's own order", () => {
    const steps = buildSteps([L("A.", "yesterday.calls"), L("B.", "yesterday.calls"), L("C.", "yesterday.orders"), L("D.", "now.waiting"), L("E.", "today.first")]);
    expect(steps.map((s) => [s.who, s.text, s.lines])).toEqual([
      ["caller", "A. B.", [0, 1]],
      ["order_desk", "C.", [2]],
      ["everyone", "D. E.", [3, 4]],
    ]);
  });
  it("no lines, no steps", () => expect(buildSteps([])).toEqual([]));
});

describe("stepAt and wordAt follow the sound", () => {
  const steps = buildSteps([L("aaaa", "yesterday.calls"), L("bbbbbbbb", "yesterday.orders"), L("cccc", "now.waiting")]);
  it("splits the sound by the length of the words", () => {
    expect(stepAt(steps, 0)).toMatchObject({ index: 0, within: 0 });
    expect(stepAt(steps, 0.1).index).toBe(0);
    expect(stepAt(steps, 0.5).index).toBe(1);
    expect(stepAt(steps, 0.99).index).toBe(2);
    expect(stepAt(steps, 1).index).toBe(2);
  });
  it("is safe on nonsense", () => {
    expect(stepAt(steps, Number.NaN).index).toBe(0);
    expect(stepAt(steps, -3).index).toBe(0);
    expect(stepAt(steps, 9).index).toBe(2);
    expect(stepAt([], 0.5)).toEqual({ index: 0, within: 0 });
  });
  it("marks the word being read, spaces are never marked", () => {
    const parts = wordsOf("one two  three");
    expect(parts).toEqual(["one", " ", "two", "  ", "three"]);
    expect(wordAt(parts, 0)).toBe(0);
    expect(wordAt(parts, 0.4)).toBe(2);
    expect(wordAt(parts, 0.99)).toBe(4);
    expect(wordAt([], 0.5)).toBe(-1);
  });
  it("works for Telugu and Kannada text too (words are split at spaces)", () => {
    const parts = wordsOf("శుభోదయం. నిన్న 6 కొత్త లీడ్‌లు");
    expect(parts.filter((p) => p.trim()).length).toBe(5);
    expect(wordAt(parts, 0.5)).toBeGreaterThanOrEqual(0);
  });
});

describe("todoCards", () => {
  const base = "/app/tenants/t";
  it("one card for each thing that really waits, never for a zero or an unknown number", () => {
    const todos = todoCards({ ...NO_COUNTS, quotesWaiting: 2, prospectsNeedingOwner: 1, unreadChats: 0, followupsDue: null, visitsToday: 3 }, base, { finder: true });
    expect(todos).toEqual([
      { key: "quotes", n: 2, href: `${base}/quotes` },
      { key: "finder", n: 1, href: `${base}/retailers` },
      { key: "visits", n: 3, href: `${base}/visits` },
    ]);
  });
  it("no finder card where the Lead Finder is not offered; nothing at all without counts", () => {
    expect(todoCards({ ...NO_COUNTS, prospectsNeedingOwner: 4 }, base, { finder: false })).toEqual([]);
    expect(todoCards(null, base, { finder: true })).toEqual([]);
  });
});

describe("earlierDates and dayWords", () => {
  it("the days before, newest first, across a month end", () => {
    expect(earlierDates("2026-11-02", 3)).toEqual(["2026-11-01", "2026-10-31", "2026-10-30"]);
  });
  it("a day in the person's language, not moved by the zone", () => {
    expect(dayWords("2026-11-05", "en-IN")).toMatch(/Thu.*5.*November/);
    expect(dayWords("2026-11-05", "te-IN")).toMatch(/5/);
  });
});
