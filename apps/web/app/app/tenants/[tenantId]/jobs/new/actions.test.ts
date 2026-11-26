import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ tenant: vi.fn(), revalidate: vi.fn(), mode: { v: "mock" as "off" | "mock" | "on" }, req: vi.fn(), redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`); }) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => h.redirect(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", accessToken: "tok-1" }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/screens/flag", () => ({ jobsScreens: () => h.mode.v }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a), apiRequest: (...a: unknown[]) => h.req(...a) }));

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { WIRE_RESEARCHER_PLAN } from "@/lib/jobs/plan-mock";

import { changeSearchAction, planJobAction, startPlanAction, startSuggestionAction, testPlanAction } from "./actions";

const T = "22222222-2222-4222-8222-222222222222";
const SILK = "call customers who bought silk sarees last month and ask how they liked it";

beforeEach(() => {
  vi.clearAllMocks();
  h.mode.v = "mock";
  h.tenant.mockResolvedValue({ role: "owner" });
});

describe("start a job: the server actions", () => {
  it("the Owner and an Admin get a plan (nothing starts), then start it; the Jobs page is refreshed only by a start", async () => {
    for (const role of ["owner", "admin"]) {
      h.tenant.mockResolvedValue({ role });
      const r = await planJobAction(T, { text: SILK });
      expect(r.ok && r.data.who.eligible).toBe(38);
    }
    expect(h.revalidate).not.toHaveBeenCalled();
    const s = await startPlanAction(T, "plan-silk-call");
    expect(s.ok).toBe(true);
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/jobs`);
    const k = await startSuggestionAction(T, "followups");
    expect(k.ok && "jobId" in k.data && k.data.jobId).toMatch(/^66666666-/);
  });
  it("a swap to WhatsApp is asked with the plan's id, as the contract says", async () => {
    const r = await planJobAction(T, { as: "whatsapp", planId: "plan-silk-call" });
    expect(r.ok && r.data.says[0].channel).toBe("whatsapp");
    expect(await planJobAction(T, { as: "whatsapp", planId: "../x" })).toMatchObject({ ok: false, kind: "invalid" });
  });
  it("a start that needs the Owner's OK first (409 approval_needed) is not a failure: the answer says it is waiting", async () => {
    const k = await startSuggestionAction(T, "offers");
    expect(k).toEqual({ ok: true, data: { approval: { id: "approval-offer-1", kind: "offer" } } });
    h.mode.v = "on";
    h.req.mockRejectedValueOnce(new ApiRequestError(409, "approval_needed", "x", undefined, undefined, undefined, { approval: { id: "ap-9", kind: "rule" } }));
    expect(await startPlanAction(T, "p-1")).toEqual({ ok: true, data: { approval: { id: "ap-9", kind: "rule" } } });
  });
  it("the refusals of the contract are said in our words, and the closed code stays for the screen", async () => {
    h.mode.v = "on";
    for (const [code, status, text] of [["plan_expired", 409, "This plan has expired: say it again."], ["job_off_by_plan", 403, "This team member is not part of your plan."], ["job_unknown_kind", 422, "This kind of team member does not exist."], ["consent_required", 422, "First tick that these people wrote to you or that their consent is recorded."], ["jobs_limit", 409, "Your AI team is full: one workspace can have 100 team members."]] as const) {
      h.req.mockRejectedValueOnce(new ApiRequestError(status, code, "x"));
      expect(await startPlanAction(T, "p-1"), code).toMatchObject({ ok: false, error: text, code });
    }
    h.req.mockRejectedValueOnce(new ApiRequestError(409, "quiet_hours", "x"));
    expect(await testPlanAction(T, "p-1", "call")).toMatchObject({ ok: false, code: "quiet_hours", error: "Test calls and messages are only sent between 10 am and 9 pm." });
  });
  it("the sentence is checked FIRST: too short or too long is refused before anything else, even for someone who may not", async () => {
    h.tenant.mockResolvedValue({ role: "viewer" });
    for (const text of ["", "ab", "x".repeat(501)]) {
      const r = await planJobAction(T, { text });
      expect(r).toMatchObject({ ok: false, kind: "invalid" });
    }
    expect(h.tenant).not.toHaveBeenCalled();
    for (const bad of [null, undefined, 7, "text", { text: 5 }, { kind: "magic" }] as never[]) expect(await planJobAction(T, bad)).toMatchObject({ ok: false, kind: "invalid" });
  });
  it("the plan route answering 404 (not built yet) says so in plain words and starts nothing", async () => {
    h.mode.v = "on";
    h.req.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    const r = await planJobAction(T, { text: SILK });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("not ready yet") });
    expect((r as { error: string }).error).not.toMatch(/not found|removed/i);
    expect(h.revalidate).not.toHaveBeenCalled();
  });
  it("Sales and Viewer change nothing: plan, start, suggestion start and the test are all refused", async () => {
    for (const role of ["sales", "viewer"]) {
      h.tenant.mockResolvedValue({ role });
      expect(await planJobAction(T, { text: SILK })).toMatchObject({ ok: false, kind: "forbidden" });
      expect(await startPlanAction(T, "plan-silk-call")).toMatchObject({ ok: false, kind: "forbidden" });
      expect(await startSuggestionAction(T, "offers")).toMatchObject({ ok: false, kind: "forbidden" });
      expect(await testPlanAction(T, "plan-silk-call", "call")).toMatchObject({ ok: false, kind: "forbidden" });
    }
    expect(h.revalidate).not.toHaveBeenCalled();
  });
  it("bad ids, kinds and channels are refused; a bad workspace id too", async () => {
    expect(await startPlanAction(T, "../x")).toMatchObject({ ok: false, kind: "invalid" });
    expect(await startSuggestionAction(T, "magic" as never)).toMatchObject({ ok: false, kind: "invalid" });
    expect(await testPlanAction(T, "plan-silk-call", "sms" as never)).toMatchObject({ ok: false, kind: "invalid" });
    expect(await startPlanAction("x", "plan-silk-call")).toMatchObject({ ok: false, kind: "invalid" });
  });
  it("the test goes to the owner's own phone; in the mock it says nothing was called", async () => {
    expect(await testPlanAction(T, "plan-silk-call", "call")).toEqual({ ok: true, data: { channel: "call", mock: true, minutesUsed: 0 } });
  });
  it("an expired sign-in goes to the login page; a failing API is said in our words", async () => {
    h.tenant.mockRejectedValueOnce(new ApiAuthError());
    await expect(startPlanAction(T, "plan-silk-call")).rejects.toThrow("redirect:/login");
    h.mode.v = "on";
    h.req.mockRejectedValueOnce(new Error("down"));
    const r = await startPlanAction(T, "p-1");
    expect(r.ok).toBe(false);
  });
});

