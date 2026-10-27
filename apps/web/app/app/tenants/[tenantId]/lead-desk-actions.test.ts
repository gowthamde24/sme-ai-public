import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ role: "owner", flag: "mock", revalidate: vi.fn(), assign: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "44444444-4444-4444-8444-444444444444", accessToken: "tok-1" }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: async () => { if (h.role === "throw") throw new (await orig<typeof import("@/lib/api/client")>()).ApiAuthError("x"); return { role: h.role }; } }));
vi.mock("@/lib/screens/flag", async (orig) => ({ ...(await orig<typeof import("@/lib/screens/flag")>()), leadsScreens: () => h.flag }));
vi.mock("@/lib/lead-desk/leads-source", () => ({ assignLead: (...a: unknown[]) => h.assign(...a) }));

import { assignLeadAction } from "./lead-desk-actions";

const T = "22222222-2222-4222-8222-222222222222";
const L = "55555555-5555-4555-8555-555555555555";
const U = "66666666-6666-4666-8666-666666666666";

beforeEach(() => {
  vi.clearAllMocks();
  h.role = "owner";
  h.flag = "mock";
  h.assign.mockResolvedValue({ ok: true });
});

describe("handing a lead to a team member (night 4, part A6)", () => {
  it("the Owner and Admin do it, with the person's own token and the lead; the Lead Desk list is refreshed", async () => {
    expect(await assignLeadAction(T, L, U)).toEqual({ ok: true });
    expect(h.assign).toHaveBeenCalledWith({ token: "tok-1", tenantId: T, userId: "44444444-4444-4444-8444-444444444444" }, L, U);
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/lead-desk`);
    h.role = "admin";
    expect(await assignLeadAction(T, L, null)).toEqual({ ok: true });
  });
  it("Sales and Viewer are refused before anything is asked", async () => {
    for (const role of ["sales", "viewer"]) {
      h.role = role;
      expect(await assignLeadAction(T, L, U)).toEqual({ ok: false, error: "forbidden" });
    }
    expect(h.assign).not.toHaveBeenCalled();
  });
  it("refuses a bad id, a flag that is off, and passes on a refusal from below without refreshing", async () => {
    expect(await assignLeadAction(T, "x", U)).toEqual({ ok: false, error: "not_available" });
    expect(await assignLeadAction(T, L, "x")).toEqual({ ok: false, error: "not_available" });
    h.flag = "off";
    expect(await assignLeadAction(T, L, U)).toEqual({ ok: false, error: "not_available" });
    h.flag = "mock";
    h.assign.mockResolvedValueOnce({ ok: false, error: "read_only" });
    expect(await assignLeadAction(T, L, U)).toEqual({ ok: false, error: "read_only" });
    expect(h.revalidate).not.toHaveBeenCalled();
  });
  it("an expired sign-in goes to the login page", async () => {
    h.role = "throw";
    await expect(assignLeadAction(T, L, U)).rejects.toThrow("redirect:/login");
  });
});
