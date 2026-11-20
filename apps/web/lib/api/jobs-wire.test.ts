import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ req: vi.fn(), mode: { v: "mock" as "off" | "mock" | "on" } }));
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => h.req(...a) }));
vi.mock("@/lib/screens/flag", () => ({ jobsScreens: () => h.mode.v }));

import { ApiRequestError } from "./client";
import { WIRE_RESEARCHER_PLAN } from "@/lib/jobs/plan-mock";

import { changeSearch, checkPlanInput, checkSearchPatch, parsePlan, planJob } from "./jobs";

const T = "22222222-2222-4222-8222-222222222222";
const SENTENCE = "Call every new saree enquiry right away";

beforeEach(() => {
  h.req.mockReset();
  h.mode.v = "on";
});

describe("a card's Use this (contract 1.1 part 1, T9)", () => {
  it("real mode: POST /jobs/plan {template_id, language}: the id and the owner's language, and NO sentence", async () => {
    h.req.mockResolvedValueOnce(WIRE_RESEARCHER_PLAN());
    await planJob("tok", T, { templateId: "find_saree_shops", ask: "Find saree shops near me" }, "te");
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${T}/jobs/plan`, "tok", { method: "POST", body: JSON.stringify({ template_id: "find_saree_shops", language: "te" }) });
  });
  it("the typed path is unchanged: {text, language}", async () => {
    h.req.mockResolvedValueOnce(WIRE_RESEARCHER_PLAN());
    await planJob("tok", T, { text: SENTENCE }, "en");
    expect(JSON.parse(h.req.mock.calls[0][2].body)).toEqual({ text: SENTENCE, language: "en" });
  });
  it("the mock keeps sending the card's sentence to the made-up planner (no call is made)", async () => {
    h.mode.v = "mock";
    const p = await planJob("tok", T, { templateId: "enquiry_call_right_away", ask: SENTENCE }, "en");
    expect(p.planId).toBe("plan-kind-speed_to_lead");
    expect(h.req).not.toHaveBeenCalled();
  });
  it("a 422 job_unknown_template is thrown as it is (the screen says it in a plain sentence)", async () => {
    h.req.mockRejectedValueOnce(new ApiRequestError(422, "job_unknown_template", "x"));
    await expect(planJob("tok", T, { templateId: "nope_nope", ask: SENTENCE }, "en")).rejects.toMatchObject({ status: 422, code: "job_unknown_template" });
  });
  it("what may be asked: a snake_case id and a sentence of 3 to 500 characters; nothing else reaches the API", async () => {
    expect(checkPlanInput({ templateId: "find_saree_shops", ask: `  ${SENTENCE} ` })).toEqual({ templateId: "find_saree_shops", ask: SENTENCE });
    for (const templateId of ["Find", "a b", "../x", "a-b", "", "1abc", "x".repeat(81)]) expect(() => checkPlanInput({ templateId, ask: SENTENCE }), templateId).toThrow();
    expect(() => checkPlanInput({ templateId: "ok_id", ask: "ab" })).toThrow();
    expect(() => checkPlanInput({ templateId: "ok_id", ask: "x".repeat(501) })).toThrow();
    await expect(planJob("tok", T, { templateId: "../x", ask: SENTENCE }, "en")).rejects.toThrow();
    expect(h.req).not.toHaveBeenCalled();
  });
});

describe("the researcher plan card's wire", () => {
  it("says is empty, search {area, results, fit_bar}, cost {searches {left, per_month}}, who.basis none", () => {
    const p = parsePlan(WIRE_RESEARCHER_PLAN());
    expect(p.says).toEqual([]);
    expect(p.search).toEqual({ area: "Vijayawada", results: 10, fitBar: 70 });
    expect(p.cost.searches).toEqual({ left: 2, perMonth: 3 });
    expect(p.cost.minutes).toBe(0);
    expect(p.who.basis.code).toBe("none");
    expect(p.blockers).toEqual([]);
  });
  it("blockers [{code: search_limit}] when no free search is left", () => {
    const p = parsePlan(WIRE_RESEARCHER_PLAN({ left: 0 }));
    expect(p.blockers).toEqual(["search_limit"]);
    expect(p.cost.searches?.left).toBe(0);
  });
  it("results are 5, 10 or 20 and the fit bar 50 to 100; the area is at most 60 characters; anything else is not the contract's shape", () => {
    expect(() => parsePlan(WIRE_RESEARCHER_PLAN({ results: 7 }))).toThrow();
    expect(() => parsePlan(WIRE_RESEARCHER_PLAN({ fit_bar: 49 }))).toThrow();
    expect(() => parsePlan(WIRE_RESEARCHER_PLAN({ fit_bar: 101 }))).toThrow();
    expect(() => parsePlan(WIRE_RESEARCHER_PLAN({ area: "x".repeat(61) }))).toThrow();
    expect(parsePlan(WIRE_RESEARCHER_PLAN({ fit_bar: 50, results: 5, area: "x".repeat(60) })).search).toEqual({ area: "x".repeat(60), results: 5, fitBar: 50 });
  });
  it("a plan with neither call minutes nor searches is not the contract's shape; one with messages and no search is the plan of 1.0", () => {
    const wire = WIRE_RESEARCHER_PLAN() as Record<string, unknown>;
    expect(() => parsePlan({ ...wire, cost: {} })).toThrow();
    expect(parsePlan({ ...wire, search: null, cost: { minutes: 3, minutes_included: 60, rupees: null } }).search).toBeUndefined();
  });
});

describe("Cost.messages {count, rupees|null, included}|null", () => {
  const plan = (messages: unknown) => parsePlan({ ...(WIRE_RESEARCHER_PLAN() as Record<string, unknown>), search: null, cost: { minutes: 0, minutes_included: 60, rupees: null, messages } });
  it("is read when there; absent and null are 'nothing about messages'", () => {
    expect(plan({ count: 40, rupees: null, included: true }).cost.messages).toEqual({ count: 40, rupees: null, included: true });
    expect(plan({ count: 40, rupees: 120, included: false }).cost.messages).toEqual({ count: 40, rupees: 120, included: false });
    expect(plan(null).cost.messages).toBeUndefined();
    expect(plan(undefined).cost.messages).toBeUndefined();
  });
  it("a count that is not a whole number, a rupee amount that is not, or a missing 'included' is not the contract's shape", () => {
    expect(() => plan({ count: -1, rupees: null, included: true })).toThrow();
    expect(() => plan({ count: 1, rupees: 1.5, included: true })).toThrow();
    expect(() => plan({ count: 1, rupees: null })).toThrow();
  });
});

describe("PATCH /jobs/plan/{plan_id} {search: {...only what changed}}", () => {
  it("asks that path with only what changed; the whole Plan answers, read through the parser", async () => {
    h.req.mockResolvedValueOnce(WIRE_RESEARCHER_PLAN({ results: 20 }));
    const p = await changeSearch("tok", T, "plan-researcher", { results: 20 });
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${T}/jobs/plan/plan-researcher`, "tok", { method: "PATCH", body: JSON.stringify({ search: { results: 20 } }) });
    expect(p.search?.results).toBe(20);
    expect(p.planId).toBe("plan-researcher");
    h.req.mockResolvedValueOnce(WIRE_RESEARCHER_PLAN());
    await changeSearch("tok", T, "plan-researcher", { area: "  Guntur  ", fitBar: 90 });
    expect(JSON.parse(h.req.mock.calls[1][2].body)).toEqual({ search: { area: "Guntur", fit_bar: 90 } });
  });
  it("nothing else is sent: an empty patch, an area of 0 or 61 characters, 7 results, a fit bar of 65, or a plan id that is not a plain word never reach the API", async () => {
    for (const patch of [{}, { area: "  " }, { area: "x".repeat(61) }, { results: 7 }, { fitBar: 65 }] as never[]) await expect(changeSearch("tok", T, "p-1", patch), JSON.stringify(patch)).rejects.toThrow();
    await expect(changeSearch("tok", T, "../x", { results: 5 })).rejects.toThrow();
    expect(h.req).not.toHaveBeenCalled();
    expect(checkSearchPatch({ area: "Vijayawada", results: 5, fitBar: 60 })).toEqual({ area: "Vijayawada", results: 5, fitBar: 60 });
  });
  it("a refusal is thrown as it is", async () => {
    h.req.mockRejectedValueOnce(new ApiRequestError(409, "plan_expired", "x"));
    await expect(changeSearch("tok", T, "p-1", { results: 5 })).rejects.toMatchObject({ code: "plan_expired" });
  });
  it("JOBS=mock: the made-up Lead Finder plan with the change applied, the same id, no call", async () => {
    h.mode.v = "mock";
    const p = await changeSearch("tok", T, "plan-researcher", { fitBar: 80 });
    expect(p.search).toEqual({ area: "Vijayawada", results: 10, fitBar: 80 });
    expect(h.req).not.toHaveBeenCalled();
  });
});
