import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ role: "owner", mode: "mock", revalidate: vi.fn(), src: { makeBatch: vi.fn(), excludeContacts: vi.fn(), approve: vi.fn(), controlBatch: vi.fn(), saveRule: vi.fn(), controlRule: vi.fn(), markActed: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "44444444-4444-4444-8444-444444444444", accessToken: "tok-1" }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: async () => { if (h.role === "throw") throw new (await orig<typeof import("@/lib/api/client")>()).ApiAuthError("x"); return { role: h.role }; } }));
vi.mock("@/lib/outreach/source", () => ({ ...h.src, outreachMode: () => h.mode }));


import { approveBatchAction, batchControlAction, excludeAction, handoffActedAction, planBatchAction, ruleControlAction, saveRuleAction } from "./outreach-actions";

const T = "22222222-2222-4222-8222-222222222222";
const B = "55555555-5555-4555-8555-555555555555";
const C = "66666666-6666-4666-8666-666666666666";
const batch = { batchId: B, name: "Leads", goal: "general", channel: "call", language: "en", who: { kind: "source", source: "indiamart", status: "new", since: null }, questions: [], messageText: null, windowDays: 7, maxCallsPerDay: null, maxTotalMinutes: null };
const rule = { ruleId: C, source: "website_form", action: "call_within_minutes", withinMinutes: 2, goal: "general", channel: "call", language: "en", questions: [], messageText: null, maxCallsPerDay: 50, maxTotalMinutes: null };
const NA = { ok: false, error: "not_available" };

beforeEach(() => {
  vi.clearAllMocks();
  h.role = "owner";
  h.mode = "mock";
  for (const f of Object.values(h.src)) f.mockResolvedValue({ ok: true, value: "x" });
});

describe("the speed-to-lead actions (night 4, part A3): who may do what", () => {
  it("a plan is for Owner, Admin and Sales; a Viewer gets nothing", async () => {
    for (const role of ["owner", "admin", "sales"]) {
      h.role = role;
      expect(await planBatchAction(T, batch)).toEqual({ ok: true, value: "x" });
    }
    h.role = "viewer";
    expect(await planBatchAction(T, batch)).toEqual(NA);
    expect(h.src.makeBatch).toHaveBeenCalledTimes(3);
  });
  it("the approval is the Owner's alone, bound to the hash that was shown", async () => {
    expect(await approveBatchAction(T, B, "hash-abcdefgh")).toEqual({ ok: true, value: "x" });
    expect(h.src.approve).toHaveBeenCalledWith({ token: "tok-1", tenantId: T, userId: "44444444-4444-4444-8444-444444444444" }, B, "hash-abcdefgh");
    for (const role of ["admin", "sales", "viewer"]) {
      h.role = role;
      expect(await approveBatchAction(T, B, "hash-abcdefgh")).toEqual(NA);
    }
    h.role = "owner";
    expect(await approveBatchAction(T, "nope", "hash-abcdefgh")).toEqual(NA);
    expect(await approveBatchAction(T, B, "x")).toEqual(NA);
    expect(h.src.approve).toHaveBeenCalledTimes(1);
  });
  it("leaving people out and pausing are for Owner and Admin; cancelling is the Owner's", async () => {
    h.role = "admin";
    expect((await excludeAction(T, B, C, true)).ok).toBe(true);
    expect((await batchControlAction(T, B, "pause")).ok).toBe(true);
    expect(await batchControlAction(T, B, "cancel")).toEqual(NA);
    h.role = "sales";
    expect(await excludeAction(T, B, C, true)).toEqual(NA);
    h.role = "owner";
    expect((await batchControlAction(T, B, "cancel")).ok).toBe(true);
    expect(await batchControlAction(T, B, "explode" as never)).toEqual(NA);
    expect(await excludeAction(T, B, C, "yes" as never)).toEqual(NA);
  });
  it("a standing rule is approved by the Owner only; pausing it is for Owner and Admin", async () => {
    expect((await saveRuleAction(T, rule)).ok).toBe(true);
    h.role = "admin";
    expect(await saveRuleAction(T, rule)).toEqual(NA);
    expect((await ruleControlAction(T, C, "pause")).ok).toBe(true);
    h.role = "sales";
    expect(await ruleControlAction(T, C, "pause")).toEqual(NA);
  });
  it("bad input never reaches the source: an unknown goal, a rule for a file upload, minutes out of range", async () => {
    expect(await planBatchAction(T, { ...batch, goal: "sell" })).toEqual({ ok: false, error: "invalid" });
    expect(await saveRuleAction(T, { ...rule, source: "excel_upload" })).toEqual({ ok: false, error: "invalid" });
    expect(await saveRuleAction(T, { ...rule, withinMinutes: 999 })).toEqual({ ok: false, error: "invalid" });
    expect(h.src.makeBatch).not.toHaveBeenCalled();
    expect(h.src.saveRule).not.toHaveBeenCalled();
  });
  it("everything is refused while the flag is off, for a bad workspace id and for an unreadable workspace", async () => {
    h.mode = "off";
    expect(await planBatchAction(T, batch)).toEqual(NA);
    expect(await handoffActedAction(T, "00000000-0000-4000-8000-0000000000a1")).toEqual(NA);
    h.mode = "mock";
    expect(await planBatchAction("nope", batch)).toEqual(NA);
    expect(h.src.makeBatch).not.toHaveBeenCalled();
  });
  it("a hand-off is marked done by Owner, Admin or Sales, and the screens that show it are refreshed", async () => {
    h.role = "sales";
    expect((await handoffActedAction(T, "00000000-0000-4000-8000-0000000000a1")).ok).toBe(true);
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/lead-desk`);
    h.role = "viewer";
    expect(await handoffActedAction(T, "00000000-0000-4000-8000-0000000000a1")).toEqual(NA);
  });
  it("a refusal from below is passed on and nothing is refreshed", async () => {
    h.src.approve.mockResolvedValueOnce({ ok: false, error: "mfa" });
    expect(await approveBatchAction(T, B, "hash-abcdefgh")).toEqual({ ok: false, error: "mfa" });
    expect(h.revalidate).not.toHaveBeenCalled();
  });
  it("an expired sign-in goes to the login page", async () => {
    h.role = "throw";
    await expect(planBatchAction(T, batch)).rejects.toThrow("redirect:/login");
  });
});
