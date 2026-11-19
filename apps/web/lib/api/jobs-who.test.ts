import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ req: vi.fn(), mode: { v: "mock" as "off" | "mock" | "on" } }));
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => h.req(...a) }));
vi.mock("@/lib/screens/flag", () => ({ jobsScreens: () => h.mode.v }));

import { mockJobDetail } from "@/lib/jobs/detail-mock";
import { WIRE_JOBS } from "@/lib/jobs/fixtures";
import { MOCK_JOBS } from "@/lib/jobs/mock";
import { WHO_LANGUAGES, WHO_NUMBERS, WHO_TONES, WHO_VOICES, readSpeaksPatch, speaksBody, speaksPatch, whoSample } from "@/lib/jobs/who";

import { parseJobDetail, parseWho, patchJob } from "./jobs";

const T = "22222222-2222-4222-8222-222222222222";
const J = MOCK_JOBS[0].id;
const speaks = { language: "te", tone: "friendly", voice: "female_warm", number: "shop" };
const numbers = [{ key: "shop", masked: "+91 98480 xxx10" }, { key: "second", masked: "+91 90000 xxx45" }];

beforeEach(() => {
  h.req.mockReset();
  h.mode.v = "mock";
});

describe("Who talks: what the API sends", () => {
  it("reads speaks {language, tone, voice, number} and the numbers the shop has", () => {
    expect(parseWho(speaks, numbers)).toEqual({ language: "te", tone: "friendly", voice: "female_warm", number: "shop", numbers: [{ key: "shop", masked: "+91 98480 xxx10" }, { key: "second", masked: "+91 90000 xxx45" }] });
  });
  it("a job that does not talk (no speaks) or a word the web does not know draws no card instead of breaking the page", () => {
    expect(parseWho(undefined, numbers)).toBeNull();
    expect(parseWho(null, null)).toBeNull();
    expect(parseWho({ ...speaks, voice: "male_lively" }, numbers)).toBeNull();
    expect(parseWho({ ...speaks, language: "ta" }, numbers)).toBeNull();
    expect(parseWho({ ...speaks, tone: "rude" }, numbers)).toBeNull();
    expect(parseWho({ ...speaks, number: "third" }, numbers)).toBeNull();
  });
  it("a number row it cannot read is left out, a repeated one is kept once, and no numbers is an empty list", () => {
    expect(parseWho(speaks, [...numbers, numbers[0], { key: "third", masked: "+91" }, { key: "shop", masked: "<b>" }])?.numbers).toHaveLength(2);
    expect(parseWho(speaks, undefined)?.numbers).toEqual([]);
  });
  it("the made-up job pages carry it through the real parser, and the researcher (it talks to nobody) has none", () => {
    for (const j of WIRE_JOBS) {
      const d = mockJobDetail(j.id as string)!;
      if (j.kind === "researcher") expect(d.who).toBeNull();
      else {
        expect(d.who, j.kind as string).not.toBeNull();
        expect(d.who?.numbers.map((n) => n.key)).toEqual(["shop", "second"]);
      }
    }
    const wire = { id: J, kind: "speed_to_lead", custom_name: null, enabled: true, status: "running", result: { code: "calls_today", params: {} }, business_name: "X", cost: { minutes_used: 0, minutes_included: 60, rupees: null }, speaks, numbers };
    expect(parseJobDetail(wire).who?.voice).toBe("female_warm");
    expect(parseJobDetail({ ...wire, speaks: undefined }).who).toBeNull();
  });
});

describe("Who talks: the change", () => {
  it("one choice is one patch of closed words; anything else is no patch", () => {
    expect(speaksPatch("tone", "casual")).toEqual({ tone: "casual" });
    expect(speaksPatch("voice", "male_calm")).toEqual({ voice: "male_calm" });
    expect(speaksPatch("number", "second")).toEqual({ number: "second" });
    expect(speaksPatch("language", "customer")).toEqual({ language: "customer" });
    expect(speaksPatch("tone", "Casual")).toBeNull();
    expect(speaksPatch("voice", "own_voice")).toBeNull();
    for (const [key, list] of [["language", WHO_LANGUAGES], ["tone", WHO_TONES], ["voice", WHO_VOICES], ["number", WHO_NUMBERS]] as const) for (const v of list) expect(speaksPatch(key, v)).toEqual({ [key]: v });
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
