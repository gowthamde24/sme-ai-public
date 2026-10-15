import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { CALC_JSON, DRAFT_JSON, ORDER_CREATED_JSON, PREVIEW_JSON, QUOTE_DETAIL_JSON, TEXT_JSON } from "@/lib/api/materials-fixtures";

const api = { preview: vi.fn(), draft: vi.fn(), approve: vi.fn(), reject: vi.fn(), order: vi.fn(), text: vi.fn() };
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
  previewMaterialQuote: (...a: unknown[]) => api.preview(...a),
  draftMaterialQuote: (...a: unknown[]) => api.draft(...a),
  approveMaterialQuote: (...a: unknown[]) => api.approve(...a),
  rejectMaterialQuote: (...a: unknown[]) => api.reject(...a),
  orderFromMaterialQuote: (...a: unknown[]) => api.order(...a),
  getMaterialQuoteText: (...a: unknown[]) => api.text(...a),
}));

import { approveMaterialQuoteAction, draftMaterialQuoteAction, materialQuoteTextAction, orderFromMaterialQuoteAction, previewMaterialQuoteAction, rejectMaterialQuoteAction } from "./material-actions";
import { materialRefusalOf } from "./material-refusals";

const T = "22222222-2222-4222-8222-222222222222";
const REQ = "66666666-6666-4666-8666-666666666666";
const Q = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const ITEM = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const SITE = "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a";
const picks = [{ line_no: 1, item_id: ITEM }];
const refusal = (status: number, code: string, reason?: string) => new ApiRequestError(status, code, "the API's own English sentence that must never reach the person", reason);
beforeEach(() => vi.clearAllMocks());

describe("preview", () => {
  it("asks with the person's token and returns the engine's figures, not a number made here", async () => {
    api.preview.mockResolvedValue({ as_of: "x", valid_until: "2026-10-21", result: CALC_JSON, database_agrees: true });
    const r = await previewMaterialQuoteAction(T, REQ, picks, SITE);
    expect(api.preview).toHaveBeenCalledWith("tok", T, REQ, picks, SITE);
    expect(r).toEqual({ ok: true, result: CALC_JSON, databaseAgrees: true, validUntil: "2026-10-21" });
    expect(PREVIEW_JSON.database_agrees).toBe(true);
  });
  it.each([
    ["no picks", []], ["six picks", Array.from({ length: 6 }, (_, i) => ({ line_no: i + 1, item_id: ITEM }))], ["a bad item id", [{ line_no: 1, item_id: "x" }]],
    ["line 0", [{ line_no: 0, item_id: ITEM }]], ["a line twice", [{ line_no: 1, item_id: ITEM }, { line_no: 1, item_id: ITEM }]],
  ])("%s never reaches the API", async (_n, bad) => {
    expect(await previewMaterialQuoteAction(T, REQ, bad as never, null)).toEqual({ ok: false, error: "Something in the form is not right. Check it and try again. Nothing was saved." });
    expect(api.preview).not.toHaveBeenCalled();
  });
  it("a bad site id or requirement id never reaches the API", async () => {
    expect(await previewMaterialQuoteAction(T, REQ, picks, "x")).toMatchObject({ ok: false });
    expect(await previewMaterialQuoteAction(T, "x", picks, null)).toMatchObject({ ok: false });
    expect(api.preview).not.toHaveBeenCalled();
  });
  it("says in our words which input is missing", async () => {
    api.preview.mockRejectedValue(refusal(422, "quote_input_missing", "gst_rate"));
    expect(await previewMaterialQuoteAction(T, REQ, picks, null)).toEqual({ ok: false, error: "A chosen product has no GST rate. Add the rate from your accountant to the product." });
    api.preview.mockRejectedValue(refusal(422, "quote_not_computable", "LAYING_RATE_MISSING"));
    expect(await previewMaterialQuoteAction(T, REQ, picks, null)).toMatchObject({ ok: false, error: expect.stringContaining("laying rate is not set") });
    api.preview.mockRejectedValue(refusal(422, "quote_not_computable", "SOMETHING_NEW"));
    expect(await previewMaterialQuoteAction(T, REQ, picks, null)).toMatchObject({ ok: false, error: "A quote cannot be worked out from these figures." });
  });
});

