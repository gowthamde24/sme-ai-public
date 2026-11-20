import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ req: vi.fn(), mode: { v: "mock" as "off" | "mock" | "on" } }));
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => h.req(...a) }));
vi.mock("@/lib/screens/flag", () => ({ jobsScreens: () => h.mode.v }));

import { mockJobDetail } from "@/lib/jobs/detail-mock";
import { MOCK_JOBS, MOCK_PAGE_JOBS } from "@/lib/jobs/mock";
import { JOB_KINDS } from "@/lib/jobs/types";

import { addJobFaq, getJob, parseJobDetail, patchJob, removeJobFaq, testJob } from "./jobs";

const T = "22222222-2222-4222-8222-222222222222";
const J = MOCK_JOBS[0].id;
const wire = {
  id: J,
  kind: "speed_to_lead",
  custom_name: null,
  enabled: true,
  status: "running",
  result: { code: "calls_today", params: { called: 6 } },
  needs_you: 0,
  last_run_at: "2026-11-19T04:20:00Z",
  business_name: "Neelambari Silks",
  what_it_does: { code: "speed_to_lead" },
  says: [{ language: "en", channel: "call", text: "Namaskaram, this is the AI assistant of Neelambari Silks." }],
  settings: {
    main: [{ key: "response", type: "choice", value: "right_away", options: ["right_away", "after_5"] }],
    more: [{ key: "notify_visit", type: "toggle", value: true }],
  },
  when: { from_hour: "09:30", to_hour: "19:00", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], pace_per_hour: 10 },
  effect: { inputs: { who: "Ravi", event_at: "20:15" } },
  finds_out: [{ key: "budget", enabled: true }],
  faqs: [{ id: "f1", question: "Open on Sundays?", answer: "Yes." }],
  results: { days: 7, numbers: { called: 38, last_search_at: "2026-11-12T08:00:00Z", weekly: false }, items: [{ customer: "Ravi", status: "done", detail_code: "visit_booked", params: { visit_at: "2026-11-21T10:30:00Z" }, at: "2026-11-19T04:20:00Z" }] },
  failure: null,
  test_channel: "call",
  cost: { minutes_used: 8, minutes_included: 60, rupees: null },
};

beforeEach(() => {
  h.req.mockReset();
  h.mode.v = "mock";
});

