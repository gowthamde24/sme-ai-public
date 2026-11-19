import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { wireFestivals, wireNewJobSheet } from "@/lib/jobs/template-fixtures";
import { groupByGoal, isLater, popularOf, shown } from "@/lib/jobs/templates";

import { parseFestivals, parseNewJobSheet, parsePackJobs, parseSampleAudio, parseTemplate, parseTexts, readFestivals, readNewJobSheet } from "./job-templates";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const PACKS = path.resolve(import.meta.dirname, "../../../../packages/packs");
const raw = (pack: string) => JSON.parse(readFileSync(path.join(PACKS, pack, "jobs.json"), "utf8")) as { templates: Record<string, unknown>[] };
const whatsapp = (over: Record<string, unknown> = {}) => ({ id: "t_one", kind: "offers", goal: "bring_customers_back", popular: false, title: { en: "A", te: "ఎ" }, benefit: { en: "B" }, ask: { en: "C" }, preview: { whatsapp: { en: "Hi {customer} {business}" }, sample_audio: null }, needs: ["whatsapp"], finds_out: [], ...over });

describe("the adapter reads C1's real jobs.json (every pack on main)", () => {
  const packs = readdirSync(PACKS).filter((p) => { try { return raw(p).templates.length > 0; } catch { return false; } });
  it("there are the 13 packs and 137 templates C1 shipped", () => {
    expect(packs.length).toBeGreaterThanOrEqual(13);
    expect(packs.reduce((n, p) => n + raw(p).templates.length, 0)).toBeGreaterThanOrEqual(137);
  });
  it.each(packs)("%s: every template parses (nothing is left out, nothing logged)", (pack) => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = parsePackJobs(raw(pack) as unknown);
    expect(err).not.toHaveBeenCalled();
    expect(out.pack).toBe(pack);
    expect(out.templates).toHaveLength(raw(pack).templates.length);
  });
});

describe("the fixtures (the real content of five packs) go through the SAME parsers", () => {
  const sheet = parseNewJobSheet(wireNewJobSheet());
  it("the shop's own pack is textiles; the other four are the other business types", () => {
    expect(sheet.businessType.pack).toBe("textiles");
    expect(sheet.own.templates).toHaveLength(11);
    expect(sheet.others.map((o) => [o.pack, o.jobs.templates.length])).toEqual([["clinic", 10], ["coaching", 10], ["real_estate", 10], ["wholesale_b2b", 11]]);
  });
  it("four popular saree cards, in the pack's order, and the real words (Telugu letters from C1)", () => {
    const pop = popularOf(sheet.own);
    expect(pop.map((t) => t.id)).toEqual(["enquiry_call_right_away", "answer_calls_when_busy", "new_collection_arrived", "store_visit_booking"]);
    expect(pop[0].title.en).toBe("Call every new enquiry right away");
    expect(pop[0].title.te).toMatch(/[ఀ-౿]/);
    expect(pop[0].whatsapp?.en).toContain("{customer}");
    expect(pop[0].call?.en.split("\n")).toHaveLength(2);
  });
  it("the Lead Finder card has three examples and nothing it would say; its fit comes only from the data", () => {
    const lf = sheet.own.templates.find((t) => t.kind === "researcher")!;
    expect(lf.examples).toHaveLength(3);
    expect(lf.whatsapp).toBeNull();
    expect(lf.call).toBeNull();
    expect(lf.examples.every((e) => e.name.endsWith("(example)"))).toBe(true);
    expect(parsePackJobs(raw("textiles") as unknown).templates.find((t) => t.kind === "researcher")!.examples.every((e) => e.fit === null)).toBe(true);
  });
  it("the payment reminder is LATER: it is in the data, and never shown (not as popular, not in a goal group)", () => {
    const pay = sheet.own.templates.find((t) => t.id === "payment_reminder_gentle")!;
    expect(pay.goal).toBe("get_paid");
    expect(isLater(pay)).toBe(true);
    expect(shown(sheet.own).some((t) => t.id === pay.id)).toBe(false);
    expect(popularOf({ ...sheet.own, templates: sheet.own.templates.map((t) => (t.id === pay.id ? { ...t, popular: true } : t)) }).some((t) => t.id === pay.id)).toBe(false);
    const groups = groupByGoal(sheet.own);
    expect(groups.map((g) => g.goal)).toEqual(["answer_every_enquiry", "bring_customers_back", "fill_your_visits", "find_new_customers"]);
    expect(groups.flatMap((g) => g.templates).some((t) => t.goal === "get_paid")).toBe(false);
  });
  it("no sample recording yet: sample_audio is null everywhere (the player is not drawn)", () => {
    expect([sheet.own, ...sheet.others.map((o) => o.jobs)].flatMap((p) => p.templates).every((t) => t.sampleAudio === null)).toBe(true);
  });
});

