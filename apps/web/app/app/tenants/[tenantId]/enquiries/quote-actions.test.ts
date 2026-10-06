import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { ENQ, P1, QUOTE, QUOTE_JSON, TENANT } from "@/lib/api/quotes-fixtures";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const api = { pickProduct: vi.fn(), createQuote: vi.fn(), approveQuote: vi.fn(), rejectQuote: vi.fn(), withdrawQuote: vi.fn() };
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/quotes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/quotes")>()),
  pickProduct: (...a: unknown[]) => api.pickProduct(...a),
  createQuote: (...a: unknown[]) => api.createQuote(...a),
  approveQuote: (...a: unknown[]) => api.approveQuote(...a),
  rejectQuote: (...a: unknown[]) => api.rejectQuote(...a),
  withdrawQuote: (...a: unknown[]) => api.withdrawQuote(...a),
}));

import { approveQuoteAction, createQuoteAction, pickProductAction, rejectQuoteAction, withdrawQuoteAction } from "./quote-actions";

const CANARY = "CANARY-31c9d2";
const PAGE = `/app/tenants/${TENANT}/enquiries/${ENQ}`;

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}
const pick = (over: Record<string, string> = {}, line = 1) =>
  pickProductAction(TENANT, ENQ, line, undefined, form({ choice: `list:${P1}:piece`, qty: "20", ...over }));
const create = (over: Record<string, string> = {}) =>
  createQuoteAction(TENANT, ENQ, undefined, form({ quote_id: QUOTE, customer_kind: "new", delivery_state: "MH", ...over }));

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal2" });
  api.pickProduct.mockResolvedValue({});
  api.createQuote.mockResolvedValue({ id: QUOTE });
  api.approveQuote.mockResolvedValue({});
  api.rejectQuote.mockResolvedValue({});
  api.withdrawQuote.mockResolvedValue({});
});

describe("pickProductAction", () => {
  it("authenticates first, sends the line, the product, the quantity and whether it was suggested", async () => {
    expect(await pick()).toEqual({ ok: true, message: "Line 1: product chosen." });
    expect(api.pickProduct).toHaveBeenCalledWith("tok", TENANT, ENQ, { line: 1, productId: P1, qty: 20, saleUnit: "piece", fromSuggestion: false });
    await pick({ choice: `suggested:${P1}:set`, qty: "3" }, 2);
    expect(api.pickProduct).toHaveBeenLastCalledWith("tok", TENANT, ENQ, { line: 2, productId: P1, qty: 3, saleUnit: "set", fromSuggestion: true });
    expect(revalidatePath).toHaveBeenCalledWith(PAGE);
  });

  it("refuses a malformed choice, quantity or id before the API is called", async () => {
    for (const choice of ["", "x", `list:${P1}`, `other:${P1}:piece`, `list:not-a-uuid:piece`, `list:${P1}:dozen`, `list:${P1}:piece:extra`])
      expect(await pick({ choice })).toEqual({ ok: false, error: "Choose a product." });
    for (const qty of ["", "0", "-1", "1.5", "10001", "abc", "1e3", "99999999"]) expect((await pick({ qty }))?.ok).toBe(false);
    expect((await pickProductAction(TENANT, ENQ, 0, undefined, form({ choice: `list:${P1}:piece`, qty: "1" })))?.ok).toBe(false);
    expect((await pickProductAction(TENANT, ENQ, 6, undefined, form({ choice: `list:${P1}:piece`, qty: "1" })))?.ok).toBe(false);
    expect((await pickProductAction("x", ENQ, 1, undefined, form({ choice: `list:${P1}:piece`, qty: "1" })))?.ok).toBe(false);
    expect(api.pickProduct).not.toHaveBeenCalled();
  });

  it("answers in our own words and never echoes anything from the API", async () => {
    api.pickProduct.mockRejectedValue(new ApiRequestError(422, "suggestion_changed", CANARY));
    const r = await pick();
    expect(r?.error).toMatch(/suggestion changed/i);
    expect(JSON.stringify(r)).not.toContain(CANARY);
    api.pickProduct.mockRejectedValue(new ApiRequestError(422, "invalid_value", CANARY));
    expect((await pick())?.error).toMatch(/quantity/i);
  });

  it("sends a signed-out person to the login page", async () => {
    api.pickProduct.mockRejectedValue(new ApiAuthError("x"));
    expect(await redirectTarget(() => pick())).toBe("/login");
  });
});

