import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ tenant: vi.fn(), access: vi.fn(), buy: vi.fn(), save: vi.fn(), preview: vi.fn(), upgrade: vi.fn(), sim: vi.fn(), revalidate: vi.fn(), redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`); }) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => h.redirect(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", accessToken: "tok-1" }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("./today-read", () => ({ readAccessCached: (...a: unknown[]) => h.access(...a) }));
vi.mock("@/lib/topups/source", () => ({ buyTopup: (...a: unknown[]) => h.buy(...a), saveTopupSettings: (...a: unknown[]) => h.save(...a), previewPlanUpgrade: (...a: unknown[]) => h.preview(...a), upgradePlan: (...a: unknown[]) => h.upgrade(...a), simulateUsage: (...a: unknown[]) => h.sim(...a) }));

import { ApiAuthError } from "@/lib/api/client";

import { buyTopupAction, previewUpgradeAction, saveTopupSettingsAction, simulateUsageAction, upgradeAction } from "./topup-actions";

const T = "22222222-2222-4222-8222-222222222222";
const ID = "11111111-1111-4111-8111-111111111111";
const CTX = { token: "tok-1", tenantId: T };
const SET = { autoMinutesPack: null, autoMessagesPack: null, autoMonthlyCapPaise: 0, overageMinutes: false, overageMessages: false, overageMonthlyCapPaise: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  h.tenant.mockResolvedValue({ role: "owner" });
  h.access.mockResolvedValue({ readOnly: false });
  for (const f of [h.buy, h.save, h.upgrade, h.sim]) f.mockResolvedValue({ ok: true });
  h.preview.mockResolvedValue({ ok: true, preview: { toPlanId: "calls_1000" } });
});

describe("the top-up moves (night 4, part F2)", () => {
  it("the Owner buys with the person's token, the id the browser made, and the screens are refreshed", async () => {
    expect(await buyTopupAction(T, ID, "minutes_300", "test_ok")).toEqual({ ok: true });
    expect(h.buy).toHaveBeenCalledWith(CTX, ID, "minutes_300", "test_ok");
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/settings`);
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}`);
  });
  it("settings are checked before anything is asked of the API; a bad body is invalid", async () => {
    expect(await saveTopupSettingsAction(T, SET)).toEqual({ ok: true });
    expect(h.save).toHaveBeenCalledWith(CTX, SET);
    expect(await saveTopupSettingsAction(T, { ...SET, autoMonthlyCapPaise: -1 })).toEqual({ ok: false, error: "invalid" });
    expect(await saveTopupSettingsAction(T, "x")).toEqual({ ok: false, error: "invalid" });
    expect(h.save).toHaveBeenCalledTimes(1);
  });
  it("preview and upgrade go through the same checks", async () => {
    expect(await previewUpgradeAction(T, "calls_1000")).toMatchObject({ ok: true });
    expect(h.preview).toHaveBeenCalledWith(CTX, "calls_1000");
    expect(await upgradeAction(T, "calls_1000", "test_ok")).toEqual({ ok: true });
    expect(h.upgrade).toHaveBeenCalledWith(CTX, "calls_1000", "test_ok");
    expect(await simulateUsageAction(T, 80)).toEqual({ ok: true });
  });
  it("an Admin, a member, a viewer: forbidden, and nothing is asked of the API (authorization)", async () => {
    for (const role of ["admin", "sales", "viewer"]) {
      h.tenant.mockResolvedValue({ role });
      expect(await buyTopupAction(T, ID, "minutes_100", "test_ok")).toEqual({ ok: false, error: "forbidden" });
      expect(await saveTopupSettingsAction(T, SET)).toEqual({ ok: false, error: "forbidden" });
      expect(await previewUpgradeAction(T, "calls_1000")).toEqual({ ok: false, error: "forbidden" });
      expect(await upgradeAction(T, "calls_1000", "test_ok")).toEqual({ ok: false, error: "forbidden" });
      expect(await simulateUsageAction(T, 80)).toEqual({ ok: false, error: "forbidden" });
    }
    for (const f of [h.buy, h.save, h.preview, h.upgrade, h.sim]) expect(f).not.toHaveBeenCalled();
    expect(h.revalidate).not.toHaveBeenCalled();
  });
  it("a read-only workspace is refused", async () => {
    h.access.mockResolvedValue({ readOnly: true, since: null, deleteOn: null, daysLeft: 30, canResume: true });
    expect(await buyTopupAction(T, ID, "minutes_100", "test_ok")).toEqual({ ok: false, error: "read_only" });
    expect(await upgradeAction(T, "calls_1000", "test_ok")).toEqual({ ok: false, error: "read_only" });
    expect(h.buy).not.toHaveBeenCalled();
    expect(h.upgrade).not.toHaveBeenCalled();
  });
  it("a bad workspace id or a failing lookup changes nothing; an expired sign-in goes to the login page", async () => {
    expect(await buyTopupAction("x", ID, "minutes_100", "test_ok")).toEqual({ ok: false, error: "invalid" });
    h.tenant.mockRejectedValueOnce(new Error("down"));
    expect(await buyTopupAction(T, ID, "minutes_100", "test_ok")).toEqual({ ok: false, error: "not_available" });
    h.tenant.mockRejectedValueOnce(new ApiAuthError());
    await expect(buyTopupAction(T, ID, "minutes_100", "test_ok")).rejects.toThrow("redirect:/login");
    expect(h.buy).not.toHaveBeenCalled();
  });
  it("a refusal from below (the second factor, a declined payment) is passed on and nothing is refreshed", async () => {
    h.buy.mockResolvedValueOnce({ ok: false, error: "mfa" });
    expect(await buyTopupAction(T, ID, "minutes_100", "test_ok")).toEqual({ ok: false, error: "mfa" });
    h.upgrade.mockResolvedValueOnce({ ok: false, error: "declined" });
    expect(await upgradeAction(T, "calls_1000", "test_declined")).toEqual({ ok: false, error: "declined" });
    expect(h.revalidate).not.toHaveBeenCalled();
  });
  it("a read of the billing access that fails does not block the move (the API refuses a read-only workspace itself)", async () => {
    h.access.mockRejectedValueOnce(new Error("x"));
    expect(await buyTopupAction(T, ID, "minutes_100", "test_ok")).toEqual({ ok: true });
  });
});
