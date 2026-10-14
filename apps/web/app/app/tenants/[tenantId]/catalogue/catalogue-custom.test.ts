import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { fixtureWorkspacePack, parseWorkspacePack } from "@/lib/api/pack";

const putCustom = vi.fn();
const readPack = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/custom-fields", () => ({ putCatalogueCustom: (...a: unknown[]) => putCustom(...a) }));
vi.mock("@/lib/packs/read", () => ({ readPackCached: (...a: unknown[]) => readPack(...a) }));

import { saveItemCustomAction } from "./catalogue-actions";

const T = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
beforeEach(() => {
  vi.clearAllMocks();
  readPack.mockResolvedValue(parseWorkspacePack({ pack: "construction" }));
  putCustom.mockResolvedValue({});
});

describe("the extra fields of a catalogue item (job CL)", () => {
  it("keeps the checked values at the item's own path with the person's token", async () => {
    expect(await saveItemCustomAction(T, ITEM, { product_type: "paver_block", selling_unit: "sqft", size: " 200x100 ", gst_rate: "12", colour: "" })).toEqual({ ok: true });
    expect(putCustom).toHaveBeenCalledWith("tok", T, ITEM, { product_type: "paver_block", selling_unit: "sqft", size: "200x100", gst_rate: 12 });
  });
  it("asks the API nothing when there is nothing to keep", async () => {
    readPack.mockResolvedValue(parseWorkspacePack({ pack: "construction", fields: [] }));
    expect(await saveItemCustomAction(T, ITEM, {})).toEqual({ ok: true });
    expect(putCustom).not.toHaveBeenCalled();
  });
  it("refuses a wrong value or a missing required one with our sentence, and sends nothing", async () => {
    const r = await saveItemCustomAction(T, ITEM, { product_type: "marble", selling_unit: "sqft" });
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.error).toMatch(/Product type is not one of the choices/);
    const missing = await saveItemCustomAction(T, ITEM, { product_type: "brick" });
    expect(missing.ok === false && missing.error).toMatch(/Selling unit is required/);
    expect(putCustom).not.toHaveBeenCalled();
  });
  it("refuses ids that are not ids", async () => {
    expect((await saveItemCustomAction("nope", ITEM, {})).ok).toBe(false);
    expect((await saveItemCustomAction(T, "nope", {})).ok).toBe(false);
  });
  it("says why it could not keep them in a sentence of ours, never the API's", async () => {
    const values = { product_type: "brick", selling_unit: "piece" };
    putCustom.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "API-SECRET"));
    const a = await saveItemCustomAction(T, ITEM, values);
    expect(a.ok === false && a.error).toMatch(/this system cannot keep them yet/);
    expect(a.ok === false && a.error).not.toContain("SECRET");
    putCustom.mockRejectedValueOnce(new ApiRequestError(422, "validation_error", "x"));
    expect((await saveItemCustomAction(T, ITEM, values)).ok === false).toBe(true);
    putCustom.mockRejectedValueOnce(new ApiAuthError("x"));
    await expect(saveItemCustomAction(T, ITEM, values)).rejects.toThrow(/login/);
  });
  it("the stand-in pack (no route on the server yet) has no catalogue fields, so nothing is asked", async () => {
    readPack.mockResolvedValue(fixtureWorkspacePack());
    expect(await saveItemCustomAction(T, ITEM, { size: "x" })).toEqual({ ok: true });
    expect(putCustom).not.toHaveBeenCalled();
  });
});