describe("one job's page: what the API sends (the adapter)", () => {
  it("reads the whole page in one call: codes and numbers, closed words, nothing as prose", () => {
    const d = parseJobDetail(wire);
    expect(d.job.kind).toBe("speed_to_lead");
    expect(d.business).toBe("Neelambari Silks");
    expect(d.whatCode).toBe("speed_to_lead");
    expect(d.settings.map((s) => [s.key, s.more])).toEqual([["response", false], ["notify_visit", true]]);
    expect(d.effectInputs).toEqual({ who: "Ravi", event_at: "20:15" });
    expect(d.results.numbers).toEqual([{ key: "called", value: 38 }]);
    expect(d.results.items[0]).toMatchObject({ status: "done", detailCode: "visit_booked" });
    expect(d.test).toBe("call");
  });
  it("cost is the month so far {minutes_used, minutes_included, rupees|null}: rupees on a paid plan; it is required, and a plan's per-estimate shape is not it", () => {
    expect(parseJobDetail(wire).cost).toEqual({ minutesUsed: 8, minutesIncluded: 60, rupees: null });
    // a plan with no included minutes (Pay as you go) sends null: the page must still draw (staging 20 Nov: "Unexpected cost.minutes_included" crashed it)
    expect(parseJobDetail({ ...wire, cost: { minutes_used: 12, minutes_included: null, rupees: null } }).cost).toEqual({ minutesUsed: 12, minutesIncluded: null, rupees: null });
    expect(parseJobDetail({ ...wire, cost: { minutes_used: 0, minutes_included: 0, rupees: 190 } }).cost).toEqual({ minutesUsed: 0, minutesIncluded: 0, rupees: 190 });
    expect(() => parseJobDetail({ ...wire, cost: undefined })).toThrow();
    expect(() => parseJobDetail({ ...wire, cost: { minutes: 34, minutes_included: 60, rupees: null } })).toThrow();
  });
  it("settings are {main, more} with no `area` (which list a setting is in says where it goes); hours are the settings from_hour and to_hour; `when` is only read-only input", () => {
    const hours = [{ key: "from_hour", type: "choice", value: "09:30", options: ["09:00", "09:30"] }, { key: "to_hour", type: "choice", value: "19:00", options: ["18:00", "19:00"] }];
    const d = parseJobDetail({ ...wire, settings: { main: [...hours], more: [] }, when: { from_hour: "07:00", to_hour: "08:00", days: ["mon"], pace_per_hour: 3 } });
    expect(d.settings.map((s) => [s.key, s.value, s.more])).toEqual([["from_hour", "09:30", false], ["to_hour", "19:00", false]]);
    // an `area` on a setting is not read: the list it came in is the truth
    expect(parseJobDetail({ ...wire, settings: { main: [{ ...hours[0], area: "more" }], more: [] } }).settings[0].more).toBe(false);
    // a toggle's value is a BOOLEAN on the wire (no options); the page keeps on/off for its ticks
    expect(parseJobDetail({ ...wire, settings: { main: [], more: [{ key: "stop_after", type: "toggle", value: false }] } }).settings[0]).toMatchObject({ value: "off", options: ["on", "off"], more: true });
    expect(parseJobDetail(wire).settings[1]).toMatchObject({ key: "notify_visit", type: "toggle", value: "on" });
    // the old words are not the contract any more: "on"/"off" strings are refused, never guessed
    expect(() => parseJobDetail({ ...wire, settings: { main: [], more: [{ key: "stop_after", type: "toggle", value: "on", options: ["on", "off"] }] } })).toThrow();
    // the old flat array (with `area`) is not the contract: it is refused, never guessed
    expect(() => parseJobDetail({ ...wire, settings: [{ key: "response", type: "choice", value: "right_away", options: ["right_away"], area: "main" }] })).toThrow();
    expect(() => parseJobDetail({ ...wire, settings: { main: [{ key: "x", type: "slider", value: "1", options: ["1"] }], more: [] } })).toThrow();
  });
  it("results.numbers keeps whole numbers only (the researcher's free-search state has a date and a flag in it)", () => {
    expect(parseJobDetail(wire).results.numbers).toEqual([{ key: "called", value: 38 }]);
  });
  it("a page with only the list fields still reads (every other part is empty), and a job that did not fail has no failure", () => {
    const d = parseJobDetail({ ...wire, says: undefined, settings: undefined, effect: undefined, finds_out: undefined, faqs: undefined, results: undefined, test_channel: undefined, what_it_does: undefined });
    expect(d.says).toEqual([]);
    expect(d.settings).toEqual([]);
    expect(d.effectInputs).toBeNull();
    expect(d.results).toEqual({ days: 7, numbers: [], items: [] });
    expect(d.failure).toBeNull();
    expect(d.test).toBeNull();
    expect(d.whatCode).toBe("custom");
  });
  it("refuses what it has no words for: a result status, a setting value that is not one of its options, a channel, a long business name", () => {
    expect(() => parseJobDetail({ ...wire, results: { ...wire.results, items: [{ ...wire.results.items[0], status: "exploded" }] } })).toThrow();
    expect(() => parseJobDetail({ ...wire, settings: { main: [{ key: "response", type: "choice", value: "never", options: ["right_away"] }], more: [] } })).toThrow();
    expect(() => parseJobDetail({ ...wire, says: [{ language: "en", channel: "pigeon", text: "x" }] })).toThrow();
    expect(() => parseJobDetail({ ...wire, test_channel: "fax" })).toThrow();
    expect(() => parseJobDetail({ ...wire, test_channel: "message" })).toThrow();
    expect(parseJobDetail({ ...wire, test_channel: "whatsapp" }).test).toBe("whatsapp");
    expect(() => parseJobDetail({ ...wire, business_name: "x".repeat(81) })).toThrow();
  });
  it("a failed job carries its reason code and the people it could not reach", () => {
    const d = parseJobDetail({ ...wire, kind: "followups", status: "failed", fix: { code: "template_needed", count: 1 }, failure: { code: "template_needed", params: { count: 1 }, items: [{ customer: "Padma", detail_code: "asked_price", params: { days: 2 }, at: "2026-11-19T03:42:00Z" }] } });
    expect(d.failure?.items[0]).toMatchObject({ customer: "Padma", detailCode: "asked_price" });
    expect(d.job.fix).toEqual({ code: "template_needed", count: 1 });
  });
});

