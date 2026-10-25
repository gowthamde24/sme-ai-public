import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (h.jar.has(k) ? { name: k, value: h.jar.get(k) } : undefined), set: (k: string, v: string) => void h.jar.set(k, v) }) }));

import { assistantProfile, enforceProfile } from "./defaults";
import { LINES, sayLine } from "./lines";
import { MOCK_COOKIE, readAssistant, saveAssistant } from "./source";
import { CALL_LANGS, DAYS, NAME_MAX, STYLES, parseSettings, validName } from "./types";

beforeEach(() => {
  h.jar.clear();
  vi.unstubAllEnvs();
});

describe("the assistant's name", () => {
  it("is letters (any script), digits and spaces, 1 to 24 characters, with a letter; never markup or punctuation", () => {
    for (const ok of ["Vani", "వాణి", "Anil Reddy", "Asha 2", "a"]) expect(validName(ok), ok).toBe(true);
    for (const bad of ["", "   ", "12", "<b>x</b>", "Vani!", "a@b", "x".repeat(NAME_MAX + 1), 7, null]) expect(validName(bad), String(bad)).toBe(false);
    expect(validName("x".repeat(NAME_MAX))).toBe(true);
  });
});

describe("the settings are checked as a whole", () => {
  const good = assistantProfile(null).defaults;
  it("the defaults are valid", () => {
    expect(parseSettings(good)).toEqual({ ...good, hours: { ...good.hours, days: [...good.hours.days] } });
  });
  it("a value that is not in its shape is refused, never half accepted", () => {
    const bad: unknown[] = [null, "x", [], { ...good, name: "<x>" }, { ...good, voice: "robot" }, { ...good, lang: "ta" }, { ...good, style: "rude" }, { ...good, speed: 2 }, { ...good, speed: "1" }, { ...good, maxDiscount: 101 }, { ...good, maxDiscount: 1.5 }, { ...good, may: { ...good.may, dues: "yes" } }, { ...good, handover: { ...good.handover, orderAbove: -1 } }, { ...good, hours: { ...good.hours, from: "19:00", to: "09:00" } }, { ...good, hours: { ...good.hours, from: "25:00" } }, { ...good, hours: { ...good.hours, days: [] } }, { ...good, hours: { ...good.hours, days: ["mon", "mon"] } }, { ...good, hours: { ...good.hours, days: ["funday"] } }];
    for (const b of bad) expect(parseSettings(b), JSON.stringify(b)).toBeNull();
  });
  it("trims the name, rounds the speed and puts the days in week order", () => {
    const s = parseSettings({ ...good, name: "  Vani  ", speed: 1.0499, hours: { ...good.hours, days: ["sat", "mon"] } })!;
    expect(s.name).toBe("Vani");
    expect(s.speed).toBe(1.05);
    expect(s.hours.days).toEqual(["mon", "sat"]);
    expect(DAYS).toHaveLength(7);
  });
});

describe("the defaults of each business type come from its modules", () => {
  it("a school never talks about dues, offers no discount and has no order limit, whatever a form says", () => {
    const school = assistantProfile(["programmes", "fees"]);
    expect(school.mayRows).not.toContain("dues");
    expect([school.discount, school.orderLimit]).toEqual([false, false]);
    const forced = enforceProfile({ ...school.defaults, may: { ...school.defaults.may, dues: true }, maxDiscount: 40, handover: { ...school.defaults.handover, orderAbove: 50000 } }, school);
    expect([forced.may.dues, forced.maxDiscount, forced.handover.orderAbove]).toEqual([false, 0, null]);
  });
  it("building materials may talk about dues (it sells on credit); a shop may not by default; nobody is given a discount by default", () => {
    expect(assistantProfile(["materials"]).defaults.may.dues).toBe(true);
    expect(assistantProfile(["catalogue"]).defaults.may.dues).toBe(false);
    for (const m of [[], ["materials"], ["programmes"], null]) expect(assistantProfile(m).defaults.maxDiscount, String(m)).toBe(0);
    expect(enforceProfile(assistantProfile(["materials"]).defaults, assistantProfile(["materials"])).may.dues).toBe(true);
  });
});

