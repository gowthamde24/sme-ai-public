import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ req: vi.fn(), mode: { v: "mock" as "off" | "mock" | "on" } }));
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => h.req(...a) }));
vi.mock("@/lib/screens/flag", () => ({ jobsScreens: () => h.mode.v }));

import { WIRE_JOB_VARIANTS } from "@/lib/jobs/fixtures";
import { MOCK_JOBS, MOCK_PAGE_JOBS } from "@/lib/jobs/mock";
import { CHIP_TONE, JOB_KINDS, JOB_STATUSES, filterJobs } from "@/lib/jobs/types";

import { parseJob, parseJobs, parseJobsToday, readJobs, readJobsToday, setJobEnabled } from "./jobs";

const T = "22222222-2222-4222-8222-222222222222";
const J = "66666666-6666-4666-8666-666666666601";
const wire = { id: J, kind: "followups", custom_name: null, enabled: true, status: "failed", result: { code: "template_needed", params: { count: 2 } }, needs_you: 2, last_run_at: "2026-11-19T03:42:00Z", fix: { code: "template_needed", count: 2 }, plan_gate: null };

beforeEach(() => {
  h.req.mockReset();
  h.mode.v = "mock";
});

describe("jobs: what the API sends", () => {
  it("reads a job: closed kind and status, a result code with numbers, a fix; nothing is prose", () => {
    expect(parseJob(wire)).toEqual({ id: J, kind: "followups", customName: null, enabled: true, status: "failed", result: { code: "template_needed", params: { count: 2 } }, needsYou: 2, lastRunAt: "2026-11-19T03:42:00Z", fix: { code: "template_needed", count: 2 }, planGate: null });
    expect(parseJob({ ...wire, custom_name: "Priya", fix: null, needs_you: undefined }).customName).toBe("Priya");
    expect(parseJobs({ items: [wire] })).toHaveLength(1);
    expect(parseJobs([wire])).toHaveLength(1);
  });
  it("payment_reminders is v1.1: the closed list keeps the word and a job of that kind still parses (nothing relies on one being there)", () => {
    expect(JOB_KINDS).toContain("payment_reminders");
    expect(parseJob({ ...wire, kind: "payment_reminders" }).kind).toBe("payment_reminders");
    expect(MOCK_JOBS.map((j) => j.kind)).not.toContain("payment_reminders");
  });
  it("refuses a kind or status it does not know, and a name that is too long", () => {
    expect(() => parseJob({ ...wire, kind: "magic" })).toThrow();
    expect(() => parseJob({ ...wire, status: "exploding" })).toThrow();
    expect(() => parseJob({ ...wire, custom_name: "x".repeat(41) })).toThrow();
    expect(() => parseJob({ ...wire, result: { code: "has space", params: {} } })).toThrow();
  });
  it("plan_gate {code} is the closed list billing_blocked, no_number, no_whatsapp, minutes_used and nothing else; null or missing is no gate", () => {
    for (const code of ["billing_blocked", "no_number", "no_whatsapp", "minutes_used"]) expect(parseJob({ ...wire, plan_gate: { code } }).planGate).toBe(code);
    expect(parseJob({ ...wire, plan_gate: null }).planGate).toBeNull();
    expect(parseJob({ ...wire, plan_gate: undefined }).planGate).toBeNull();
    expect(() => parseJob({ ...wire, plan_gate: { code: "other_reason" } })).toThrow();
    expect(() => parseJob({ ...wire, plan_gate: "no_number" })).toThrow();
  });
  it("result params: ISO dates stay text (the web formats them), a null (no search yet) is simply not there", () => {
    expect(parseJob({ ...wire, result: { code: "search_left", params: { left: 1, per_month: 1, last_search_at: null } } }).result.params).toEqual({ left: 1, per_month: 1 });
    expect(parseJob({ ...wire, result: { code: "paused_on", params: { since: "2026-11-14T05:00:00Z" } } }).result.params).toEqual({ since: "2026-11-14T05:00:00Z" });
  });
  it("every status wears one of the four solid chips", () => {
    for (const s of JOB_STATUSES) expect(["done", "wait", "fail", "info"]).toContain(CHIP_TONE[s]);
    expect(CHIP_TONE.done).toBe("done");
    expect(CHIP_TONE.failed).toBe("fail");
    expect(CHIP_TONE.waiting).toBe("wait");
  });
});