describe("the mock pages", () => {
  it("every mock job has a page that its own parser accepts shape-wise: a name, a sentence code, and numbers; an unknown id has none", () => {
    for (const j of MOCK_JOBS) {
      const d = mockJobDetail(j.id)!;
      expect(d.job.id).toBe(j.id);
      expect(d.whatCode.length).toBeGreaterThan(0);
      for (const s of d.settings) expect(s.options).toContain(s.value);
      expect(d.cost.minutesIncluded).toBeGreaterThan(0);
    }
    expect(mockJobDetail("66666666-6666-4666-8666-666666666699")).toBeNull();
    expect(JOB_KINDS).toContain(mockJobDetail(J)!.job.kind);
  });
  it("speed to lead, followups, offers, store visits, answer calls and researcher have their own page; the rest answers with the generic one", () => {
    const kinds = Object.fromEntries(MOCK_JOBS.map((j) => [j.kind, mockJobDetail(j.id)!]));
    for (const k of ["speed_to_lead", "followups", "offers", "store_visits", "answer_calls", "researcher"]) expect(kinds[k].settings.length).toBeGreaterThan(0);
    expect(kinds.speed_to_lead.settings.filter((s) => !s.more)).toHaveLength(4);
    expect(kinds.payment_reminders).toBeUndefined();
    expect(kinds.researcher.says).toEqual([]);
    expect(kinds.followups.failure?.items).toHaveLength(2);
  });
  it("what a customer hears always says it is the AI assistant of the business, with the job's name when it has one", () => {
    const named = mockJobDetail(MOCK_JOBS.find((j) => j.customName === "Priya")!.id)!;
    expect(named.says[0].text).toContain("Priya, the AI assistant of Neelambari Silks");
    expect(mockJobDetail(J)!.says.every((s) => /AI|असिस्टेंट|అసిస్టెంట్|ಅಸಿಸ್ಟೆಂಟ್/.test(s.text))).toBe(true);
    expect(mockJobDetail(J)!.says[0].text).toContain("the AI assistant of Neelambari Silks");
  });
});