describe("createQuoteAction", () => {
  it("sends the page's id, the kind and the state, then goes to the new quote", async () => {
    expect(await redirectTarget(() => create())).toBe(`${PAGE}?quote=${QUOTE}`);
    expect(api.createQuote).toHaveBeenCalledWith("tok", TENANT, ENQ, { id: QUOTE, customerKind: "new", deliveryState: "MH" });
    await redirectTarget(() => create({ customer_kind: "repeat" }));
    expect(api.createQuote).toHaveBeenLastCalledWith("tok", TENANT, ENQ, { id: QUOTE, customerKind: "repeat", deliveryState: "MH" });
  });

  it("refuses a bad id, kind or state code before the API is called", async () => {
    expect((await create({ quote_id: "x" }))?.error).toMatch(/out of date/);
    expect((await create({ customer_kind: "vip" }))?.error).toMatch(/new or a repeat/);
    for (const delivery_state of ["", "mh", "M", "MHA", "1A", " "]) expect((await create({ delivery_state }))?.error).toMatch(/delivery state/);
    expect(api.createQuote).not.toHaveBeenCalled();
  });

  it.each([
    ["quote_input_missing", 422, /product for every approved line/],
    ["quote_not_computable", 422, /cannot be made/],
    ["invalid_delivery_state", 422, /delivery state/],
    ["requirement_not_confirmed", 409, /Approve the requirement/],
    ["quote_computation_unavailable", 503, /not available right now/],
  ])("explains %s without echoing the API's text", async (code, status, wording) => {
    api.createQuote.mockRejectedValue(new ApiRequestError(status, code, CANARY));
    const r = await create();
    expect(r?.error).toMatch(wording);
    expect(JSON.stringify(r)).not.toContain(CANARY);
  });
});

describe("approveQuoteAction", () => {
  it("approves and says nothing was sent", async () => {
    const r = await approveQuoteAction(TENANT, ENQ, QUOTE);
    expect(api.approveQuote).toHaveBeenCalledWith("tok", TENANT, QUOTE);
    expect(r).toEqual({ ok: true, message: expect.stringContaining("Nothing was sent") });
    expect(revalidatePath).toHaveBeenCalledWith(PAGE);
  });

  it("checks the second factor and the owner-only rule BEFORE the plain role refusal", async () => {
    api.approveQuote.mockRejectedValue(new ApiRequestError(403, "mfa_required", CANARY));
    expect((await approveQuoteAction(TENANT, ENQ, QUOTE))?.error).toMatch(/authenticator app/);
    api.approveQuote.mockRejectedValue(new ApiRequestError(403, "owner_approval_required", CANARY));
    expect((await approveQuoteAction(TENANT, ENQ, QUOTE))?.error).toMatch(/only the owner/);
    api.approveQuote.mockRejectedValue(new ApiRequestError(403, "forbidden", CANARY));
    expect((await approveQuoteAction(TENANT, ENQ, QUOTE))?.error).toBe("Your role does not allow this.");
  });

  it.each([
    ["quote_stale", /changed since this draft/],
    ["quote_mismatch", /no longer matches/],
    ["quote_not_draft", /not a draft any more/],
  ])("explains %s", async (code, wording) => {
    api.approveQuote.mockRejectedValue(new ApiRequestError(409, code, CANARY));
    const r = await approveQuoteAction(TENANT, ENQ, QUOTE);
    expect(r?.error).toMatch(wording);
    expect(JSON.stringify(r)).not.toContain(CANARY);
  });

  it("refuses a malformed id and a signed-out person", async () => {
    expect((await approveQuoteAction(TENANT, ENQ, "x"))?.ok).toBe(false);
    expect(api.approveQuote).not.toHaveBeenCalled();
    api.approveQuote.mockRejectedValue(new ApiAuthError("x"));
    expect(await redirectTarget(() => approveQuoteAction(TENANT, ENQ, QUOTE))).toBe("/login");
  });
});

describe("rejectQuoteAction and withdrawQuoteAction", () => {
  it("send only a code from the fixed lists", async () => {
    expect((await rejectQuoteAction(TENANT, ENQ, QUOTE, undefined, form({ code: "wrong_prices" })))?.ok).toBe(true);
    expect(api.rejectQuote).toHaveBeenCalledWith("tok", TENANT, QUOTE, "wrong_prices");
    expect((await rejectQuoteAction(TENANT, ENQ, QUOTE, undefined, form({ code: "price_changed" })))?.error).toBe("Choose a reason."); // a withdraw reason is not a reject reason
    expect((await withdrawQuoteAction(TENANT, ENQ, QUOTE, undefined, form({ code: "wrong_prices" })))?.error).toBe("Choose a reason.");
    expect((await withdrawQuoteAction(TENANT, ENQ, QUOTE, undefined, form({ code: "price_changed" })))?.ok).toBe(true);
    expect(api.withdrawQuote).toHaveBeenCalledWith("tok", TENANT, QUOTE, "price_changed");
    expect(api.rejectQuote).toHaveBeenCalledTimes(1);
    expect(api.withdrawQuote).toHaveBeenCalledTimes(1);
  });

  it("explain a second-factor refusal and a quote that is not approved", async () => {
    api.withdrawQuote.mockRejectedValue(new ApiRequestError(403, "mfa_required", CANARY));
    expect((await withdrawQuoteAction(TENANT, ENQ, QUOTE, undefined, form({ code: "other" })))?.error).toMatch(/authenticator app/);
    api.withdrawQuote.mockRejectedValue(new ApiRequestError(409, "quote_not_approved", CANARY));
    expect((await withdrawQuoteAction(TENANT, ENQ, QUOTE, undefined, form({ code: "other" })))?.error).toBe("Only an approved quote can be withdrawn.");
    api.rejectQuote.mockRejectedValue(new ApiRequestError(404, "not_found", CANARY));
    expect((await rejectQuoteAction(TENANT, ENQ, QUOTE, undefined, form({ code: "other" })))?.error).toBe("This quote is not available.");
  });

  it("never reveal that the data is anything but ours", () => {
    expect(JSON.stringify(QUOTE_JSON)).not.toContain(CANARY);
  });
});
