import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: request }));

import { wireFestivals, wireNewJobSheet } from "@/lib/jobs/template-fixtures";
import { groupByGoal, isLater, popularOf, shown } from "@/lib/jobs/templates";

import { ApiAuthError, ApiContractError, ApiRequestError } from "./client";
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
  it("sample_audio: null = no sample; {te?, en?, hi?, kn?} of the API's exact path; what comes out is the path on OUR site", () => {
    expect(parseSampleAudio(null)).toBeNull();
    expect(parseSampleAudio(undefined)).toBeNull();
    expect(parseSampleAudio({})).toBeNull();
    expect(parseSampleAudio({ te: "/v1/job-samples/textiles/enquiry_call_right_away.te.mp3", en: "/v1/job-samples/textiles/enquiry_call_right_away.en.mp3" })).toEqual({
      te: "/job-samples/textiles/enquiry_call_right_away.te.mp3",
      en: "/job-samples/textiles/enquiry_call_right_away.en.mp3",
    });
    // a language the web does not know is ignored; a null language is no sample
    expect(parseSampleAudio({ ta: "/v1/job-samples/textiles/x.ta.mp3", en: null, kn: "/v1/job-samples/textiles/x.kn.mp3" })).toEqual({ kn: "/job-samples/textiles/x.kn.mp3" });
  });
  it("sample_audio: only that exact shape; a scheme, a host, //, a backslash, a dot-dot, a query or another language than its key is no sample", () => {
    const bad = [
      "https://files.example/a.mp3",
      "http://localhost:8000/v1/job-samples/textiles/x.te.mp3",
      "//evil.example/v1/job-samples/textiles/x.te.mp3",
      "/v1/job-samples//textiles/x.te.mp3",
      "/v1/job-samples/textiles//x.te.mp3",
      "/v1/job-samples/textiles/x.te.mp3?token=1",
      "/v1/job-samples/textiles/x.te.mp3#a",
      "/v1/job-samples/../textiles/x.te.mp3",
      "/v1/job-samples/textiles/../x.te.mp3",
      "/v1/job-samples\\textiles/x.te.mp3",
      "/v1/job-samples/textiles/x.te.mp3 ",
      "/v1/job-samples/Textiles/x.te.mp3",
      "/v1/job-samples/textiles/x.te.wav",
      "/samples/x.te.mp3",
      "/v1/job-samples/textiles/x.en.mp3", // an English file under the Telugu key
      "javascript:alert(1)",
      "voice_sample_17",
      17,
      ["/v1/job-samples/textiles/x.te.mp3"],
    ];
    for (const v of bad) expect(parseSampleAudio({ te: v }), String(v)).toBeNull();
    expect(() => parseSampleAudio("/v1/job-samples/textiles/x.te.mp3")).toThrow(); // the old shape (one link) is not the contract
  });
  it("sample_audio on a template: it is read with the template; the templates of the five fixture packs have none yet", () => {
    const t = parseTemplate(whatsapp({ preview: { whatsapp: { en: "Hi" }, call: { en: "A\nB" }, sample_audio: { te: "/v1/job-samples/x_pack/t_one.te.mp3" } } }));
    expect(t.sampleAudio).toEqual({ te: "/job-samples/x_pack/t_one.te.mp3" });
  });
  it("the sheet's wire: business_type, sample, own and others are all checked", () => {
    expect(() => parseNewJobSheet({ own: { status: "draft", pack: "p", version: 1, templates: [] } })).toThrow();
    expect(() => parseNewJobSheet(null)).toThrow();
  });
});

describe("the festival calendar", () => {
  it("parses {region, items}: dated entries with a closed season; an unknown season or a date that is not YYYY-MM-DD is left out", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rows = parseFestivals({
      region: "andhra",
      items: [
        { season: "diwali", name: { en: "Diwali", te: "దీపావళి" }, date: "2026-11-08", region: "andhra" },
        { season: "holi", name: { en: "Holi" }, date: "2027-03-04", region: "andhra" },
        { season: "new_year", name: { en: "New Year" }, date: "2027-01-01T00:00:00Z", region: "andhra" },
        { season: "wedding_season", name: { en: "Wedding season" }, date: "2026-12-02", region: "andhra" },
      ],
    });
    expect(rows.map((r) => [r.season, r.date])).toEqual([["diwali", "2026-11-08"], ["wedding_season", "2026-12-02"]]);
    expect(rows[0].name.te).toBe("దీపావళి");
    expect(err).toHaveBeenCalledTimes(2);
    expect(() => parseFestivals({ items: [{ season: "diwali", name: { en: "D" }, date: "tomorrow" }, 1] })).not.toThrow();
    expect(parseFestivals({ region: "india", items: [] })).toEqual([]);
    expect(() => parseFestivals({ region: "india" })).toThrow();
  });
  it("the mock calendar has one festival two weeks ahead of any day", () => {
    const now = new Date("2026-11-19T10:00:00Z");
    const [f] = parseFestivals(wireFestivals(now));
    expect(f.date).toBe("2026-12-03");
  });
});