describe("reading and switching", () => {
  it("off: nothing; mock: the made-up jobs, no request; on: the API's, and null when it has no jobs yet", async () => {
    h.mode.v = "off";
    expect(await readJobs("tok", T)).toBeNull();
    h.mode.v = "mock";
    expect((await readJobs("tok", T))?.length).toBe(MOCK_PAGE_JOBS.length); // the page: Today's six and the named jobs
    expect(h.req).not.toHaveBeenCalled();
    h.mode.v = "on";
    h.req.mockResolvedValueOnce({ items: [wire] });
    expect((await readJobs("tok", T))?.[0].kind).toBe("followups");
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${T}/jobs`, "tok");
    h.req.mockRejectedValueOnce(new Error("404"));
    expect(await readJobs("tok", T)).toBeNull();
  });
  it("the switch asks PATCH with {enabled}; the mock answers from the job's own state", async () => {
    h.mode.v = "on";
    h.req.mockResolvedValueOnce({ ...wire, enabled: false, status: "paused" });
    expect(await setJobEnabled("tok", T, J, false)).toEqual({ id: J, enabled: false, status: "paused" });
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${T}/jobs/${J}`, "tok", { method: "PATCH", body: JSON.stringify({ enabled: false }) });
    h.mode.v = "mock";
    expect(await setJobEnabled("tok", T, MOCK_JOBS[0].id, false)).toMatchObject({ enabled: false, status: "paused" });
    expect(await setJobEnabled("tok", T, MOCK_JOBS[0].id, true)).toMatchObject({ enabled: true, status: "running" });
    await expect(setJobEnabled("tok", T, "nope", true)).rejects.toThrow();
  });
  it("mock: every job the Jobs page lists can be switched, the named ones (Ravi, Diwali calls) too", async () => {
    h.mode.v = "mock";
    for (const j of MOCK_PAGE_JOBS) {
      expect(await setJobEnabled("tok", T, j.id, false), j.customName ?? j.kind).toMatchObject({ id: j.id, enabled: false, status: "paused" });
      expect((await setJobEnabled("tok", T, j.id, true)).enabled).toBe(true);
    }
  });
});

