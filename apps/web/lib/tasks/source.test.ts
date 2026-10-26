import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ jar: new Map<string, string>(), api: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (h.jar.has(k) ? { name: k, value: h.jar.get(k) } : undefined), set: (k: string, v: string) => void h.jar.set(k, v) }) }));
vi.mock("@/lib/api/tasks", async (orig) => {
  const real = await orig<typeof import("@/lib/api/tasks")>();
  const call = (name: string) => (...a: unknown[]) => h.api(name, ...a);
  return { ...real, planTask: call("plan"), answerTask: call("answer"), getTask: call("get"), listTasks: call("list"), getTaskContacts: call("contacts"), excludeTaskContacts: call("exclude"), approveTask: call("approve"), setTaskCap: call("cap"), moveTask: call("move"), getTaskReport: call("report"), getTaskTemplates: call("templates") };
});

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { MS_PER_CONTACT } from "./mock";
import { answerIt, approveIt, capIt, excludeThem, MOCK_COOKIE, mapError, moveIt, planIt, readContacts, readReport, readTask, readTasks, readTemplates } from "./source";

const CTX = { token: "tok", tenantId: "22222222-2222-4222-8222-222222222222" };
const A = "33333333-3333-4333-8333-333333333333";
const B = "44444444-4444-4444-8444-444444444444";
const SUPPLIERS = "Call my cement suppliers and ask the price per bag";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
beforeEach(() => {
  h.jar.clear();
  h.api.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T10:30:00+05:30"));
});

describe("off", () => {
  it("does nothing and says it is not there", async () => {
    expect(await readTasks(CTX)).toEqual({ ok: false, error: "not_available" });
    expect(await readTask(CTX, A)).toEqual({ ok: false, error: "not_available" });
    expect(await readTemplates(CTX)).toEqual({ ok: false, error: "not_available" });
    expect(await readContacts(CTX, A)).toEqual({ ok: false, error: "not_available" });
    expect(await readReport(CTX, A)).toEqual({ ok: false, error: "not_available" });
    expect(await planIt(CTX, { taskId: A, instruction: SUPPLIERS, language: null })).toEqual({ ok: false, error: "not_available" });
    expect(await answerIt(CTX, A, "x")).toEqual({ ok: false, error: "not_available" });
    expect(await excludeThem(CTX, A, [B], true)).toEqual({ ok: false, error: "not_available" });
    expect(await approveIt(CTX, A, "ab".repeat(32), null)).toEqual({ ok: false, error: "not_available" });
    expect(await capIt(CTX, A, 5)).toEqual({ ok: false, error: "not_available" });
    expect(await moveIt(CTX, A, "pause")).toEqual({ ok: false, error: "not_available" });
    expect(h.api).not.toHaveBeenCalled();
    expect(h.jar.size).toBe(0);
  });
});

