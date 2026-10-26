import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  tenant: vi.fn(),
  src: { planIt: vi.fn(), answerIt: vi.fn(), excludeThem: vi.fn(), approveIt: vi.fn(), capIt: vi.fn(), moveIt: vi.fn(), readTask: vi.fn(), readReport: vi.fn() },
  revalidate: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => h.redirect(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", accessToken: "tok-1" }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/tasks/source", () => ({
  planIt: (...a: unknown[]) => h.src.planIt(...a),
  answerIt: (...a: unknown[]) => h.src.answerIt(...a),
  excludeThem: (...a: unknown[]) => h.src.excludeThem(...a),
  approveIt: (...a: unknown[]) => h.src.approveIt(...a),
  capIt: (...a: unknown[]) => h.src.capIt(...a),
  moveIt: (...a: unknown[]) => h.src.moveIt(...a),
  readTask: (...a: unknown[]) => h.src.readTask(...a),
  readReport: (...a: unknown[]) => h.src.readReport(...a),
}));

import { ApiAuthError } from "@/lib/api/client";

import { answerTaskAction, approveTaskAction, cancelTaskAction, excludeContactsAction, pauseTaskAction, planTaskAction, progressTaskAction, reportTaskAction, resumeTaskAction, runTaskAction, setCapAction } from "./tasks-actions";

const T = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const CTX = { token: "tok-1", tenantId: T };
const TASK = { id: ID, status: "planned" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("TASK_SCREENS", "mock");
  h.tenant.mockResolvedValue({ role: "owner" });
  for (const f of Object.values(h.src)) f.mockResolvedValue({ ok: true, value: TASK });
  h.src.readReport.mockResolvedValue({ ok: true, value: { task_id: ID } });
});

describe("the flag", () => {
  it("refuses every action and reads nothing when the screens are off", async () => {
    vi.stubEnv("TASK_SCREENS", "");
    const off = { ok: false, error: "not_available" };
    expect(await planTaskAction(T, ID, "Call my suppliers")).toEqual(off);
    expect(await answerTaskAction(T, ID, "x")).toEqual(off);
    expect(await excludeContactsAction(T, ID, [ID], true)).toEqual(off);
    expect(await approveTaskAction(T, ID, "ab".repeat(32))).toEqual(off);
    expect(await setCapAction(T, ID, 5)).toEqual(off);
    expect(await runTaskAction(T, ID)).toEqual(off);
    expect(await pauseTaskAction(T, ID)).toEqual(off);
    expect(await resumeTaskAction(T, ID)).toEqual(off);
    expect(await cancelTaskAction(T, ID)).toEqual(off);
    expect(await progressTaskAction(T, ID)).toEqual(off);
    expect(await reportTaskAction(T, ID)).toEqual(off);
    expect(h.tenant).not.toHaveBeenCalled();
    for (const f of Object.values(h.src)) expect(f).not.toHaveBeenCalled();
  });
});

