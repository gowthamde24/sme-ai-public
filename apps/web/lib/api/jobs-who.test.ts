import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ req: vi.fn(), mode: { v: "mock" as "off" | "mock" | "on" } }));
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => h.req(...a) }));
vi.mock("@/lib/screens/flag", () => ({ jobsScreens: () => h.mode.v }));

import { mockJobDetail } from "@/lib/jobs/detail-mock";
import { WIRE_JOBS } from "@/lib/jobs/fixtures";
import { MOCK_JOBS } from "@/lib/jobs/mock";
import { WHO_LANGUAGES, WHO_NUMBERS, WHO_TONES, WHO_VOICES, readSpeaksPatch, speaksBody, speaksPatch, whoSample } from "@/lib/jobs/who";
import { parseWhoVoices } from "@/lib/api/job-who";
import { parseSpeaks as parseSpeaksForTest } from "./jobs-parse";

import { parseJobDetail, parseWho, patchJob } from "./jobs";
import { parseJobMessage } from "./jobs-parse";

const T = "22222222-2222-4222-8222-222222222222";
const J = MOCK_JOBS[0].id;
const speaks = { language: "te", tone: "friendly", voice: "female_warm", number: "shop" };
const speaksNamed = { ...speaks, voice_name: "Soft woman" };
const numbers = [{ key: "shop", masked: "+91 98480 xxx10" }];

beforeEach(() => {
  h.req.mockReset();
  h.mode.v = "mock";
});

describe("Who talks: what the API sends", () => {
  it("reads speaks {language, tone, voice, number} and the numbers the shop has", () => {
    expect(parseWho(speaks, numbers)).toEqual({ language: "te", tone: "friendly", voice: "female_warm", voiceName: null, number: "shop", numbers: [{ key: "shop", masked: "+91 98480 xxx10" }] });
  });
  it("voice is the catalogue id and voice_name the owner's word for it (the chip shows the NAME); an odd name is not used, never a throw", () => {
    expect(parseWho(speaksNamed, numbers)).toMatchObject({ voice: "female_warm", voiceName: "Soft woman" });
    expect(parseWho({ ...speaks, voice_name: "<b>x</b>" }, numbers)?.voiceName).toBeNull();
    expect(parseWho({ ...speaks, voice_name: 7 }, numbers)?.voiceName).toBeNull();
    expect(parseWho({ ...speaks, voice_name: "x".repeat(41) }, numbers)?.voiceName).toBeNull();
  });
  it("the second number is not a product: only the shop's number is read; a `second` the API should never send reads as the shop's own, and is not listed", () => {
    expect(parseWho({ ...speaks, number: "second" }, [{ key: "second", masked: "+91 90000 xxx45" }, ...numbers])).toMatchObject({ number: "shop", numbers: [{ key: "shop" }] });
    expect(parseWho({ ...speaks, number: undefined }, numbers)?.number).toBe("shop");
    expect(WHO_NUMBERS).toEqual(["shop"]);
  });
  it("a job in the list (parseSpeaks) is lenient too: an odd value is null, never a throw, and the voice shows by name", () => {
    expect(parseSpeaksForTest({ language: "te", voice: "female_warm", voice_name: "Soft woman", number: "shop" })).toEqual({ language: "te", voice: "female_warm", voiceName: "Soft woman", number: "shop" });
    expect(parseSpeaksForTest({ language: "te", voice: "female_warm", number: "second" })).toEqual({ language: "te", voice: "female_warm", voiceName: null, number: null });
    expect(parseSpeaksForTest({ language: 7, voice: { a: 1 }, voice_name: ["x"], number: "<x>" })).toEqual({ language: null, voice: null, voiceName: null, number: null });
    expect(parseSpeaksForTest("none")).toBeNull();
    expect(parseSpeaksForTest([])).toBeNull();
  });
  it("the three voices by name come from the catalogue answer in any of its shapes; unknown ids and odd names are left out", () => {
    const rows = [{ id: "female_warm", name: "Soft woman", sample: "/v1/x.mp3" }, { id: "female_clear", name: "Bright woman" }, { id: "male_calm", name: "Calm man" }];
    expect(parseWhoVoices({ voices: rows })).toEqual([{ id: "female_warm", name: "Soft woman" }, { id: "female_clear", name: "Bright woman" }, { id: "male_calm", name: "Calm man" }]);
    expect(parseWhoVoices(rows)?.length).toBe(3);
    expect(parseWhoVoices({ languages: [{ language: "te", voices: [rows[0]] }, { language: "en", voices: [rows[0], rows[2]] }] })?.map((v) => v.id)).toEqual(["female_warm", "male_calm"]);
    expect(parseWhoVoices({ voices: [{ id: "te-janvi", name: "Janvi" }, { id: "male_calm", name: "<x>" }, { id: "male_calm" }] })).toBeNull();
    expect(parseWhoVoices(null)).toBeNull();
    expect(parseWhoVoices({ voices: "x" })).toBeNull();
  });
  it("a job that does not talk (no speaks) or a word the web does not know draws no card instead of breaking the page", () => {
    expect(parseWho(undefined, numbers)).toBeNull();
    expect(parseWho(null, null)).toBeNull();
    expect(parseWho({ ...speaks, voice: "male_lively" }, numbers)).toBeNull();
    expect(parseWho({ ...speaks, language: "ta" }, numbers)).toBeNull();
    expect(parseWho({ ...speaks, tone: "rude" }, numbers)).toBeNull();
  });
  it("a number row it cannot read is left out, a repeated one is kept once, and no numbers is an empty list", () => {
    expect(parseWho(speaks, [...numbers, numbers[0], { key: "third", masked: "+91" }, { key: "shop", masked: "<b>" }])?.numbers).toHaveLength(1);
    expect(parseWho(speaks, undefined)?.numbers).toEqual([]);
  });
  it("the made-up job pages carry it through the real parser, and the researcher (it talks to nobody) has none", () => {
    for (const j of WIRE_JOBS) {
      const d = mockJobDetail(j.id as string)!;
      if (j.kind === "researcher") expect(d.who).toBeNull();
      else {
        expect(d.who, j.kind as string).not.toBeNull();
        expect(d.who?.numbers.map((n) => n.key)).toEqual(["shop"]);
        expect(d.who?.voiceName, j.kind as string).toMatch(/woman|man/);
      }
    }
    const wire = { id: J, kind: "speed_to_lead", custom_name: null, enabled: true, status: "running", result: { code: "calls_today", params: {} }, business_name: "X", cost: { minutes_used: 0, minutes_included: 60, rupees: null }, speaks, numbers };
    expect(parseJobDetail(wire).who?.voice).toBe("female_warm");
    expect(parseJobDetail({ ...wire, speaks: undefined }).who).toBeNull();
  });
});