const T = "22222222-2222-4222-8222-222222222222";
const refused = (status: number, code = "http_error") => new ApiRequestError(status, code, "x");
describe("the readers", () => {
  it("JOBS off: nothing is read; JOBS=mock: the fixtures and no call", async () => {
    vi.stubEnv("JOBS", "");
    await expect(readNewJobSheet("tok", T)).resolves.toBeNull();
    await expect(readFestivals("tok", T)).resolves.toBeNull();
    vi.stubEnv("JOBS", "mock");
    expect((await readNewJobSheet("tok", T))?.own.templates).toHaveLength(11);
    expect((await readFestivals("tok", T))?.[0].season).toBe("diwali");
    expect(request).not.toHaveBeenCalled();
  });
  it("real mode asks the routes: GET /jobs/festivals answers {region, items}; an empty list is the quiet empty state (null)", async () => {
    vi.stubEnv("JOBS", "1");
    request.mockResolvedValueOnce({ region: "telangana", items: [{ season: "diwali", name: { en: "Diwali" }, date: "2026-11-08", region: "telangana" }] });
    expect(await readFestivals("tok", T)).toEqual([{ season: "diwali", name: { en: "Diwali" }, date: "2026-11-08" }]);
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/jobs/festivals`, "tok");
    request.mockResolvedValueOnce({ region: "india", items: [] });
    await expect(readFestivals("tok", T)).resolves.toBeNull();
  });
  it("ONLY an HTTP 404 means 'not there yet' (the same quiet empty state as before); a 403, 501 or 5xx is a real refusal and is thrown as it is", async () => {
    vi.stubEnv("JOBS", "1");
    for (const read of [readNewJobSheet, readFestivals]) {
      request.mockRejectedValueOnce(refused(404, "not_found"));
      await expect(read("tok", T)).resolves.toBeNull();
      for (const status of [403, 501, 500, 502, 503]) {
        request.mockRejectedValueOnce(refused(status));
        await expect(read("tok", T), `${read.name} ${status}`).rejects.toMatchObject({ status });
      }
    }
  });
  it("a rejected session is thrown, for both reads", async () => {
    vi.stubEnv("JOBS", "1");
    request.mockRejectedValueOnce(new ApiAuthError());
    await expect(readFestivals("tok", T)).rejects.toBeInstanceOf(ApiAuthError);
  });
  it("a festival answer that is not the contract's shape is logged, then no row", async () => {
    vi.stubEnv("JOBS", "1");
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    request.mockResolvedValueOnce("junk");
    await expect(readFestivals("tok", T)).resolves.toBeNull();
    expect(String(err.mock.calls[0][0])).toContain("jobs/festivals");
  });
});

describe("the New job sheet's read when the API cannot be read", () => {
  it("a rejected session is thrown (the person signs in again), not answered as 'no ideas'", async () => {
    vi.stubEnv("JOBS", "1");
    request.mockRejectedValueOnce(new ApiAuthError());
    await expect(readNewJobSheet("tok", T)).rejects.toBeInstanceOf(ApiAuthError);
  });
  it("an answer that is not the contract's shape is logged, then no ideas; a plain failure is thrown (only a 404 is 'not there yet')", async () => {
    vi.stubEnv("JOBS", "1");
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    request.mockResolvedValueOnce({ own: "junk" });
    await expect(readNewJobSheet("tok", T)).resolves.toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toContain("jobs/templates");
    request.mockRejectedValueOnce(new Error("down"));
    await expect(readNewJobSheet("tok", T)).rejects.toThrow("down");
    expect(err).toHaveBeenCalledTimes(1);
    request.mockRejectedValueOnce(new ApiContractError("x"));
    await expect(readNewJobSheet("tok", T)).resolves.toBeNull();
    expect(err).toHaveBeenCalledTimes(2);
  });
  it("a good answer is read", async () => {
    vi.stubEnv("JOBS", "1");
    request.mockResolvedValueOnce(wireNewJobSheet());
    expect((await readNewJobSheet("tok", T))?.own.templates).toHaveLength(11);
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/jobs/templates`, "tok");
  });
  it("in real mode a made-up score never reaches a card: the fixtures' 92, 87, 78 are dropped (only the mock keeps them, labelled Example)", async () => {
    vi.stubEnv("JOBS", "1");
    request.mockResolvedValueOnce(wireNewJobSheet()); // the fixtures carry the placeholder scores
    const real = await readNewJobSheet("tok", T);
    const lf = real!.own.templates.find((t) => t.kind === "researcher")!;
    expect(lf.examples.map((e) => e.fit)).toEqual([null, null, null]);
    vi.stubEnv("JOBS", "mock");
    const mock = await readNewJobSheet("tok", T);
    expect(mock!.own.templates.find((t) => t.kind === "researcher")!.examples.map((e) => e.fit)).toEqual([92, 87, 78]);
  });
});