describe("GET /jobs/today", () => {
  const today = { jobs: [wire, { ...wire, id: MOCK_JOBS[0].id, kind: "speed_to_lead", fix: null, plan_gate: { code: "no_number" } }], needs_you: [{ id: "a-1", code: "needs_approval", kind: "offer", at: "2026-11-19T03:10:00Z", target: { type: "approval", id: "a-1" } }], assistant: { name: "Asha" } };
  it("reads the full Job objects (plan_gate and fix included), what waits for the owner ({id, code, kind, at, target}, closed) and the assistant's name", () => {
    const t = parseJobsToday(today);
    expect(t.jobs.map((j) => [j.kind, j.planGate, j.fix?.code ?? null])).toEqual([["followups", null, "template_needed"], ["speed_to_lead", "no_number", null]]);
    expect(t.needsYou).toEqual([{ id: "a-1", code: "needs_approval", kind: "offer", at: "2026-11-19T03:10:00Z", target: { type: "approval", id: "a-1" } }]);
    const item = today.needs_you[0];
    for (const bad of ["junk", { ...item, target: undefined }, { ...item, target: { type: "robot", id: "x" } }, { ...item, at: "later" }, { ...item, kind: undefined }, { ...item, id: "<x>" }]) expect(() => parseJobsToday({ jobs: [], needs_you: [bad] })).toThrow();
    // an own message sent back (A7): the code and a target {type: "message", id} are read as they are
    const sentBack = { id: "m-1", code: "message_needs_change", kind: "message", at: "2026-11-18T07:40:00Z", target: { type: "message", id: "own-1" } };
    expect(parseJobsToday({ jobs: [], needs_you: [sentBack] }).needsYou).toEqual([sentBack]);
    for (const type of ["order", "lead", "call_request", "approval", "message"]) expect(parseJobsToday({ jobs: [], needs_you: [{ ...item, target: { type, id: "t-1" } }] }).needsYou[0].target.type).toBe(type);
    expect(t.assistantName).toBe("Asha");
    expect(parseJobsToday({ jobs: [] })).toEqual({ jobs: [], needsYou: [], assistantName: null });
    expect(() => parseJobsToday({ jobs: "no" })).toThrow();
    expect(parseJobsToday({ jobs: [{ ...wire, plan_gate: { code: "x y" } }] }).jobs).toEqual([]); // a row it cannot read is left out, not a failed page
  });
  it("off: nothing; mock: the mock jobs in the same shape and no request; on: a plain GET of /jobs/today (not /jobs), null when the API has none", async () => {
    h.mode.v = "off";
    expect(await readJobsToday("tok", T)).toBeNull();
    h.mode.v = "mock";
    const m = await readJobsToday("tok", T);
    expect(m?.jobs.map((j) => j.id)).toEqual(MOCK_JOBS.map((j) => j.id));
    expect(m?.assistantName).toBeTruthy();
    expect(h.req).not.toHaveBeenCalled();
    h.mode.v = "on";
    h.req.mockResolvedValueOnce(today);
    expect((await readJobsToday("tok", T))?.jobs).toHaveLength(2);
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${T}/jobs/today`, "tok");
    h.req.mockRejectedValueOnce(new Error("404"));
    expect(await readJobsToday("tok", T)).toBeNull();
  });
});

describe("the filters", () => {
  it("Running = on, Needs you = waiting or failed or something waits, Paused = off", () => {
    // the demo has six jobs: payment_reminders is v1.1, the API sends none in v1
    expect(filterJobs(MOCK_JOBS, "all")).toHaveLength(6);
    expect(filterJobs(MOCK_JOBS, "paused")).toEqual([]);
    expect(filterJobs(MOCK_JOBS, "needs_you").map((j) => j.kind)).toEqual(["followups", "offers"]);
    expect(filterJobs(MOCK_JOBS, "running")).toHaveLength(4); // running and well: the two that need the owner are under Needs you (the chips and the groups of the page count the same jobs)
    // a paused job (a variant the contract allows) is the one Paused shows
    const withPaused = [...MOCK_JOBS, ...WIRE_JOB_VARIANTS.map(parseJob)];
    expect(filterJobs(withPaused, "paused").every((j) => !j.enabled || j.status === "paused")).toBe(true);
    expect(filterJobs(withPaused, "paused").length).toBeGreaterThan(0);
  });
});

describe("how a named job sounds (speaks, contract 1.1 part 1: voice is the catalogue id, voice_name its name, the number only the shop)", () => {
  it("language, voice and number are read as closed words and a short name; absent = nothing (older answers still parse)", () => {
    expect(parseJob({ ...wire, speaks: { language: "te", voice: "te-ramya", voice_name: "Ramya", number: "shop" } }).speaks).toEqual({ language: "te", voice: "te-ramya", voiceName: "Ramya", number: "shop" });
    expect(parseJob({ ...wire, speaks: { language: "customer" } }).speaks).toEqual({ language: "customer", voice: null, voiceName: null, number: null });
    // the second number is not a product: it is never drawn, even if an old answer still says it
    expect(parseJob({ ...wire, speaks: { language: "te", voice: "te-ramya", number: "second" } }).speaks?.number).toBeNull();
    expect(parseJob({ ...wire, speaks: null }).speaks).toBeNull();
    expect("speaks" in parseJob(wire)).toBe(false);
  });
  it("an odd value is not shown, and never takes the whole list (or Today's Running now) down", () => {
    expect(parseJob({ ...wire, speaks: { language: "te; drop table", voice: "te-ramya", voice_name: "Ramya", number: "shop" } }).speaks).toEqual({ language: null, voice: "te-ramya", voiceName: "Ramya", number: "shop" });
    expect(parseJob({ ...wire, speaks: { language: "te", voice: "x".repeat(41), voice_name: "y".repeat(41), number: 7 } }).speaks).toEqual({ language: "te", voice: null, voiceName: null, number: null });
    for (const odd of ["te", 5, ["te"], true]) expect(parseJob({ ...wire, speaks: odd }).speaks).toBeNull();
    const rows = [wire, { ...wire, id: MOCK_JOBS[0].id, speaks: { language: "x".repeat(13), voice: { a: 1 }, number: "y y" } }, { ...wire, id: MOCK_JOBS[1].id, speaks: "odd" }];
    expect(parseJobs(rows).map((j) => j.id)).toEqual([J, MOCK_JOBS[0].id, MOCK_JOBS[1].id]);
    expect(parseJobsToday({ jobs: rows }).jobs).toHaveLength(3);
  });
  it("the demo's named jobs carry them", () => {
    expect(MOCK_PAGE_JOBS.filter((j) => j.speaks).map((j) => j.customName)).toEqual(["Priya", "Ravi", "Diwali calls"]);
  });
});
