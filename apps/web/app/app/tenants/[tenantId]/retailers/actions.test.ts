import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";

const T = "11111111-1111-4111-8111-111111111111";
const P = "3b1c0000-0000-4000-8000-000000000001";
const h = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/lib/api/retailers", async (orig) => ({ ...(await orig<typeof import("@/lib/api/retailers")>()), confirmPlace: (...a: unknown[]) => h.confirm(...a) }));

import { confirmPlaceAction } from "./actions";

beforeEach(() => h.confirm.mockReset().mockResolvedValue({ company_id: "c", lead_id: "55555555-5555-4555-8555-555555555555", created: true }));

describe("keeping a shop as a lead", () => {
  it("sends what the person typed and the card's id with the person's token, and answers only the lead and whether it is new", async () => {
    const r = await confirmPlaceAction(T, P, "Balaji Sarees", "Guntur", "Andhra Pradesh");
    expect(r).toEqual({ ok: true, data: { lead_id: "55555555-5555-4555-8555-555555555555", created: true } });
    expect(h.confirm).toHaveBeenCalledWith("tok", T, { placeId: P, companyName: "Balaji Sarees", city: "Guntur", region: "Andhra Pradesh" });
  });
  it("refuses an empty or long name and a bad workspace before asking", async () => {
    for (const r of [await confirmPlaceAction(T, P, "  ", "", ""), await confirmPlaceAction(T, P, "x".repeat(201), "", ""), await confirmPlaceAction("bad", P, "x", "", ""), await confirmPlaceAction(T, P, "x", "y".repeat(101), "")]) expect(r).toMatchObject({ ok: false, kind: "invalid" });
    expect(h.confirm).not.toHaveBeenCalled();
  });
  it("says a refusal in words", async () => {
    h.confirm.mockRejectedValueOnce(new ApiRequestError(403, "forbidden", "x"));
    expect(await confirmPlaceAction(T, P, "x", "", "")).toMatchObject({ ok: false, kind: "forbidden" });
    h.confirm.mockRejectedValueOnce(new ApiRequestError(409, "conflict", "x"));
    expect(await confirmPlaceAction(T, P, "x", "", "")).toMatchObject({ ok: false, kind: "conflict" });
  });
});
