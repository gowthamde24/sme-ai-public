import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { packFields, packWithFields } from "@/lib/packs/pack-test-kit";

const putCustom = vi.fn();
const listFields = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/custom-fields", () => ({ putCatalogueCustom: (...a: unknown[]) => putCustom(...a), listCustomFields: (...a: unknown[]) => listFields(...a) }));

import { saveItemCustomAction } from "./catalogue-actions";

const T = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
// the real fields of a business type that has many on its products (packages/packs)
const FIELDS = packFields(packWithFields("catalogue_item", 5));
const f = (kind: string) => FIELDS.find((x) => x.entity === "catalogue_item" && x.kind === kind)!;
const choice = f("choice");
const text = f("text");
const number = f("number");
beforeEach(() => {
  vi.clearAllMocks();
  listFields.mockResolvedValue(FIELDS);
  putCustom.mockResolvedValue({});
});

describe("the extra fields of a catalogue item (job CL)", () => {
  it("keeps the checked values at the item's own path with the person's token, after reading the workspace's own definitions", async () => {
    expect(await saveItemCustomAction(T, ITEM, { [choice.code]: choice.choices![0].code, [text.code]: " 200x100 ", [number.code]: "12", other: "" })).toEqual({ ok: true });
    expect(listFields).toHaveBeenCalledWith("tok", T, "catalogue_item");
    expect(putCustom).toHaveBeenCalledWith("tok", T, ITEM, { [choice.code]: choice.choices![0].code, [text.code]: "200x100", [number.code]: 12 });
  });
  it("asks the API nothing when there is nothing to keep", async () => {
    listFields.mockResolvedValue([]);
    expect(await saveItemCustomAction(T, ITEM, {})).toEqual({ ok: true });
    expect(putCustom).not.toHaveBeenCalled();
  });
  it("refuses a wrong value or a missing required one with our sentence, and sends nothing", async () => {
    const r = await saveItemCustomAction(T, ITEM, { [choice.code]: "marble_that_is_not_there" });
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.error).toContain(choice.label.en);
    expect(r.ok === false && r.error).toMatch(/is not one of the choices/);
    listFields.mockResolvedValue([...FIELDS, { ...text, code: "must_have", label: { en: "Must have" }, required: true }]);
    const missing = await saveItemCustomAction(T, ITEM, { [text.code]: "x" });
    expect(missing.ok === false && missing.error).toMatch(/Must have is required/);
    expect(putCustom).not.toHaveBeenCalled();
  });
  it("refuses ids that are not ids", async () => {
    expect((await saveItemCustomAction("nope", ITEM, {})).ok).toBe(false);
    expect((await saveItemCustomAction(T, "nope", {})).ok).toBe(false);
  });
  it("says why it could not keep them in a sentence of ours, never the API's", async () => {
    const values = { [text.code]: "x" };
    putCustom.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "API-SECRET"));
    const a = await saveItemCustomAction(T, ITEM, values);
    expect(a.ok === false && a.error).toMatch(/this system cannot keep them yet/);
    expect(a.ok === false && a.error).not.toContain("SECRET");
    putCustom.mockRejectedValueOnce(new ApiRequestError(403, "module_off", "API-SECRET"));
    expect((await saveItemCustomAction(T, ITEM, values)).ok === false).toBe(true);
    putCustom.mockRejectedValueOnce(new ApiRequestError(422, "custom_value_invalid", "x"));
    expect((await saveItemCustomAction(T, ITEM, values)).ok === false).toBe(true);
    putCustom.mockRejectedValueOnce(new ApiAuthError("x"));
    await expect(saveItemCustomAction(T, ITEM, values)).rejects.toThrow(/login/);
  });
  it("says so when the definitions cannot be read (a server without the field routes), and sends nothing", async () => {
    listFields.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    const r = await saveItemCustomAction(T, ITEM, { [text.code]: "x" });
    expect(r.ok === false && r.error).toMatch(/this system cannot keep them yet/);
    expect(putCustom).not.toHaveBeenCalled();
    listFields.mockRejectedValue(new ApiAuthError("x"));
    await expect(saveItemCustomAction(T, ITEM, {})).rejects.toThrow(/login/);
  });
});
