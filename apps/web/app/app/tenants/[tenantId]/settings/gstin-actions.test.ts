import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";

const T = "11111111-1111-4111-8111-111111111111";
const h = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/lib/api/gstin", async (orig) => ({ ...(await orig<typeof import("@/lib/api/gstin")>()), putBusinessProfile: (...a: unknown[]) => h.put(...a) }));

import { saveShopGstinAction } from "./gstin-actions";

beforeEach(() => h.put.mockReset().mockResolvedValue({ gstin: "27AAPFU0939F1ZV", state: "Maharashtra" }));

describe("the shop's GSTIN action", () => {
  it("sends the plain 15 characters with the person's token", async () => {
    expect(await saveShopGstinAction(T, " 27aapfu-0939 f1zv ")).toEqual({ ok: true, data: { gstin: "27AAPFU0939F1ZV", state: "Maharashtra" } });
    expect(h.put).toHaveBeenCalledWith("tok", T, "27AAPFU0939F1ZV");
  });
  it("null removes it", async () => {
    h.put.mockResolvedValue({ gstin: null, state: null });
    await saveShopGstinAction(T, null);
    expect(h.put).toHaveBeenCalledWith("tok", T, null);
  });
  it.each(["27AAPFU0939F1ZW", "short", "", "99999FU0939F1ZV"])("refuses %j before asking, with the code the form has a sentence for", async (bad) => {
    expect(await saveShopGstinAction(T, bad)).toMatchObject({ ok: false, kind: "invalid", code: "validation_error" });
    expect(h.put).not.toHaveBeenCalled();
  });
  it("refuses a workspace id that is not one", async () => {
    expect(await saveShopGstinAction("x", null)).toMatchObject({ ok: false, kind: "invalid" });
  });
  it("says a refusal in words", async () => {
    h.put.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    expect(await saveShopGstinAction(T, null)).toMatchObject({ ok: false, kind: "mfa", mfa: true });
    h.put.mockRejectedValueOnce(new ApiRequestError(422, "validation_error", "x"));
    expect(await saveShopGstinAction(T, "27AAPFU0939F1ZV")).toMatchObject({ ok: false, kind: "invalid", code: "validation_error" });
  });
});