describe("the example line of a call", () => {
  it("is in the language of the call for every way of talking, says AI assistant, and uses the name and the business", () => {
    for (const l of CALL_LANGS) for (const s of STYLES) {
      const line = sayLine(l, s, "Meera", "Acme Silks");
      expect(line, `${l} ${s}`).toContain("Meera");
      expect(line, `${l} ${s}`).toContain("Acme Silks");
      expect(line, `${l} ${s}`).not.toMatch(/\{(name|shop)\}/);
      expect(LINES[l][s], `${l} ${s}`).toMatch(/AI/);
    }
    expect(sayLine("te", "warm", "x", "y")).toMatch(/[ఀ-౿]/);
    expect(sayLine("hi", "warm", "x", "y")).toMatch(/[ऀ-ॿ]/);
    expect(sayLine("kn", "warm", "x", "y")).toMatch(/[ಀ-೿]/);
  });
  it("never names a product, a price, a child, fees or marks", () => {
    for (const l of CALL_LANGS) for (const s of STYLES) expect(LINES[l][s], `${l} ${s}`).not.toMatch(/₹|\d|fee|marks|child|saree|फ़ीस|ఫీజు|ಫೀಸ್/i);
  });
});

describe("where the settings come from and go, by the flag", () => {
  it("off: nothing; on: Not available yet (C1's API is not there); neither saves anything", async () => {
    expect(await readAssistant(null)).toEqual({ mode: "off" });
    expect(await saveAssistant(assistantProfile(null).defaults, null)).toEqual({ ok: false, error: "not_available" });
    vi.stubEnv("ASSISTANT_SCREENS", "1");
    expect(await readAssistant(null)).toEqual({ mode: "unavailable" });
    expect(await saveAssistant(assistantProfile(null).defaults, null)).toEqual({ ok: false, error: "not_available" });
    expect(h.jar.size).toBe(0);
  });
  it("mock: the defaults of the business type until the owner saves, then what was saved (checked again on every read)", async () => {
    vi.stubEnv("ASSISTANT_SCREENS", "mock");
    const first = await readAssistant(["materials"]);
    expect(first).toMatchObject({ mode: "ok", saved: false });
    const mine = { ...assistantProfile(["materials"]).defaults, name: "Meera", maxDiscount: 5 };
    expect(await saveAssistant(mine, ["materials"])).toEqual({ ok: true });
    const read = await readAssistant(["materials"]);
    expect(read).toMatchObject({ mode: "ok", saved: true });
    expect(read.mode === "ok" ? read.settings : null).toMatchObject({ name: "Meera", maxDiscount: 5 });
    h.jar.set(MOCK_COOKIE, "{broken");
    expect(await readAssistant(["materials"])).toMatchObject({ mode: "ok", saved: false });
    h.jar.set(MOCK_COOKIE, JSON.stringify({ ...mine, name: "<script>" }));
    expect(await readAssistant(["materials"])).toMatchObject({ mode: "ok", saved: false });
  });
  it("mock: a value that is not in its shape is refused and nothing is stored; a school's save is forced to no dues, no discount, no limit", async () => {
    vi.stubEnv("ASSISTANT_SCREENS", "mock");
    expect(await saveAssistant({ nonsense: true }, null)).toEqual({ ok: false, error: "invalid" });
    expect(h.jar.size).toBe(0);
    const school = assistantProfile(["programmes"]);
    expect(await saveAssistant({ ...school.defaults, may: { ...school.defaults.may, dues: true }, maxDiscount: 30, handover: { ...school.defaults.handover, orderAbove: 1000 } }, ["programmes"])).toEqual({ ok: true });
    const stored = JSON.parse(h.jar.get(MOCK_COOKIE)!);
    expect([stored.may.dues, stored.maxDiscount, stored.handover.orderAbove]).toEqual([false, 0, null]);
  });
});