describe("who may do what", () => {
  it("Owner, Admin and Sales plan, answer and leave people out; a Viewer does not", async () => {
    for (const role of ["owner", "admin", "sales"]) {
      h.tenant.mockResolvedValueOnce({ role });
      expect(await planTaskAction(T, ID, "Call my suppliers", "te")).toEqual({ ok: true, task: TASK });
    }
    expect(h.src.planIt).toHaveBeenLastCalledWith(CTX, { taskId: ID, instruction: "Call my suppliers", language: "te" });
    for (const f of [() => planTaskAction(T, ID, "Call my suppliers"), () => answerTaskAction(T, ID, "x"), () => excludeContactsAction(T, ID, [ID], true)]) {
      h.tenant.mockResolvedValueOnce({ role: "viewer" });
      expect(await f()).toEqual({ ok: false, error: "forbidden" });
    }
    expect(h.src.answerIt).not.toHaveBeenCalled();
    expect(h.src.excludeThem).not.toHaveBeenCalled();
  });
  it("only the Owner approves or changes the cap", async () => {
    expect(await approveTaskAction(T, ID, "ab".repeat(32), 4000)).toEqual({ ok: true, task: TASK });
    expect(h.src.approveIt).toHaveBeenCalledWith(CTX, ID, "ab".repeat(32), 4000);
    expect(await setCapAction(T, ID, 9000)).toEqual({ ok: true, task: TASK });
    for (const role of ["admin", "sales", "viewer"]) {
      h.tenant.mockResolvedValueOnce({ role });
      expect(await approveTaskAction(T, ID, "ab".repeat(32))).toEqual({ ok: false, error: "forbidden" });
      h.tenant.mockResolvedValueOnce({ role });
      expect(await setCapAction(T, ID, 1)).toEqual({ ok: false, error: "forbidden" });
    }
    expect(h.src.approveIt).toHaveBeenCalledTimes(1);
    expect(h.src.capIt).toHaveBeenCalledTimes(1);
  });
  it("Owner and Admin continue, pause, resume and cancel; Sales and Viewer do not", async () => {
    for (const role of ["owner", "admin"]) {
      for (const f of [runTaskAction, pauseTaskAction, resumeTaskAction, cancelTaskAction]) {
        h.tenant.mockResolvedValueOnce({ role });
        expect(await f(T, ID)).toEqual({ ok: true, task: TASK });
      }
    }
    expect(h.src.moveIt.mock.calls.map((c) => c[2])).toEqual(["run", "pause", "resume", "cancel", "run", "pause", "resume", "cancel"]);
    for (const role of ["sales", "viewer"]) {
      h.tenant.mockResolvedValueOnce({ role });
      expect(await pauseTaskAction(T, ID)).toEqual({ ok: false, error: "forbidden" });
    }
    expect(h.src.moveIt).toHaveBeenCalledTimes(8);
  });
  it("every member reads the progress and the report, a Viewer too", async () => {
    h.tenant.mockResolvedValue({ role: "viewer" });
    expect(await progressTaskAction(T, ID)).toEqual({ ok: true, task: TASK });
    expect(await reportTaskAction(T, ID)).toEqual({ ok: true, report: { task_id: ID } });
    expect(h.revalidate).not.toHaveBeenCalled();
  });
});

describe("bad input and failures", () => {
  it("refuses a workspace id that is not a uuid and a missing membership", async () => {
    expect(await planTaskAction("x", ID, "Call my suppliers")).toEqual({ ok: false, error: "not_found" });
    h.tenant.mockRejectedValueOnce(new Error("404"));
    expect(await progressTaskAction(T, ID)).toEqual({ ok: false, error: "not_found" });
    expect(h.src.planIt).not.toHaveBeenCalled();
  });
  it("refuses input of the wrong kind before it reaches the source", async () => {
    expect(await planTaskAction(T, ID, 5 as never)).toEqual({ ok: false, error: "invalid" });
    expect(await planTaskAction(T, ID, "Call my suppliers", "fr" as never)).toEqual({ ok: false, error: "invalid" });
    expect(await answerTaskAction(T, ID, null as never)).toEqual({ ok: false, error: "invalid" });
    expect(await excludeContactsAction(T, ID, "x" as never, true)).toEqual({ ok: false, error: "invalid" });
    expect(await approveTaskAction(T, ID, 7 as never)).toEqual({ ok: false, error: "invalid" });
    expect(await approveTaskAction(T, ID, "ab".repeat(32), "5" as never)).toEqual({ ok: false, error: "invalid" });
    expect(await setCapAction(T, ID, "5" as never)).toEqual({ ok: false, error: "invalid" });
    for (const f of Object.values(h.src)) expect(f).not.toHaveBeenCalled();
  });
  it("an expired sign-in goes to the login page", async () => {
    h.tenant.mockRejectedValueOnce(new ApiAuthError());
    await expect(approveTaskAction(T, ID, "ab".repeat(32))).rejects.toThrow("redirect:/login");
  });
  it("passes a refusal on as a word and refreshes nothing", async () => {
    for (const error of ["changed", "mfa", "read_only", "waiting_for_whatsapp", "not_for_schools", "nobody"]) {
      h.src.approveIt.mockResolvedValueOnce({ ok: false, error });
      expect(await approveTaskAction(T, ID, "ab".repeat(32))).toEqual({ ok: false, error });
    }
    expect(h.revalidate).not.toHaveBeenCalled();
  });
  it("refreshes the Tasks pages after a change", async () => {
    await planTaskAction(T, ID, "Call my suppliers");
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/tasks`);
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/tasks/${ID}`);
  });
});