describe("mock (TASK_SCREENS=mock): plan, approve, watch, report", () => {
  beforeEach(() => vi.stubEnv("TASK_SCREENS", "mock"));
  const plan = async (id = A, instruction = SUPPLIERS) => {
    const got = await planIt(CTX, { taskId: id, instruction, language: null });
    if (!got.ok) throw new Error(got.error);
    return got.value;
  };
  it("plans, replays the same id, and lists newest first", async () => {
    const t = await plan();
    expect(t).toMatchObject({ status: "planned", template: "supplier_price_enquiry" });
    expect((await plan()).id).toBe(A);
    vi.setSystemTime(Date.now() + 1000);
    await plan(B, "Remind everyone with pending dues");
    const list = await readTasks(CTX);
    expect(list.ok && list.value.map((x) => x.id)).toEqual([B, A]);
    expect(await readTasks(CTX, "planned")).toMatchObject({ ok: true });
    expect(h.api).not.toHaveBeenCalled();
    expect(h.jar.get(MOCK_COOKIE)!.length).toBeLessThan(3500);
  });
  it("refuses bad input", async () => {
    expect(await planIt(CTX, { taskId: A, instruction: "ab", language: null })).toEqual({ ok: false, error: "invalid" });
    expect(await planIt(CTX, { taskId: A, instruction: "x".repeat(1501), language: null })).toEqual({ ok: false, error: "invalid" });
    expect(await planIt(CTX, { taskId: "nope", instruction: SUPPLIERS, language: null })).toEqual({ ok: false, error: "invalid" });
    expect(await planIt(CTX, { taskId: A, instruction: SUPPLIERS, language: "fr" as never })).toEqual({ ok: false, error: "invalid" });
    expect(await readTask(CTX, "nope")).toEqual({ ok: false, error: "not_found" });
    expect(await readTask(CTX, A)).toEqual({ ok: false, error: "not_found" });
  });
  it("leaves people out only while planned, and the hash changes with them", async () => {
    const t = await plan();
    const people = await readContacts(CTX, A);
    expect(people.ok && people.value.contacts).toHaveLength(12);
    const id = people.ok ? people.value.contacts[2].contact_id : "";
    const left = await excludeThem(CTX, A, [id], true);
    expect(left.ok && left.value.progress.excluded).toBe(1);
    expect(left.ok && left.value.plan_sha256).not.toBe(t.plan_sha256);
    expect(await excludeThem(CTX, A, ["c0ffee00-0000-4000-8000-0000000000ff"], true)).toEqual({ ok: false, error: "invalid" });
    const back = await excludeThem(CTX, A, [id], false);
    expect(back.ok && back.value.plan_sha256).toBe(t.plan_sha256);
  });
  it("approves once with the hash it was shown, refuses a stale one, then runs", async () => {
    const t = await plan();
    expect(await approveIt(CTX, A, "0".repeat(64), null)).toEqual({ ok: false, error: "changed" });
    const ok = await approveIt(CTX, A, t.plan_sha256!, null);
    expect(ok).toMatchObject({ ok: true, value: { status: "approved" } });
    expect(await approveIt(CTX, A, t.plan_sha256!, null)).toEqual({ ok: false, error: "state" });
    vi.setSystemTime(Date.now() + 4 * MS_PER_CONTACT + 100);
    const mid = await readTask(CTX, A);
    expect(mid.ok && mid.value.status).toBe("running");
    expect(mid.ok && mid.value.progress.in_progress).toBe(1);
    expect(await readReport(CTX, A)).toMatchObject({ ok: true });
    vi.setSystemTime(Date.now() + 20 * MS_PER_CONTACT);
    const report = await readReport(CTX, A);
    expect(report.ok && report.value.short_answer).toMatch(/^Cheapest: /);
    expect(report.ok && report.value.rows).toHaveLength(12);
  });
  it("will not approve nobody, and asks ONE question for a vague instruction", async () => {
    const vague = await plan(A, "Do something nice for me");
    expect(vague).toMatchObject({ status: "needs_answer" });
    expect(vague.question).toBeTruthy();
    expect(await approveIt(CTX, A, "ab".repeat(32), null)).toEqual({ ok: false, error: "state" });
    const none = await answerIt(CTX, A, "just do it");
    expect(none.ok && none.value.plan?.contacts_total).toBe(0);
    const sha = none.ok ? none.value.plan_sha256! : "";
    expect(await approveIt(CTX, A, sha, null)).toEqual({ ok: false, error: "nobody" });
    expect(await answerIt(CTX, A, "again")).toEqual({ ok: false, error: "state" });
  });
  it("pauses, resumes, raises the cap and cancels", async () => {
    const t = await plan();
    expect(await moveIt(CTX, A, "pause")).toEqual({ ok: false, error: "state" });
    await approveIt(CTX, A, t.plan_sha256!, 500);
    vi.setSystemTime(Date.now() + 10 * MS_PER_CONTACT);
    const capped = await readTask(CTX, A);
    expect(capped.ok && capped.value).toMatchObject({ status: "paused", pause_reason: "cap", spent_paise: 500 });
    expect(await capIt(CTX, A, 5000)).toMatchObject({ ok: true, value: { cap_paise: 5000, status: "paused" } });
    expect(await moveIt(CTX, A, "resume")).toMatchObject({ ok: true, value: { status: "running" } });
    expect(await moveIt(CTX, A, "pause")).toMatchObject({ ok: true, value: { status: "paused", pause_reason: "owner" } });
    expect(await moveIt(CTX, A, "cancel")).toMatchObject({ ok: true, value: { status: "cancelled" } });
    expect(await moveIt(CTX, A, "cancel")).toEqual({ ok: false, error: "state" });
  });
  it("keeps only the newest five tasks in the cookie", async () => {
    for (let i = 0; i < 7; i++) {
      vi.setSystemTime(Date.now() + 1000);
      await plan(`33333333-3333-4333-8333-33333333333${i}`, `${SUPPLIERS} number ${i}`);
    }
    const list = await readTasks(CTX);
    expect(list.ok && list.value).toHaveLength(5);
    expect(list.ok && list.value[0].instruction).toContain("number 6");
  });
  it("serves the templates from the fake", async () => {
    const t = await readTemplates(CTX);
    expect(t.ok && t.value.templates).toHaveLength(7);
  });
});