const finder = (over: Record<string, unknown> = {}) => ({
  id: "find_shops",
  kind: "researcher",
  goal: "find_new_customers",
  popular: false,
  title: { en: "Find shops" },
  benefit: { en: "B" },
  ask: { en: "Find saree shops near me" },
  preview: { sample_audio: null },
  examples_real: true,
  examples: [
    { name: "Lotus Bay Sarees", area: "Market Road", fit: 91, why: { code: "near_you", params: { km: 3 } } },
    { name: "Peacock Lane", area: "Old Town", fit: 74, why: { code: "well_rated", params: { rating: "4.6", count: 212 } } },
    { name: "Silk Thread", area: "Station Road", fit: 60, why: { code: "from_the_future", params: {} } },
  ],
  needs: ["lead_source"],
  finds_out: [],
  ...over,
});
describe("researcher cards: real prospects and invented ones", () => {
  it("examples_real: name, area, fit 0..100 and why {code, params} are read; an unknown code stays a code (the card draws the generic line)", () => {
    const t = parseTemplate(finder(), true);
    expect(t.examplesReal).toBe(true);
    expect(t.examples.map((e) => e.fit)).toEqual([91, 74, 60]);
    expect(t.examples[0].why).toEqual({ code: "near_you", params: { km: 3 } });
    expect(t.examples[1].why).toEqual({ code: "well_rated", params: { rating: "4.6", count: 212 } });
    expect(t.examples[2].why).toEqual({ code: "from_the_future", params: {} });
  });
  it("params are short words or whole numbers only; anything else is dropped", () => {
    const t = parseTemplate(finder({ examples: [{ name: "A", area: "B", fit: 50, why: { code: "category_match", params: { category: "Saree shop", n: 1.5, deep: { a: 1 }, long: "x".repeat(61), ok: 4 } } }] }), true);
    expect(t.examples[0].why).toEqual({ code: "category_match", params: { category: "Saree shop", ok: 4 } });
  });
  it("a fit outside 0..100 is not the contract's shape", () => {
    expect(() => parseTemplate(finder({ examples: [{ name: "A", area: "B", fit: 101, why: { code: "open_business" } }] }), true)).toThrow();
  });
  it("NOT real (examples_real false or missing): the invented examples keep their words, and in real mode NO fit comes out even if one is sent", () => {
    const invented = finder({ examples_real: false, examples: [{ name: "Lotus (example)", area: "Market Road", fit: 92, why: { en: "A saree shop", te: "చీరల షాప్" } }] });
    const t = parseTemplate(invented, true);
    expect(t.examplesReal).toBe(false);
    expect(t.examples[0].fit).toBeNull();
    expect(t.examples[0].why).toEqual({ en: "A saree shop", te: "చీరల షాప్" });
    expect(parseTemplate({ ...invented, examples_real: undefined }, true).examplesReal).toBe(false);
    // the mock reads the fixtures' placeholder score as before (labelled Example on screen)
    expect(parseTemplate(invented).examples[0].fit).toBe(92);
  });
  it("a template may carry its own sample item ('bridal silk sarees'); without it null", () => {
    expect(parseTemplate(whatsapp({ sample_item: { en: "bridal silk sarees", te: "బ్రైడల్ పట్టు చీరలు" } })).sampleItem).toEqual({ en: "bridal silk sarees", te: "బ్రైడల్ పట్టు చీరలు" });
    expect(parseTemplate(whatsapp()).sampleItem).toBeNull();
  });
});