describe("JOBS off", () => {
  it("nothing is called: no plan, start or test, and the person and the API are not asked", async () => {
    h.mode.v = "off";
    const off = { ok: false, kind: "invalid" };
    expect(await planJobAction(T, { text: SILK })).toMatchObject(off);
    expect(await startPlanAction(T, "plan-1")).toMatchObject(off);
    expect(await startSuggestionAction(T, "offers")).toMatchObject(off);
    expect(await testPlanAction(T, "plan-1", "call")).toMatchObject(off);
    expect(h.tenant).not.toHaveBeenCalled();
    expect(h.req).not.toHaveBeenCalled();
    expect(h.revalidate).not.toHaveBeenCalled();
  });
});

describe("a card's Use this, the 101st job and the Lead Finder choices", () => {
  const SAREE_ASK = "Call every new saree enquiry right away";
  it("the template's id and sentence are planned (the mock planner reads the sentence); a bad id is refused before anything else", async () => {
    const r = await planJobAction(T, { templateId: "enquiry_call_right_away", ask: SAREE_ASK });
    expect(r.ok && r.data.planId).toBe("plan-kind-speed_to_lead");
    expect(await planJobAction(T, { templateId: "../x", ask: SAREE_ASK })).toMatchObject({ ok: false, kind: "invalid" });
    expect(await planJobAction(T, { templateId: "ok_id", ask: "a" })).toMatchObject({ ok: false, kind: "invalid" });
  });
  it("real mode: the id goes to the API; 422 job_unknown_template is a plain sentence with the closed code kept", async () => {
    h.mode.v = "on";
    h.req.mockRejectedValueOnce(new ApiRequestError(422, "job_unknown_template", "x"));
    expect(await planJobAction(T, { templateId: "no_such_card", ask: SAREE_ASK })).toMatchObject({ ok: false, error: "That team member idea is not available. Pick another one.", code: "job_unknown_template" });
    expect(JSON.parse(h.req.mock.calls[0][2].body)).toEqual({ template_id: "no_such_card", language: "en" });
  });
  it("the 101st job: 409 jobs_limit on a start is a plain sentence, for a plan and for a suggestion", async () => {
    h.mode.v = "on";
    h.req.mockRejectedValueOnce(new ApiRequestError(409, "jobs_limit", "x"));
    expect(await startPlanAction(T, "p-1")).toMatchObject({ ok: false, code: "jobs_limit", error: "Your AI team is full: one workspace can have 100 team members." });
    h.req.mockRejectedValueOnce(new ApiRequestError(409, "jobs_limit", "x"));
    expect(await startSuggestionAction(T, "followups")).toMatchObject({ ok: false, code: "jobs_limit" });
  });
  it("the Lead Finder choices: Owner and Admin only, checked first, PATCH with only what changed; a refusal is said in our words", async () => {
    h.mode.v = "on";
    h.req.mockResolvedValueOnce(WIRE_RESEARCHER_PLAN({ results: 5 }));
    const r = await changeSearchAction(T, "plan-researcher", { results: 5 });
    expect(r.ok && r.data.search?.results).toBe(5);
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${T}/jobs/plan/plan-researcher`, "tok-1", { method: "PATCH", body: JSON.stringify({ search: { results: 5 } }) });
    h.req.mockRejectedValueOnce(new ApiRequestError(409, "plan_expired", "x"));
    expect(await changeSearchAction(T, "plan-researcher", { fitBar: 80 })).toMatchObject({ ok: false, code: "plan_expired" });
    for (const bad of [{}, { results: 7 }, { fitBar: 65 }, { area: "" }, null, 5] as never[]) expect(await changeSearchAction(T, "plan-researcher", bad), JSON.stringify(bad)).toMatchObject({ ok: false, kind: "invalid" });
    expect(await changeSearchAction(T, "../x", { results: 5 })).toMatchObject({ ok: false, kind: "invalid" });
    expect(h.req).toHaveBeenCalledTimes(2);
    h.tenant.mockResolvedValue({ role: "viewer" });
    expect(await changeSearchAction(T, "plan-researcher", { results: 5 })).toMatchObject({ ok: false, kind: "forbidden" });
  });
});
