import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ req: vi.fn(), mode: { v: "mock" as "off" | "mock" | "on" } }));
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => h.req(...a) }));
vi.mock("@/lib/screens/flag", () => ({ jobsScreens: () => h.mode.v }));

import { ApiRequestError, refusal } from "./client";
import { planBlocked, planChannel } from "@/lib/jobs/plan";
import { MOCK_JOBS } from "@/lib/jobs/mock";

import { checkPlanInput, listSuggestions, parsePlan, parseSuggestions, planJob, startPlan, startSuggestion, testPlan } from "./jobs";

const T = "22222222-2222-4222-8222-222222222222";
const JOB = "66666666-6666-4666-8666-666666666601";
const SILK = "call customers who bought silk sarees last month and ask how they liked it";
const wire = {
  plan_id: "p-1",
  title: "Ask last month's silk buyers how they liked it",
  who: { basis: { code: "bought_calls", params: { days: 30, count: 42 } }, total: 42, eligible: 38, excluded: [{ code: "no_consent", count: 4 }] },
  says: [{ language: "en", channel: "call", text: "Namaskaram" }],
  when: { from_hour: 10, to_hour: 18, days: ["tomorrow", "sat"], pace_per_hour: 7 },
  finds_out: [{ key: "liked_it", text: "Did they like it" }, { key: "budget", text: "Their budget", enabled: false }],
  cost: { minutes: 34, minutes_included: 60, minutes_used: 8, rupees: null },
  primary: "start",
  alternatives: [{ kind: "whatsapp", count: 3 }],
  blockers: [],
  expires_in_minutes: 30,
};

beforeEach(() => {
  h.req.mockReset();
  h.mode.v = "mock";
});

describe("a plan: what the API sends", () => {
  it("reads who (eligible, left out with reasons as codes), what it says, when, what it finds out (only the ones on), the cost and the WhatsApp alternative", () => {
    const p = parsePlan(wire);
    expect(p.planId).toBe("p-1");
    expect(p.who).toEqual({ basis: { code: "bought_calls", params: { days: 30, count: 42 } }, total: 42, eligible: 38, excluded: [{ code: "no_consent", count: 4 }] });
    expect(p.when).toEqual({ fromMin: 600, toMin: 1080, days: ["tomorrow", "sat"], pacePerHour: 7 });
    expect(p.findsOut).toEqual([{ key: "liked_it", text: "Did they like it" }]);
    expect(p.cost).toEqual({ minutes: 34, minutesIncluded: 60, minutesUsed: 8, rupees: null });
    expect(p.alternatives).toEqual([{ kind: "whatsapp", count: 3 }]);
    expect(planChannel(p)).toBe("call");
    expect(planBlocked(p)).toBe(false);
  });
  it("rupees on a paid plan; blockers are codes; missing optional parts are empty, never invented", () => {
    const p = parsePlan({ ...wire, cost: { minutes: 0, minutes_included: 0, rupees: 190 }, blockers: [{ code: "unclear_who" }], alternatives: undefined, finds_out: undefined, expires_in_minutes: undefined, primary: undefined });
    expect(p.cost.rupees).toBe(190);
    expect(p.blockers).toEqual(["unclear_who"]);
    expect(planBlocked(p)).toBe(true);
    expect(p.alternatives).toEqual([]);
    expect(p.findsOut).toEqual([]);
    expect(p.expiresInMinutes).toBeNull();
    expect(p.primary).toBe("start");
  });
  it("refuses a channel it does not know, a bad count, a code with spaces, an hour past the day, and too long a line", () => {
    expect(() => parsePlan({ ...wire, says: [{ language: "en", channel: "sms", text: "x" }] })).toThrow();
    expect(() => parsePlan({ ...wire, who: { ...wire.who, eligible: -1 } })).toThrow();
    expect(() => parsePlan({ ...wire, who: { ...wire.who, basis: { code: "has space", params: {} } } })).toThrow();
    expect(() => parsePlan({ ...wire, when: { ...wire.when, from_hour: 24 } })).toThrow();
    expect(() => parsePlan({ ...wire, says: [{ language: "en", channel: "call", text: "x".repeat(1201) }] })).toThrow();
    expect(() => parsePlan({ ...wire, primary: "everything" })).toThrow();
    expect(() => parsePlan("nope")).toThrow();
  });
  it("who.basis.code is the closed list of the contract; each has its params {days, count}; an unknown code is refused", () => {
    for (const code of ["enquired_calls", "bought_calls", "consented_messages", "named_list", "said_yes_offer", "none"]) expect(parsePlan({ ...wire, who: { ...wire.who, basis: { code, params: { days: 30, count: 3 } } } }).who.basis).toEqual({ code, params: { days: 30, count: 3 } });
    expect(() => parsePlan({ ...wire, who: { ...wire.who, basis: { code: "missed_calls", params: {} } } })).toThrow();
  });
  it("the plan's hours are a whole hour or \"HH:MM\" (the settings' way), its days are codes or weekday numbers 1 to 7; the cost carries the minutes used", () => {
    const p = parsePlan({ ...wire, when: { from_hour: "09:30", to_hour: "21:00", days: [1, 2, 7], pace_per_hour: 5 } });
    expect(p.when).toEqual({ fromMin: 570, toMin: 1260, days: ["mon", "tue", "sun"], pacePerHour: 5 });
    expect(parsePlan({ ...wire, when: { ...wire.when, from_hour: 9, to_hour: 24 } }).when).toMatchObject({ fromMin: 540, toMin: 1440 });
    expect(() => parsePlan({ ...wire, when: { ...wire.when, from_hour: "9.30" } })).toThrow();
    expect(() => parsePlan({ ...wire, when: { ...wire.when, days: [8] } })).toThrow();
  });
  it("what it finds out keeps the API's own line for a key the web has no words for", () => {
    expect(parsePlan({ ...wire, finds_out: [{ key: "new_thing", text: "Whether they own a car" }, { key: "liked_it" }] }).findsOut).toEqual([{ key: "new_thing", text: "Whether they own a car" }, { key: "liked_it", text: null }]);
  });
  it("suggestions: a closed kind, why as a code with numbers, a preview, ready", () => {
    const s = parseSuggestions({ items: [{ kind: "offers", title: { code: "offers_wedding" }, why: { code: "offer_yes", params: { n: 38 } }, preview: "Wedding offer" }] });
    expect(s).toEqual([{ kind: "offers", title: { code: "offers_wedding" }, why: { code: "offer_yes", params: { n: 38 } }, preview: "Wedding offer", ready: true }]);
    expect(() => parseSuggestions([{ kind: "magic", why: { code: "a", params: {} }, preview: "x" }])).toThrow();
  });
});

