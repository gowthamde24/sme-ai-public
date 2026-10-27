import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ jar: new Map<string, string>(), api: { planBatch: vi.fn(), approveBatch: vi.fn(), listBatches: vi.fn(), excludeFromBatch: vi.fn(), createRule: vi.fn(), listRules: vi.fn(), batchAction: vi.fn(), getPolicy: vi.fn() } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (h.jar.has(k) ? { name: k, value: h.jar.get(k) } : undefined), set: (k: string, v: string) => void h.jar.set(k, v) }) }));
vi.mock("@/lib/api/outreach", () => h.api);

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { approve, controlBatch, controlRule, excludeContacts, makeBatch, markActed, readBatch, readBatches, readHandoffs, readPolicy, readRules, readReport, refusalOf, saveRule } from "./source";
import type { BatchInput, RuleInput } from "./types";

const CTX = { token: "tok", tenantId: "22222222-2222-4222-8222-222222222222", userId: "44444444-4444-4444-8444-444444444444" };
const B: BatchInput = { batchId: "55555555-5555-4555-8555-555555555555", name: "Leads", goal: "general", channel: "call", language: "en", who: { kind: "source", source: "indiamart", status: "new", since: null }, questions: [], messageText: null, windowDays: 7, maxCallsPerDay: null, maxTotalMinutes: null };
const R: RuleInput = { ruleId: "66666666-6666-4666-8666-666666666666", source: "website_form", action: "call_within_minutes", withinMinutes: 2, goal: "general", channel: "call", language: "en", questions: [], messageText: null, maxCallsPerDay: 50, maxTotalMinutes: null };
const t0 = new Date("2026-10-27T10:00:00.000Z");

beforeEach(() => {
  h.jar.clear();
  for (const f of Object.values(h.api)) f.mockReset();
  vi.unstubAllEnvs();
});

describe("speed to lead, off", () => {
  it("reads nothing and refuses every change", async () => {
    expect(await readBatches(CTX)).toBeNull();
    expect(await readRules(CTX)).toBeNull();
    expect(await readReport(CTX, "2026-10-20", "2026-10-26")).toBeNull();
    expect(await makeBatch(CTX, B)).toEqual({ ok: false, error: "not_available" });
    expect(await approve(CTX, B.batchId, "abc")).toEqual({ ok: false, error: "not_available" });
    expect(h.api.planBatch).not.toHaveBeenCalled();
  });
});

describe("speed to lead, test mode (a cookie, nothing sent)", () => {
  beforeEach(() => vi.stubEnv("OUTREACH_SCREENS", "mock"));
  it("makes a plan, shows it, and approves it once with the hash that was shown", async () => {
    const made = await makeBatch(CTX, B, t0);
    expect(made.ok && made.value.batch.status).toBe("planned");
    expect((await makeBatch(CTX, B, t0)).ok).toBe(true); // the same id is the same plan
    expect((await readBatches(CTX, t0))?.length).toBe(1);
    const shown = (await readBatch(CTX, B.batchId, t0))!;
    expect((await approve(CTX, B.batchId, "stale-hash", t0))).toEqual({ ok: false, error: "changed" });
    const done = await approve(CTX, B.batchId, shown.batch.planSha256, t0);
    expect(done.ok && done.value.batch.status).toBe("running");
    expect(await approve(CTX, B.batchId, shown.batch.planSha256, t0)).toEqual({ ok: false, error: "state" });
  });
  it("a person left out changes the plan, and only while it is still waiting", async () => {
    await makeBatch(CTX, B, t0);
    const before = (await readBatch(CTX, B.batchId, t0))!;
    const who = before.plan.sample[0].contactId;
    const out = await excludeContacts(CTX, B.batchId, [who], true, t0);
    expect(out.ok && out.value.plan.ready).toBe(before.plan.ready - 1);
    expect(out.ok && out.value.batch.planSha256).not.toBe(before.batch.planSha256);
    const back = await excludeContacts(CTX, B.batchId, [who], false, t0);
    expect(back.ok && back.value.plan.ready).toBe(before.plan.ready);
    await approve(CTX, B.batchId, (await readBatch(CTX, B.batchId, t0))!.batch.planSha256, t0);
    expect(await excludeContacts(CTX, B.batchId, [who], true, t0)).toEqual({ ok: false, error: "state" });
  });
  it("pause, continue and cancel only work on an approved plan", async () => {
    await makeBatch(CTX, B, t0);
    expect(await controlBatch(CTX, B.batchId, "pause", t0)).toEqual({ ok: false, error: "state" });
    await approve(CTX, B.batchId, (await readBatch(CTX, B.batchId, t0))!.batch.planSha256, t0);
    const p = await controlBatch(CTX, B.batchId, "pause", t0);
    expect(p.ok && p.value.batch.status).toBe("paused");
    const r = await controlBatch(CTX, B.batchId, "resume", t0);
    expect(r.ok && r.value.batch.status).toBe("running");
    const c = await controlBatch(CTX, B.batchId, "cancel", t0);
    expect(c.ok && c.value.batch.status).toBe("cancelled");
  });
  it("keeps one rule per source, can pause it, and lists hot leads that go when marked", async () => {
    expect((await saveRule(CTX, R, t0)).ok).toBe(true);
    expect(await saveRule(CTX, { ...R, ruleId: "77777777-7777-4777-8777-777777777777" }, t0)).toEqual({ ok: false, error: "state" });
    expect((await readRules(CTX, t0))?.[0].active).toBe(true);
    const paused = await controlRule(CTX, R.ruleId, "pause", t0);
    expect(paused.ok && paused.value).toMatchObject({ active: false, pausedReason: "owner" });
    expect(await controlRule(CTX, "00000000-0000-4000-8000-000000000000", "pause", t0)).toEqual({ ok: false, error: "state" });
    const resumed = await controlRule(CTX, R.ruleId, "resume", t0);
    expect(resumed.ok && resumed.value.active).toBe(true);
    const hot = (await readHandoffs(CTX, true, t0))!;
    expect(hot).toHaveLength(2);
    expect(await markActed(CTX, hot[0].id)).toEqual({ ok: true, value: true });
    expect((await readHandoffs(CTX, true, t0))!).toHaveLength(1);
    expect((await readPolicy(CTX))?.maxAttempts).toBe(3);
    expect((await readReport(CTX, "2026-10-20", "2026-10-26"))?.bySource.length).toBeGreaterThan(0);
    expect(h.api.planBatch).not.toHaveBeenCalled();
  });
});