describe("no second number anywhere (it is not a product)", () => {
  it("not in the words, and not in any mock screen of the jobs", () => {
    const dir = path.resolve(import.meta.dirname, "../../test/screens/__text__");
    for (const f of readdirSync(dir).filter((n) => n.startsWith("jobs"))) expect(readFileSync(path.join(dir, f), "utf8"), f).not.toMatch(/second number|=second/i);
    const words = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../i18n/strings/app.json"), "utf8")) as Record<string, unknown>;
    expect(Object.keys(words).filter((k) => /^jobs\.(who|page)\.number\.second$/.test(k))).toEqual([]);
  });
});

describe("JobDetail.message {id, title {en, te?}} | null (A8)", () => {
  it("reads the own message the job sends; anything odd is null (the page says nothing), never an error", () => {
    expect(parseJobMessage({ id: "6a1b2c3d-0000-4000-8000-000000000001", title: { en: "Visit reminder", te: "Visit రిమైండర్" } })).toEqual({ id: "6a1b2c3d-0000-4000-8000-000000000001", title: { en: "Visit reminder", te: "Visit రిమైండర్" } });
    expect(parseJobMessage({ id: "m-1", title: { en: "Only English" } })?.title.te).toBeNull();
    for (const odd of [undefined, null, "m-1", [], { id: "x y", title: { en: "A" } }, { id: "m-1" }, { id: "m-1", title: { en: "" } }, { id: "m-1", title: { en: "x".repeat(61) } }, { id: 5, title: { en: "A" } }]) expect(parseJobMessage(odd)).toBeNull();
  });
  it("the job page's parser carries it, and the made-up visits job uses its approved visit reminder", () => {
    const wire = { id: J, kind: "store_visits", custom_name: null, enabled: true, status: "running", result: { code: "reminders_today", params: {} }, business_name: "X", cost: { minutes_used: 0, minutes_included: 60, rupees: null }, speaks, numbers };
    expect(parseJobDetail(wire).message).toBeNull();
    expect(parseJobDetail({ ...wire, message: { id: "m-1", title: { en: "Visit reminder" } } }).message?.id).toBe("m-1");
    expect(parseJobDetail({ ...wire, message: "junk" }).message).toBeNull();
    expect(mockJobDetail(MOCK_JOBS.find((j) => j.kind === "store_visits")!.id)?.message?.title.en).toBe("Visit reminder");
    expect(mockJobDetail(MOCK_JOBS.find((j) => j.kind === "speed_to_lead")!.id)?.message).toBeNull();
  });
  it("`PATCH /jobs/{id} {message_id}`: the id of an approved own message, or null for the default; mock sends nothing", async () => {
    h.mode.v = "on";
    h.req.mockResolvedValue({ id: J, kind: "offers", custom_name: null, enabled: true, status: "running", result: { code: "offer_ready", params: {} } });
    await patchJob("tok", T, J, { messageId: "6a1b2c3d-0000-4000-8000-000000000001" });
    expect(JSON.parse(h.req.mock.calls[0][2].body)).toEqual({ message_id: "6a1b2c3d-0000-4000-8000-000000000001" });
    await patchJob("tok", T, J, { messageId: null });
    expect(JSON.parse(h.req.mock.calls[1][2].body)).toEqual({ message_id: null });
    await patchJob("tok", T, J, { name: "X" });
    expect(JSON.parse(h.req.mock.calls[2][2].body)).toEqual({ name: "X" });
  });
});