describe("reading and changing one job", () => {
  it("off: nothing; mock: the made-up page and no request; on: the API's page, null when it has none, and a page it cannot read is an error", async () => {
    h.mode.v = "off";
    expect(await getJob("tok", T, J)).toBeNull();
    h.mode.v = "mock";
    expect((await getJob("tok", T, J))?.job.id).toBe(J);
    expect(await getJob("tok", T, "nope")).toBeNull();
    expect(h.req).not.toHaveBeenCalled();
    h.mode.v = "on";
    h.req.mockResolvedValueOnce(wire);
    expect((await getJob("tok", T, J))?.job.id).toBe(J);
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${T}/jobs/${J}`, "tok");
    h.req.mockRejectedValueOnce(new Error("404"));
    expect(await getJob("tok", T, J)).toBeNull();
    h.req.mockResolvedValueOnce({ ...wire, kind: "magic" });
    await expect(getJob("tok", T, J)).rejects.toThrow();
  });
  it("a rename in mock mode answers with the words recomposed and asks nobody; the plain name clears it", async () => {
    const r = await patchJob("tok", T, J, { name: "Priya" });
    expect(r.customName).toBe("Priya");
    expect(r.says?.[0].text).toContain("Priya, the AI assistant of Neelambari Silks");
    expect((await patchJob("tok", T, J, { name: null })).customName).toBeNull();
    expect((await patchJob("tok", T, J, { enabled: false })).status).toBe("paused");
    expect((await patchJob("tok", T, J, { settings: { response: "after_5" } })).says).toBeNull();
    expect(h.req).not.toHaveBeenCalled();
    await expect(patchJob("tok", T, "nope", { name: "x" })).rejects.toThrow();
  });
  it("mock: every job of the Jobs page can be renamed, switched or given a new voice, the named ones (Ravi, Diwali calls) too; nothing is stored (a mock change lives on the screen only)", async () => {
    const named = MOCK_PAGE_JOBS.filter((j) => !MOCK_JOBS.some((m) => m.id === j.id));
    expect(named.map((j) => j.customName)).toEqual(["Ravi", "Diwali calls"]);
    for (const j of named) {
      expect((await patchJob("tok", T, j.id, { name: "Anil" })).customName).toBe("Anil");
      expect((await patchJob("tok", T, j.id, { enabled: true })).status).toBe("running");
      expect(await patchJob("tok", T, j.id, { speaks: { voice: "te-ramya" } })).toMatchObject({ customName: j.customName, enabled: j.enabled });
    }
    expect(h.req).not.toHaveBeenCalled();
  });
  it("on: the API gets the change in its own words (an empty name clears it) and answers with the job", async () => {
    h.mode.v = "on";
    h.req.mockResolvedValue({ ...wire, custom_name: "Priya", says: wire.says });
    const r = await patchJob("tok", T, J, { name: "Priya", settings: { response: "after_5" }, findsOut: { budget: false } });
    expect(r.customName).toBe("Priya");
    expect(r.says).toHaveLength(1);
    const [, , init] = h.req.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ name: "Priya", settings: { response: "after_5" }, finds_out: { budget: false } });
    await patchJob("tok", T, J, { name: null });
    expect(JSON.parse(h.req.mock.calls[1][2].body)).toEqual({ name: "" });
    // a toggle is sent as a boolean (true/false), a choice as its word
    await patchJob("tok", T, J, { settings: { notify_visit: false, response: "after_5" } });
    expect(JSON.parse(h.req.mock.calls[2][2].body)).toEqual({ settings: { notify_visit: false, response: "after_5" } });
  });
  it("FAQs and the test: mock mode stores and sends nothing; on: the right routes", async () => {
    expect((await addJobFaq("tok", T, J, "Q?", "A.")).question).toBe("Q?");
    await removeJobFaq("tok", T, J, "faq-1");
    expect(await testJob("tok", T, J, "call")).toEqual({ channel: "call", sent: false, minutesUsed: 0 });
    expect(h.req).not.toHaveBeenCalled();
    h.mode.v = "on";
    h.req.mockResolvedValueOnce({ id: "f9", question: "Q?", answer: "A." });
    expect((await addJobFaq("tok", T, J, "Q?", "A.")).id).toBe("f9");
    h.req.mockResolvedValue({});
    await removeJobFaq("tok", T, J, "f9");
    h.req.mockResolvedValue({ placed: true, minutes_used: 0 });
    expect(await testJob("tok", T, J, "whatsapp")).toEqual({ channel: "whatsapp", sent: true, minutesUsed: 0 });
    h.req.mockResolvedValue({ placed: true, minutes_used: 1 });
    expect(await testJob("tok", T, J, "call")).toEqual({ channel: "call", sent: true, minutesUsed: 1 });
    // no HTTP DELETE in this API: a removal is a POST to .../remove
    expect(h.req.mock.calls.map((c) => `${c[2]?.method ?? "GET"} ${c[0]}`)).toEqual([`POST /v1/tenants/${T}/jobs/${J}/faqs`, `POST /v1/tenants/${T}/jobs/${J}/faqs/f9/remove`, `POST /v1/tenants/${T}/jobs/${J}/test-message`, `POST /v1/tenants/${T}/jobs/${J}/test-call`]);
    h.req.mockResolvedValueOnce({ placed: false });
    await expect(testJob("tok", T, J, "call")).rejects.toThrow();
    await expect(addJobFaq("tok", T, J, "q".repeat(301), "a")).rejects.toThrow();
    await expect(removeJobFaq("tok", T, J, "../x")).rejects.toThrow();
  });
});
