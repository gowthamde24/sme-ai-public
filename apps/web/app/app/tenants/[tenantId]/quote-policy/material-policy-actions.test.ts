import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const save = vi.fn();
const revalidatePath = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/materials", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/materials")>()), saveMaterialPolicy: (...a: unknown[]) => save(...a) }));

import { saveMaterialPolicyAction } from "./material-policy-actions";

const T = "22222222-2222-4222-8222-222222222222";
const V = "9b9b9b9b-9b9b-49b9-89b9-9b9b9b9b9b9b";
const policy = { default_wastage_bps: 500, round_to_pallet: false, bill_wastage: true, advance_bps: 5000, credit_days: 0, validity_days: 7, rounding_mode: "half_up" as const, transport: { kind: "none" as const } };
beforeEach(() => vi.clearAllMocks());

describe("saving the quote rules", () => {
  it("keeps a new version with the form's id", async () => {
    save.mockResolvedValue({ version_id: V, version_no: 3, effective_from: "2026-10-14", replayed: false });
    expect(await saveMaterialPolicyAction(T, V, policy)).toEqual({ ok: true });
    expect(save).toHaveBeenCalledWith("tok", T, V, expect.objectContaining({ default_wastage_bps: 500, advance_bps: 5000, transport: { kind: "none" } }));
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/quote-policy`);
  });
  it("a hand-made body is read through the same checks as the form: a number the form would refuse never goes", async () => {
    expect(await saveMaterialPolicyAction(T, V, { ...policy, advance_bps: 15000 })).toMatchObject({ ok: false });
    expect(await saveMaterialPolicyAction(T, V, { ...policy, transport: { kind: "per_trip", truck_capacity: 0, rate_per_trip_paise: 1, gst_bps: 1800, capacity_basis: "pieces" } })).toMatchObject({ ok: false });
    expect(await saveMaterialPolicyAction(T, "x", policy)).toMatchObject({ ok: false });
    expect(save).not.toHaveBeenCalled();
  });
  it("only the Owner, with the second factor: the refusals are said in words", async () => {
    save.mockRejectedValue(new ApiRequestError(403, "mfa_required", "x"));
    expect(await saveMaterialPolicyAction(T, V, policy)).toMatchObject({ ok: false, mfa: true });
    save.mockRejectedValue(new ApiRequestError(403, "forbidden", "x"));
    expect(await saveMaterialPolicyAction(T, V, policy)).toMatchObject({ ok: false, error: expect.stringContaining("role does not allow") });
    save.mockRejectedValue(new ApiAuthError("x"));
    await expect(saveMaterialPolicyAction(T, V, policy)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