describe("speed to lead, from the API", () => {
  beforeEach(() => vi.stubEnv("OUTREACH_SCREENS", "1"));
  it("sends the plan and the approval to the API as they are", async () => {
    h.api.planBatch.mockResolvedValueOnce("answer");
    expect(await makeBatch(CTX, B)).toEqual({ ok: true, value: "answer" });
    expect(h.api.planBatch).toHaveBeenCalledWith("tok", CTX.tenantId, B);
    h.api.approveBatch.mockResolvedValueOnce("approved");
    expect(await approve(CTX, B.batchId, "hash")).toEqual({ ok: true, value: "approved" });
    expect(h.api.approveBatch).toHaveBeenCalledWith("tok", CTX.tenantId, B.batchId, "hash");
  });
  it("names the refusals: second factor, a changed plan, read-only, a state, a role, bad input, anything else", async () => {
    const refuse = async (status: number, code: string) => {
      h.api.approveBatch.mockRejectedValueOnce(new ApiRequestError(status, code, "x"));
      return approve(CTX, B.batchId, "hash");
    };
    expect(await refuse(403, "mfa_required")).toEqual({ ok: false, error: "mfa" });
    expect(await refuse(422, "not_for_schools")).toEqual({ ok: false, error: "not_for_schools" });
    expect(await refuse(409, "plan_changed")).toEqual({ ok: false, error: "changed" });
    expect(await refuse(403, "workspace_read_only")).toEqual({ ok: false, error: "read_only" });
    expect(await refuse(409, "outreach_state")).toEqual({ ok: false, error: "state" });
    expect(await refuse(403, "forbidden")).toEqual({ ok: false, error: "forbidden" });
    expect(await refuse(422, "validation_error")).toEqual({ ok: false, error: "invalid" });
    expect(await refuse(500, "boom")).toEqual({ ok: false, error: "down" });
    h.api.approveBatch.mockRejectedValueOnce(new Error("network"));
    expect(await approve(CTX, B.batchId, "hash")).toEqual({ ok: false, error: "down" });
  });
  it("an expired sign-in is not swallowed, in reads or writes", async () => {
    h.api.listBatches.mockRejectedValueOnce(new ApiAuthError());
    await expect(readBatches(CTX)).rejects.toBeInstanceOf(ApiAuthError);
    h.api.createRule.mockRejectedValueOnce(new ApiAuthError());
    await expect(saveRule(CTX, R)).rejects.toBeInstanceOf(ApiAuthError);
    expect(() => refusalOf(new ApiAuthError())).toThrow();
  });
  it("a read that fails is 'not available', never made-up data", async () => {
    h.api.listBatches.mockRejectedValueOnce(new Error("down"));
    expect(await readBatches(CTX)).toBeNull();
    h.api.getPolicy.mockRejectedValueOnce(new Error("down"));
    expect(await readPolicy(CTX)).toBeNull();
  });
  it("the API has no way to take a person back into a plan: that is a refusal, not a silent no-op", async () => {
    expect(await excludeContacts(CTX, B.batchId, ["x"], false)).toEqual({ ok: false, error: "state" });
    expect(h.api.excludeFromBatch).not.toHaveBeenCalled();
  });
});