describe("on (TASK_SCREENS=1): the API", () => {
  beforeEach(() => vi.stubEnv("TASK_SCREENS", "1"));
  it("passes each call on with the token and the workspace", async () => {
    h.api.mockResolvedValue({ marker: true });
    await planIt(CTX, { taskId: A, instruction: ` ${SUPPLIERS} `, language: "te" });
    expect(h.api).toHaveBeenLastCalledWith("plan", "tok", CTX.tenantId, { taskId: A, instruction: SUPPLIERS, language: "te" });
    await approveIt(CTX, A, "ab".repeat(32), 4000);
    expect(h.api).toHaveBeenLastCalledWith("approve", "tok", CTX.tenantId, A, "ab".repeat(32), 4000);
    await moveIt(CTX, A, "resume");
    expect(h.api).toHaveBeenLastCalledWith("move", "tok", CTX.tenantId, A, "resume");
    await readTasks(CTX, "running");
    expect(h.api).toHaveBeenLastCalledWith("list", "tok", CTX.tenantId, { status: "running", limit: 100 });
    await excludeThem(CTX, A, [B], true);
    expect(h.api).toHaveBeenLastCalledWith("exclude", "tok", CTX.tenantId, A, [B], true);
    expect(h.jar.size).toBe(0);
  });
  it("turns the API's refusals into words the screens have a sentence for", () => {
    const e = (status: number, code: string) => new ApiRequestError(status, code, "x");
    expect([mapError(e(409, "plan_changed")), mapError(e(403, "mfa_required")), mapError(e(403, "workspace_read_only")), mapError(e(403, "waiting_for_whatsapp")), mapError(e(422, "not_for_schools")), mapError(e(422, "invalid_value")), mapError(e(409, "not_planned")), mapError(e(409, "task_state")), mapError(e(404, "not_found")), mapError(e(403, "forbidden")), mapError(e(422, "other")), mapError(e(429, "rate")), mapError(e(503, "model_busy")), mapError(e(502, "plan_failed")), mapError(new Error("x"))]).toEqual(["changed", "mfa", "read_only", "waiting_for_whatsapp", "not_for_schools", "nobody", "state", "state", "not_found", "forbidden", "invalid", "busy", "busy", "down", "down"]);
  });
  it("returns a failed call as a word, and lets a rejected sign-in through", async () => {
    h.api.mockRejectedValueOnce(new ApiRequestError(409, "plan_changed", "x"));
    expect(await approveIt(CTX, A, "ab".repeat(32), null)).toEqual({ ok: false, error: "changed" });
    h.api.mockRejectedValueOnce(new ApiAuthError());
    await expect(readTask(CTX, A)).rejects.toBeInstanceOf(ApiAuthError);
  });
  it("checks the input before it asks the API", async () => {
    expect(await approveIt(CTX, A, "not hex", null)).toEqual({ ok: false, error: "invalid" });
    expect(await approveIt(CTX, A, "ab".repeat(32), -1)).toEqual({ ok: false, error: "invalid" });
    expect(await capIt(CTX, A, 1.5)).toEqual({ ok: false, error: "invalid" });
    expect(await excludeThem(CTX, A, [], true)).toEqual({ ok: false, error: "invalid" });
    expect(await answerIt(CTX, A, "  ")).toEqual({ ok: false, error: "invalid" });
    expect(await answerIt(CTX, A, "x".repeat(501))).toEqual({ ok: false, error: "invalid" });
    expect(h.api).not.toHaveBeenCalled();
  });
});