describe("draft", () => {
  it("keeps the previewed figures as a draft with the page's id and refreshes the lists", async () => {
    api.draft.mockResolvedValue(DRAFT_JSON);
    expect(await draftMaterialQuoteAction(T, REQ, Q, picks, null)).toEqual({ ok: true, quoteId: Q });
    expect(api.draft).toHaveBeenCalledWith("tok", T, REQ, Q, picks, null);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/quotes`);
  });
  it("a bad quote id never reaches the API", async () => {
    expect(await draftMaterialQuoteAction(T, REQ, "x", picks, null)).toMatchObject({ ok: false });
    expect(api.draft).not.toHaveBeenCalled();
  });
  it.each([[409, "quote_mismatch"], [409, "quote_stale"]])("a changed input (%i %s) says to make a new draft and asks the screen to look again", async (s, c) => {
    api.draft.mockRejectedValue(refusal(s, c));
    expect(await draftMaterialQuoteAction(T, REQ, Q, picks, null)).toMatchObject({ ok: false, stale: true, error: expect.stringContaining("Make a new draft") });
  });
  it("a defect between the calculator and the database is said as a defect, not as the person's mistake", async () => {
    api.draft.mockRejectedValue(refusal(500, "calculator_disagreement"));
    expect(await draftMaterialQuoteAction(T, REQ, Q, picks, null)).toMatchObject({ ok: false, error: expect.stringContaining("do not agree") });
  });
});

describe("approve and reject", () => {
  it("approve names the quote and refreshes its page", async () => {
    api.approve.mockResolvedValue({});
    expect(await approveMaterialQuoteAction(T, Q)).toEqual({ ok: true });
    expect(api.approve).toHaveBeenCalledWith("tok", T, Q);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/quotes/${Q}`);
  });
  it.each([
    [403, "mfa_required", "authenticator", true], [403, "forbidden", "role does not allow", false], [403, "owner_approval_required", "only the Owner", false],
    [409, "quote_not_draft", "not a draft", false], [404, "not_found", "", false],
  ])("a refusal %i %s becomes one sentence of ours", async (s, c, text, mfa) => {
    api.approve.mockRejectedValue(refusal(s, c));
    const r = await approveMaterialQuoteAction(T, Q);
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).not.toMatch(/API's own/);
    if (text) expect((r as { error: string }).error.toLowerCase()).toContain(text.toLowerCase());
    expect("mfa" in r && r.mfa === true).toBe(mfa);
  });
  it("a rejected session goes to sign-in", async () => {
    api.approve.mockRejectedValue(new ApiAuthError("x"));
    await expect(approveMaterialQuoteAction(T, Q)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
  it("a reason outside the closed list never reaches the API", async () => {
    expect(await rejectMaterialQuoteAction(T, Q, "rude")).toMatchObject({ ok: false });
    expect(api.reject).not.toHaveBeenCalled();
    api.reject.mockResolvedValue({});
    expect(await rejectMaterialQuoteAction(T, Q, "duplicate")).toEqual({ ok: true });
    expect(api.reject).toHaveBeenCalledWith("tok", T, Q, "duplicate");
  });
});

describe("order and text", () => {
  it("makes the order with the screen's id and returns the credit warning as it is", async () => {
    const credit = { credit_limit_paise: 1, outstanding_paise: 2, would_be_paise: 3, exceeded: true };
    api.order.mockResolvedValue({ ...ORDER_CREATED_JSON, credit });
    const r = await orderFromMaterialQuoteAction(T, Q, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1");
    expect(r).toMatchObject({ ok: true, order: { order_no: 7, credit } });
    expect(api.order).toHaveBeenCalledWith("tok", T, Q, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1");
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/orders`);
  });
  it.each([["no_order_policy", "no order rule"], ["order_exists", "already made"], ["quote_expired", "expired"], ["quote_not_approved", "not approved"]])("an order refusal %s is explained", async (code, text) => {
    api.order.mockRejectedValue(refusal(409, code));
    const r = await orderFromMaterialQuoteAction(T, Q, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1");
    expect((r as { error: string }).error.toLowerCase()).toContain(text);
  });
  it("the text is asked for in a known language only", async () => {
    api.text.mockResolvedValue({ ...TEXT_JSON, language: "te", language_review: "draft" });
    expect(await materialQuoteTextAction(T, Q, "te")).toEqual({ ok: true, text: TEXT_JSON.text, reviewed: false });
    expect(await materialQuoteTextAction(T, Q, "fr")).toMatchObject({ ok: false });
    expect(api.text).toHaveBeenCalledTimes(1);
  });
});

describe("the refusal map", () => {
  it("never shows the server's own text, and treats a rejected session as a throw", () => {
    expect(materialRefusalOf(refusal(418, "teapot"))).toEqual({ key: "today.err.generic" });
    expect(materialRefusalOf(new Error("x"))).toEqual({ key: "today.err.generic" });
    expect(() => materialRefusalOf(new ApiAuthError("x"))).toThrow(ApiAuthError);
    expect(materialRefusalOf(refusal(503, "whatever"))).toEqual({ key: "mat.err.unavailable" });
    expect(QUOTE_DETAIL_JSON.id).toBe(Q);
  });
});
