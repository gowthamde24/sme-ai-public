import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";

const T = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";
const h = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/lib/api/gstin", async (orig) => ({ ...(await orig<typeof import("@/lib/api/gstin")>()), setCompanyGstin: (...a: unknown[]) => h.set(...a) }));

import { saveCompanyGstinAction } from "./gstin-actions";

beforeEach(() => h.set.mockReset().mockResolvedValue("29AAGCB7383J1Z4"));

describe("a customer's GSTIN action", () => {
  it("sends the plain number and answers it with its state", async () => {
    expect(await saveCompanyGstinAction(T, C, "29 aagcb 7383 j1z4")).toEqual({ ok: true, data: { gstin: "29AAGCB7383J1Z4", state: "Karnataka" } });
    expect(h.set).toHaveBeenCalledWith("tok", T, C, "29AAGCB7383J1Z4");
  });
  it("null removes it", async () => {
    h.set.mockResolvedValue(null);
    expect(await saveCompanyGstinAction(T, C, null)).toEqual({ ok: true, data: { gstin: null, state: null } });
  });
  it("refuses a bad number or id before asking", async () => {
    for (const r of [await saveCompanyGstinAction(T, C, "29AAGCB7383J1Z5"), await saveCompanyGstinAction(T, "x", null), await saveCompanyGstinAction("x", C, null), await saveCompanyGstinAction(T, C, "")]) expect(r).toMatchObject({ ok: false, kind: "invalid" });
    expect(h.set).not.toHaveBeenCalled();
  });
  it("says a refusal in words", async () => {
    h.set.mockRejectedValueOnce(new ApiRequestError(403, "forbidden", "x"));
    expect(await saveCompanyGstinAction(T, C, null)).toMatchObject({ ok: false, kind: "forbidden" });
    h.set.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    expect(await saveCompanyGstinAction(T, C, null)).toMatchObject({ ok: false, kind: "not_found" });
  });
});
