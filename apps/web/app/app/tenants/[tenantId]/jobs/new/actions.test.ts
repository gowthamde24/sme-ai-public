import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ tenant: vi.fn(), revalidate: vi.fn(), mode: { v: "mock" as "off" | "mock" | "on" }, req: vi.fn(), redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`); }) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => h.redirect(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", accessToken: "tok-1" }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/screens/flag", () => ({ jobsScreens: () => h.mode.v }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a), apiRequest: (...a: unknown[]) => h.req(...a) }));

import { ApiAuthError } from "@/lib/api/client";

import { planJobAction, startPlanAction, startSuggestionAction, testPlanAction } from "./actions";

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
    const k = await startSuggestionAction(T, "offers");
    expect(k.ok && k.data.jobId).toMatch(/^66666666-/);
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
    expect(await testPlanAction(T, "plan-silk-call", "call")).toEqual({ ok: true, data: { channel: "call", mock: true } });
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
