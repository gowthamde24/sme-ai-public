import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ tenant: vi.fn(), save: vi.fn(), clear: vi.fn(), revalidate: vi.fn(), redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`); }) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => h.redirect(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", accessToken: "tok-1" }) }));
vi.mock("@/lib/packs/read", () => ({ readPackCached: async () => ({ modules: ["shop"] }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/call-settings/campaign-source", () => ({ saveCampaignOverride: (...a: unknown[]) => h.save(...a), clearCampaign: (...a: unknown[]) => h.clear(...a) }));

import { ApiAuthError } from "@/lib/api/client";

import { clearCampaignCallsAction, saveCampaignCallsAction } from "./campaign-call-settings-actions";

const T = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  h.tenant.mockResolvedValue({ role: "owner" });
  h.save.mockResolvedValue({ ok: true });
  h.clear.mockResolvedValue({ ok: true });
});

describe("a campaign's call settings actions (job DQ part 3)", () => {
  it("the Owner saves with the person's token and the pack's modules, and the campaign page is refreshed", async () => {
    expect(await saveCampaignCallsAction(T, C, { concurrent_calls: 2 })).toEqual({ ok: true });
    expect(h.save).toHaveBeenCalledWith({ token: "tok-1", tenantId: T }, C, { concurrent_calls: 2 }, ["shop"]);
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/campaigns/${C}`);
    expect(await clearCampaignCallsAction(T, C)).toEqual({ ok: true });
    expect(h.clear).toHaveBeenCalledWith({ token: "tok-1", tenantId: T }, C);
  });
  it("an Admin, a member, a bad id or a failing lookup changes nothing", async () => {
    for (const role of ["admin", "member"]) {
      h.tenant.mockResolvedValueOnce({ role });
      expect(await saveCampaignCallsAction(T, C, {})).toEqual({ ok: false, error: "not_available" });
    }
    expect(await saveCampaignCallsAction("x", C, {})).toEqual({ ok: false, error: "not_available" });
    expect(await clearCampaignCallsAction(T, "y")).toEqual({ ok: false, error: "not_available" });
    h.tenant.mockRejectedValueOnce(new Error("down"));
    expect(await clearCampaignCallsAction(T, C)).toEqual({ ok: false, error: "not_available" });
    expect(h.save).not.toHaveBeenCalled();
    expect(h.clear).not.toHaveBeenCalled();
  });
  it("an expired sign-in goes to the login page", async () => {
    h.tenant.mockRejectedValueOnce(new ApiAuthError());
    await expect(saveCampaignCallsAction(T, C, {})).rejects.toThrow("redirect:/login");
  });
  it("a refusal from below is passed on and nothing is refreshed", async () => {
    h.save.mockResolvedValueOnce({ ok: false, error: "mfa" });
    expect(await saveCampaignCallsAction(T, C, {})).toEqual({ ok: false, error: "mfa" });
    expect(h.revalidate).not.toHaveBeenCalled();
  });
});