describe("what may be asked of the planner", () => {
  it("a sentence of 3 to 500 characters (trimmed), or one of our job kinds; nothing else", () => {
    expect(checkPlanInput({ text: `  ${SILK}  ` })).toEqual({ text: SILK });
    expect(checkPlanInput({ as: "whatsapp", planId: "p-1" })).toEqual({ as: "whatsapp", planId: "p-1" });
    expect(() => checkPlanInput({ as: "whatsapp", planId: "../x" })).toThrow();
    expect(() => checkPlanInput({ as: "sms", planId: "p-1" } as never)).toThrow();
    expect(checkPlanInput({ kind: "offers" })).toEqual({ kind: "offers" });
    expect(() => checkPlanInput({ text: "ab" })).toThrow();
    expect(() => checkPlanInput({ text: "   a   " })).toThrow();
    expect(() => checkPlanInput({ text: "x".repeat(501) })).toThrow();
    expect(() => checkPlanInput({ text: "x".repeat(500) })).not.toThrow();
    expect(() => checkPlanInput({ kind: "magic" as never })).toThrow();
    expect(() => checkPlanInput({ text: 7 as never })).toThrow();
  });
});

describe("the made-up planner (JOBS=mock)", () => {
  it("silk-saree buyers: 38 of 42 can be called, 4 left out, 3 of them can get a WhatsApp, 34 of 60 free minutes", async () => {
    const p = await planJob("tok", T, { text: SILK }, "en");
    expect(p.who.eligible).toBe(38);
    expect(p.who.total).toBe(42);
    expect(p.who.excluded).toEqual([{ code: "no_consent", count: 4 }]);
    expect(p.alternatives).toEqual([{ kind: "whatsapp", count: 3 }]);
    expect(p.cost).toMatchObject({ minutes: 34, minutesIncluded: 60, rupees: null });
    expect(p.says[0].text).toMatch(/AI assistant of/);
    expect(planBlocked(p)).toBe(false);
    expect(h.req).not.toHaveBeenCalled();
  });
  it("the WhatsApp version is for the 3 who said yes to messages, says it is an AI and how to stop", async () => {
    const first = await planJob("tok", T, { text: SILK }, "en");
    const p = await planJob("tok", T, { as: "whatsapp", planId: first.planId }, "en");
    expect(p.who.eligible).toBe(3);
    expect(p.who.basis.code).toBe("consented_messages");
    expect(planChannel(p)).toBe("whatsapp");
    expect(p.says[0].text).toMatch(/AI assistant of/);
    expect(p.says[0].text).toMatch(/STOP/);
    expect(p.cost.minutes).toBe(0);
  });
  it("yesterday's missed calls: 6 can be called", async () => {
    const p = await planJob("tok", T, { text: "call yesterday's missed calls" }, "en");
    expect(p.who.eligible).toBe(6);
    expect(p.who.excluded).toEqual([]);
  });
  it("anything else: could not tell who you mean, so it cannot start", async () => {
    for (const text of ["do something nice", "call everyone in the phone book", "silk sarees"]) {
      const p = await planJob("tok", T, { text }, "en");
      expect(p.blockers).toEqual(["unclear_who"]);
      expect(p.who.eligible).toBe(0);
    }
  });
  it("a suggested job's plan by kind; every plan says it is an AI", async () => {
    for (const kind of ["speed_to_lead", "followups", "store_visits", "offers"] as const) {
      const p = await planJob("tok", T, { kind }, "en");
      expect(planBlocked(p), kind).toBe(false);
      expect(p.says[0].text, kind).toMatch(/AI assistant/);
    }
  });
  it("starting lands on a made-up job; a test never calls anyone and says so", async () => {
    expect(await startPlan("tok", T, "plan-kind-speed_to_lead")).toEqual({ jobId: MOCK_JOBS[0].id });
    expect(await startPlan("tok", T, "plan-silk-call")).toEqual({ jobId: expect.stringMatching(/^66666666-/) });
    expect(await startSuggestion("tok", T, "followups")).toEqual({ jobId: MOCK_JOBS.find((j) => j.kind === "followups")!.id });
    // the festival offer goes only after the Owner's OK: the start answers 409 approval_needed, as the API does
    expect(await startSuggestion("tok", T, "offers")).toEqual({ approval: { id: "approval-offer-1", kind: "offer" } });
    expect(await startPlan("tok", T, "plan-kind-offers")).toEqual({ approval: { id: "approval-offer-1", kind: "offer" } });
    expect(await testPlan("tok", T, "plan-silk-call", "call")).toEqual({ channel: "call", mock: true, minutesUsed: 0 });
    expect(await testPlan("tok", T, "plan-kind-followups", "whatsapp")).toEqual({ channel: "whatsapp", mock: true, minutesUsed: 0 });
    expect(h.req).not.toHaveBeenCalled();
  });
  it("suggestions: the saree shop's four (textiles), the plain three for any other pack, nothing while off", async () => {
    const saree = await listSuggestions("tok", T, ["catalogue", "quotes", "visits"]);
    expect(saree?.items.map((s) => s.kind)).toEqual(["speed_to_lead", "followups", "store_visits", "offers"]);
    expect(saree?.heading).toBe("saree");
    expect((await listSuggestions("tok", T, ["visits"]))?.items.map((s) => s.kind)).toEqual(["speed_to_lead", "followups", "store_visits"]);
    expect((await listSuggestions("tok", T, ["catalogue", "quotes", "materials", "deliveries"]))?.items).toHaveLength(3);
    const plain = await listSuggestions("tok", T, null);
    expect(plain?.items).toHaveLength(3);
    expect(plain?.heading).toBeNull();
    h.mode.v = "off";
    expect(await listSuggestions("tok", T, ["catalogue", "quotes"])).toBeNull();
  });
});