describe("closed words and bounds", () => {
  it("a template with a word outside the closed lists is an error; in a file it is logged and left out, the rest are kept", () => {
    expect(() => parseTemplate(whatsapp({ kind: "teleport" }))).toThrow();
    expect(() => parseTemplate(whatsapp({ goal: "world_peace" }))).toThrow();
    expect(() => parseTemplate(whatsapp({ needs: ["a_jetpack"] }))).toThrow();
    expect(() => parseTemplate(whatsapp({ season: "midsummer" }))).toThrow();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = parsePackJobs({ status: "draft", pack: "x_pack", version: 1, templates: [whatsapp(), whatsapp({ id: "t_two", kind: "teleport" })] });
    expect(out.templates.map((t) => t.id)).toEqual(["t_one"]);
    expect(err).toHaveBeenCalledTimes(1);
  });
  it("a card that would show nothing is refused: a message template needs a bubble or a call, a Lead Finder one needs examples and no preview", () => {
    expect(() => parseTemplate(whatsapp({ preview: { sample_audio: null } }))).toThrow();
    expect(() => parseTemplate(whatsapp({ kind: "researcher", goal: "find_new_customers" }))).toThrow();
  });
  it("texts: English is required, a language the web does not know is ignored, and a text is bounded", () => {
    expect(parseTexts({ en: "A", te: "ఎ", fr: "ignored" }, "t")).toEqual({ en: "A", te: "ఎ" });
    expect(() => parseTexts({ te: "ఎ" }, "t")).toThrow();
    expect(() => parseTexts({ en: "x".repeat(1201) }, "t")).toThrow();
    expect(() => parseTexts({ en: "  " }, "t")).toThrow();
  });
  it("sample_audio: null = no sample; a link plays; an id that is not a link is not playable here yet (a question for C1)", () => {
    expect(parseSampleAudio(null)).toBeNull();
    expect(parseSampleAudio("https://files.example/samples/visit.mp3")).toBe("https://files.example/samples/visit.mp3");
    expect(parseSampleAudio("/samples/visit.mp3")).toBe("/samples/visit.mp3");
    expect(parseSampleAudio("voice_sample_17")).toBeNull();
    expect(parseSampleAudio("javascript:alert(1)")).toBeNull();
  });
  it("the sheet's wire: business_type, sample, own and others are all checked", () => {
    expect(() => parseNewJobSheet({ own: { status: "draft", pack: "p", version: 1, templates: [] } })).toThrow();
    expect(() => parseNewJobSheet(null)).toThrow();
  });
});

describe("the festival calendar", () => {
  it("parses dated entries with a closed season; an unknown season is left out", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rows = parseFestivals({ items: [{ season: "diwali", name: { en: "Diwali" }, date: "2026-11-08" }, { season: "holi", name: { en: "Holi" }, date: "2027-03-04" }] });
    expect(rows).toEqual([{ season: "diwali", name: { en: "Diwali" }, date: "2026-11-08" }]);
    expect(err).toHaveBeenCalledTimes(1);
    expect(() => parseFestivals({ items: [{ season: "diwali", name: { en: "D" }, date: "tomorrow" }, 1] })).not.toThrow();
  });
  it("the mock calendar has one festival two weeks ahead of any day", () => {
    const now = new Date("2026-11-19T10:00:00Z");
    const [f] = parseFestivals(wireFestivals(now));
    expect(f.date).toBe("2026-12-03");
  });
});

describe("the readers", () => {
  it("JOBS off: nothing is read; JOBS=mock: the fixtures; real mode: no festival calendar yet (no call is made)", async () => {
    vi.stubEnv("JOBS", "");
    await expect(readNewJobSheet("tok", "22222222-2222-4222-8222-222222222222")).resolves.toBeNull();
    await expect(readFestivals("tok", "22222222-2222-4222-8222-222222222222")).resolves.toBeNull();
    vi.stubEnv("JOBS", "mock");
    expect((await readNewJobSheet("tok", "22222222-2222-4222-8222-222222222222"))?.own.templates).toHaveLength(11);
    expect((await readFestivals("tok", "22222222-2222-4222-8222-222222222222"))?.[0].season).toBe("diwali");
    vi.stubEnv("JOBS", "1");
    await expect(readFestivals("tok", "22222222-2222-4222-8222-222222222222")).resolves.toBeNull();
  });
});