describe("Who talks: the change", () => {
  it("one choice is one patch of closed words; anything else is no patch", () => {
    expect(speaksPatch("tone", "casual")).toEqual({ tone: "casual" });
    expect(speaksPatch("voice", "male_calm")).toEqual({ voice: "male_calm" });
    // the number is not a choice: it is never sent, whatever the word (a PATCH to `second` is 422 setting_invalid)
    expect(speaksPatch("number" as never, "shop")).toBeNull();
    expect(speaksPatch("number" as never, "second")).toBeNull();
    expect(readSpeaksPatch({ number: "second" })).toBeNull();
    expect(speaksPatch("language", "customer")).toEqual({ language: "customer" });
    expect(speaksPatch("tone", "Casual")).toBeNull();
    expect(speaksPatch("voice", "own_voice")).toBeNull();
    for (const [key, list] of [["language", WHO_LANGUAGES], ["tone", WHO_TONES], ["voice", WHO_VOICES]] as const) for (const v of list) expect(speaksPatch(key, v)).toEqual({ [key]: v });
  });
  it("a patch from outside is read the same way: closed words only, at least one, nothing else", () => {
    expect(readSpeaksPatch({ language: "te" })).toEqual({ language: "te" });
    expect(readSpeaksPatch({ language: "te", tone: "casual" })).toEqual({ language: "te", tone: "casual" });
    expect(readSpeaksPatch({})).toBeNull();
    expect(readSpeaksPatch({ language: "fr" })).toBeNull();
    expect(readSpeaksPatch({ language: "te", extra: "x" })).toBeNull();
    expect(readSpeaksPatch({ language: 7 })).toBeNull();
    expect(readSpeaksPatch(["te"])).toBeNull();
    expect(readSpeaksPatch(null)).toBeNull();
  });
  it("goes on the wire as PATCH /jobs/{id} {speaks: {only what changed}}; mock sends nothing", async () => {
    expect(speaksBody({ tone: "casual" })).toEqual({ speaks: { tone: "casual" } });
    await patchJob("tok", T, J, { speaks: { tone: "casual" } });
    expect(h.req).not.toHaveBeenCalled();
    h.mode.v = "on";
    h.req.mockResolvedValue({ id: J, kind: "speed_to_lead", custom_name: null, enabled: true, status: "running", result: { code: "calls_today", params: {} }, speaks: { ...speaks, tone: "casual" } });
    await patchJob("tok", T, J, { speaks: { tone: "casual" } });
    const [path, , init] = h.req.mock.calls[0];
    expect([path, init.method]).toEqual([`/v1/tenants/${T}/jobs/${J}`, "PATCH"]);
    expect(JSON.parse(init.body)).toEqual({ speaks: { tone: "casual" } });
  });
});

describe("Who talks: the play buttons reuse the voice sample route", () => {
  it("builds the route's own query: the voice, a language, warm or crisp, a name only when the route accepts it", () => {
    expect(whoSample("/s", { language: "te", tone: "friendly" }, "female_warm", "en", "Priya")).toBe("/s?voice=female_warm&lang=te&tone=warm&name=Priya");
    expect(whoSample("/s", { language: "en", tone: "respectful" }, "male_calm", "te", null)).toBe("/s?voice=male_calm&lang=en&tone=crisp");
    // the customer's own language: the person's language when a call language, else English
    expect(whoSample("/s", { language: "customer", tone: "casual" }, "female_clear", "kn", null)).toContain("lang=kn");
    expect(whoSample("/s", { language: "customer", tone: "casual" }, "female_clear", "de", null)).toContain("lang=en");
    // a name the route would refuse (a dot or an apostrophe) is left out, the sample still plays
    expect(whoSample("/s", { language: "te", tone: "friendly" }, "female_warm", "te", "Dr. Rao")).not.toContain("name=");
  });
});