describe("the real API (JOBS=on): one place to change", () => {
  beforeEach(() => {
    h.mode.v = "on";
  });
  it("plan: POST /jobs/plan with the sentence and the language; the answer is read through the parser", async () => {
    h.req.mockResolvedValueOnce(wire);
    const p = await planJob("tok", T, { text: SILK }, "te");
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${T}/jobs/plan`, "tok", { method: "POST", body: JSON.stringify({ text: SILK, language: "te" }) });
    expect(p.who.eligible).toBe(38);
    h.req.mockResolvedValueOnce({ nonsense: true });
    await expect(planJob("tok", T, { text: SILK }, "en")).rejects.toThrow();
  });
  it("a bad sentence never reaches the API", async () => {
    await expect(planJob("tok", T, { text: "a" }, "en")).rejects.toThrow();
    expect(h.req).not.toHaveBeenCalled();
  });
  it("start, suggestion start, tests and suggestions each ask their own path", async () => {
    h.req.mockResolvedValueOnce({ job_id: JOB });
    expect(await startPlan("tok", T, "p-1")).toEqual({ jobId: JOB });
    expect(h.req).toHaveBeenLastCalledWith(`/v1/tenants/${T}/jobs/plan/p-1/start`, "tok", { method: "POST", body: "{}" });
    h.req.mockResolvedValueOnce({ id: JOB });
    expect(await startSuggestion("tok", T, "offers")).toEqual({ jobId: JOB });
    expect(h.req).toHaveBeenLastCalledWith(`/v1/tenants/${T}/jobs`, "tok", { method: "POST", body: JSON.stringify({ kind: "offers" }) });
    h.req.mockResolvedValueOnce({ placed: true, minutes_used: 1 });
    expect(await testPlan("tok", T, "p-1", "call")).toEqual({ channel: "call", mock: false, minutesUsed: 1 });
    expect(h.req).toHaveBeenLastCalledWith(`/v1/tenants/${T}/jobs/plan/p-1/test-call`, "tok", { method: "POST", body: "{}" });
    h.req.mockResolvedValueOnce({ placed: true, minutes_used: 0 });
    expect((await testPlan("tok", T, "p-1", "whatsapp")).minutesUsed).toBe(0);
    expect(h.req).toHaveBeenLastCalledWith(`/v1/tenants/${T}/jobs/plan/p-1/test-message`, "tok", { method: "POST", body: "{}" });
    h.req.mockResolvedValueOnce({ items: [{ kind: "speed_to_lead", why: { code: "generic_speed", params: {} }, preview: "Hi" }] });
    expect((await listSuggestions("tok", T, null))?.items[0].kind).toBe("speed_to_lead");
    h.req.mockResolvedValueOnce({ heading: "saree", items: [{ kind: "followups", why: { code: "generic_followups", params: {} }, preview: "Hi" }] });
    expect((await listSuggestions("tok", T, null))?.heading).toBe("saree");
    h.req.mockRejectedValueOnce(new Error("404"));
    expect(await listSuggestions("tok", T, null)).toBeNull();
  });
  it("a swap to WhatsApp sends {as: \"whatsapp\", plan_id} (not the sentence), a suggestion's Look first sends {kind, language}", async () => {
    h.req.mockResolvedValue(wire);
    await planJob("tok", T, { as: "whatsapp", planId: "p-1" }, "en");
    expect(JSON.parse(h.req.mock.calls[0][2].body)).toEqual({ as: "whatsapp", plan_id: "p-1", language: "en" });
    await planJob("tok", T, { kind: "followups" }, "te");
    expect(JSON.parse(h.req.mock.calls[1][2].body)).toEqual({ kind: "followups", language: "te" });
  });
  it("409 approval_needed is not an error: the start answers {approval}; any other refusal still throws; a 409 with no approval is a refusal", async () => {
    const approval = { id: "ap-1", kind: "outreach_rule" };
    h.req.mockRejectedValueOnce(new ApiRequestError(409, "approval_needed", "x", undefined, undefined, undefined, { approval }));
    expect(await startPlan("tok", T, "p-1")).toEqual({ approval });
    h.req.mockRejectedValueOnce(new ApiRequestError(409, "approval_needed", "x", undefined, undefined, undefined, { approval }));
    expect(await startSuggestion("tok", T, "speed_to_lead")).toEqual({ approval });
    h.req.mockRejectedValueOnce(new ApiRequestError(409, "approval_needed", "x"));
    await expect(startPlan("tok", T, "p-1")).rejects.toMatchObject({ code: "approval_needed" });
    h.req.mockRejectedValueOnce(new ApiRequestError(409, "plan_expired", "x"));
    await expect(startPlan("tok", T, "p-1")).rejects.toMatchObject({ code: "plan_expired" });
    h.req.mockRejectedValueOnce(new ApiRequestError(409, "quiet_hours", "x"));
    await expect(testPlan("tok", T, "p-1", "call")).rejects.toMatchObject({ code: "quiet_hours" });
  });
  it("the client keeps only the closed extras of a refusal: approval {id, kind} (body or error) and the fields of a setting_invalid", () => {
    expect(refusal(409, { error: { code: "approval_needed", message: "m" }, approval: { id: "ap-1", kind: "offer" } }).extra).toEqual({ approval: { id: "ap-1", kind: "offer" } });
    expect(refusal(409, { error: { code: "approval_needed", message: "m", approval: { id: "ap-2", kind: "rule" } } }).extra).toEqual({ approval: { id: "ap-2", kind: "rule" } });
    expect(refusal(422, { error: { code: "setting_invalid", message: "m", fields: ["from_hour", "to hour", 7] } }).extra).toEqual({ fields: ["from_hour"] });
    expect(refusal(409, { error: { code: "approval_needed" }, approval: { id: "<script>", kind: "offer" } }).extra).toBeUndefined();
    expect(refusal(404, { error: { code: "not_found" } }).extra).toBeUndefined();
  });
  it("a plan id that is not a plain word never makes a path", async () => {
    await expect(startPlan("tok", T, "../x")).rejects.toThrow();
    await expect(testPlan("tok", T, "a/b", "call")).rejects.toThrow();
    expect(h.req).not.toHaveBeenCalled();
  });
});
