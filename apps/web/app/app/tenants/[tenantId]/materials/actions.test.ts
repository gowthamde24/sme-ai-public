import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseItem } from "@/lib/api/materials";
import { ITEM_JSON } from "@/lib/api/materials-fixtures";

const api = { put: vi.fn(), remove: vi.fn(), reorder: vi.fn(), defs: vi.fn(), custom: vi.fn() };
const revalidatePath = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/materials", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/materials")>()),
  putMaterialItem: (...a: unknown[]) => api.put(...a),
  removeMaterialPhoto: (...a: unknown[]) => api.remove(...a),
  reorderMaterialPhotos: (...a: unknown[]) => api.reorder(...a),
}));
vi.mock("@/lib/api/custom-fields", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/custom-fields")>()),
  listCustomFields: (...a: unknown[]) => api.defs(...a),
  putCatalogueCustom: (...a: unknown[]) => api.custom(...a),
}));

import { removeMaterialPhotoAction, reorderMaterialPhotosAction, saveMaterialAction, saveMaterialCustomAction } from "./actions";

const T = "22222222-2222-4222-8222-222222222222";
const ITEM = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const PHOTO = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const input = { name: "Paver block 80 mm", sellUnit: "sq_ft" as const, areaUnit: "sq_ft" as const, stockStatus: "in_stock" as const, active: true };
const refusal = (status: number, code: string) => new ApiRequestError(status, code, "the API's own English sentence that must never reach the person");
beforeEach(() => vi.clearAllMocks());

describe("saving a product", () => {
  it("sends the whole product; the exact price goes only when the form carries it, as paise", async () => {
    api.put.mockResolvedValue({ item: parseItem(ITEM_JSON), created: true });
    await saveMaterialAction(T, ITEM, input);
    expect(api.put.mock.calls[0][3]).toEqual({ name: "Paver block 80 mm", sellUnit: "sq_ft", areaUnit: "sq_ft", stockStatus: "in_stock", active: true });
    await saveMaterialAction(T, ITEM, { ...input, price: { rupees: 62.5 } });
    expect(api.put.mock.calls[1][3].price).toEqual({ paise: 6250 });
    await saveMaterialAction(T, ITEM, { ...input, price: { clear: true } });
    expect(api.put.mock.calls[2][3].price).toEqual({ clear: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/materials/${ITEM}`);
  });
  it.each([
    ["no name", { name: " " }], ["a name that is too long", { name: "n".repeat(121) }], ["a unit outside the list", { sellUnit: "bucket" as never }], ["an area unit outside the list", { areaUnit: "acres" as never }], ["a stock state outside the list", { stockStatus: "plenty" as never }],
  ])("%s never reaches the API", async (_n, over) => {
    expect(await saveMaterialAction(T, ITEM, { ...input, ...over })).toEqual({ ok: false, error: "Something in the form is not right. Check it and try again. Nothing was saved." });
    expect(api.put).not.toHaveBeenCalled();
  });
  it.each([0.5, -3, 2_000_000, Number.NaN])("a price of %s rupees is refused before the API", async (rupees) => {
    expect(await saveMaterialAction(T, ITEM, { ...input, price: { rupees } })).toMatchObject({ ok: false, error: expect.stringContaining("price in rupees") });
    expect(api.put).not.toHaveBeenCalled();
  });
  it("the owner's price needs the owner: an Admin's refusal is said in words, with the Security link for the second factor", async () => {
    api.put.mockRejectedValue(refusal(403, "forbidden"));
    expect(await saveMaterialAction(T, ITEM, { ...input, price: { rupees: 65 } })).toMatchObject({ ok: false, error: expect.stringMatching(/owner/i) });
    api.put.mockRejectedValue(refusal(403, "mfa_required"));
    expect(await saveMaterialAction(T, ITEM, { ...input, price: { rupees: 65 } })).toMatchObject({ ok: false, mfa: true });
  });
  it("a rejected session goes to sign-in", async () => {
    api.put.mockRejectedValue(new ApiAuthError("x"));
    await expect(saveMaterialAction(T, ITEM, input)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("photos", () => {
  it("removes by id and orders by ids, every live photo once", async () => {
    api.remove.mockResolvedValue(parseItem(ITEM_JSON));
    api.reorder.mockResolvedValue(parseItem(ITEM_JSON));
    expect(await removeMaterialPhotoAction(T, PHOTO)).toMatchObject({ ok: true });
    expect(await reorderMaterialPhotosAction(T, ITEM, [PHOTO])).toMatchObject({ ok: true });
    for (const bad of [[], [PHOTO, PHOTO], ["x"], Array.from({ length: 9 }, () => PHOTO)]) expect(await reorderMaterialPhotosAction(T, ITEM, bad as string[])).toMatchObject({ ok: false });
    expect(await removeMaterialPhotoAction(T, "x")).toMatchObject({ ok: false });
    expect(api.reorder).toHaveBeenCalledTimes(1);
    expect(api.remove).toHaveBeenCalledTimes(1);
  });
  it("the last photo of a shown product cannot go", async () => {
    api.remove.mockRejectedValue(refusal(409, "needs_photo"));
    expect(await removeMaterialPhotoAction(T, PHOTO)).toMatchObject({ ok: false, error: expect.stringContaining("last photo") });
  });
});

describe("the extra details of the product", () => {
  it("checks the values against the workspace's field definitions before keeping them", async () => {
    api.defs.mockResolvedValue([{ id: "d1", entity: "catalogue_item", code: "gst_rate_percent", kind: "number", label: { en: "GST rate" }, required: false, active: true, source: "pack", position: 1, piiClass: "none" }]);
    api.custom.mockResolvedValue({});
    expect(await saveMaterialCustomAction(T, ITEM, { gst_rate_percent: "18", unknown_code: "x" })).toEqual({ ok: true });
    expect(api.custom).toHaveBeenCalledWith("tok", T, ITEM, { gst_rate_percent: 18 });
    expect(await saveMaterialCustomAction(T, ITEM, { gst_rate_percent: "eighteen" })).toMatchObject({ ok: false });
    expect(api.custom).toHaveBeenCalledTimes(1);
  });
  it("a business type with no field for it says so in words", async () => {
    api.defs.mockRejectedValue(refusal(404, "not_found"));
    expect(await saveMaterialCustomAction(T, ITEM, { a: 1 })).toMatchObject({ ok: false });
  });
});
