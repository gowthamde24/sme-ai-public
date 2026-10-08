import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { ENQ, MANUAL_QUOTE, TENANT } from "@/lib/api/quotes-fixtures";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const api = { createManualQuote: vi.fn() };
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/quotes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/quotes")>()),
  createManualQuote: (...a: unknown[]) => api.createManualQuote(...a),
}));

import { createManualQuoteAction } from "./manual-quote-actions";

const CANARY = "CANARY-5e7a90";
const PAGE = `/app/tenants/${TENANT}/enquiries/${ENQ}`;
const ID = "77777777-7777-4777-8777-777777777777";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}
const GOOD = { quote_id: ID, customer_kind: "new", line_count: "2", code_1: "A", qty_1: "3", price_1: "2500", code_2: "B", qty_2: "1", price_2: "999.99" };
const make = (over: Record<string, string> = {}) => createManualQuoteAction(TENANT, ENQ, undefined, form({ ...GOOD, ...over }));
const refused = (status: number, code: string) => new ApiRequestError(status, code, `${CANARY} secret`);

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal2" });
  api.createManualQuote.mockResolvedValue({ id: MANUAL_QUOTE });
});

describe("createManualQuoteAction", () => {
  it("authenticates first, converts rupees to integer paise, sends exactly the typed lines and goes to the new quote", async () => {
    expect(await redirectTarget(() => make())).toBe(`${PAGE}?quote=${MANUAL_QUOTE}`);
    expect(requireUser).toHaveBeenCalled();
    expect(api.createManualQuote).toHaveBeenCalledWith("tok", TENANT, ENQ, {
      id: ID,
      customerKind: "new",
      deliveryState: null,
      lines: [
        { itemTypeCode: "A", qty: 3, unitPricePaise: 250_000 },
        { itemTypeCode: "B", qty: 1, unitPricePaise: 99_999 },
      ],
    });
    expect(revalidatePath).toHaveBeenCalledWith(PAGE);
  });
  it("sends a repeat customer as chosen and never a delivery state, even if the form carries one", async () => {
    await make({ delivery_state: "KA", customer_kind: "repeat" }).catch(() => undefined);
    expect(api.createManualQuote.mock.calls[0][3]).toMatchObject({ deliveryState: null, customerKind: "repeat" });
  });
  it("a retry sends the SAME id (the API replays it); another page render sends its own", async () => {
    await make().catch(() => undefined);
    await make().catch(() => undefined);
    await make({ quote_id: "66666666-6666-4666-8666-666666666666" }).catch(() => undefined);
    expect(api.createManualQuote.mock.calls.map((c) => (c[3] as { id: string }).id)).toEqual([ID, ID, "66666666-6666-4666-8666-666666666666"]);
  });
  it("reads only the keys it knows: a price, a total, a rate or a tenant in the form is not believed", async () => {
    await make({ total: "1", gst: "28", tax_bps: "2800", tenant_id: "x", unit_price_paise: "1", price_source: "list" }).catch(() => undefined);
    const sent = JSON.stringify(api.createManualQuote.mock.calls[0][3]);
    for (const forbidden of ["total", "gst", "tax", "tenant", "price_source", '"unit_price_paise":1,']) expect(sent).not.toContain(forbidden);
  });
  it("refuses with a sentence of ours, before any request, a bad id, kind, line count, quantity, price or item type", async () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ quote_id: "x" }, /out of date/],
      [{ customer_kind: "vip" }, /new or a repeat/],
      [{ line_count: "0" }, /out of date/],
      [{ line_count: "6" }, /out of date/],
      [{ line_count: "x" }, /out of date/],
      [{ qty_1: "0" }, /Line 1: Quantity/],
      [{ qty_2: "10001" }, /Line 2: Quantity/],
      [{ price_1: "1.505" }, /Line 1: Price per piece/],
      [{ price_1: "abc" }, /Line 1: Price per piece/],
      [{ price_2: "-1" }, /Line 2: Price per piece/],
      [{ price_2: "0" }, /Line 2: Price per piece/],
      [{ code_1: "" }, /Line 1: Choose an item type/],
    ];
    for (const [over, pattern] of cases) {
      const r = await make(over);
      expect(r?.ok, JSON.stringify(over)).toBe(false);
      expect(r?.error).toMatch(pattern);
    }
    expect(api.createManualQuote).not.toHaveBeenCalled();
  });
  it("a tenant or enquiry id that is not a canonical UUID is not available", async () => {
    expect(await createManualQuoteAction("x", ENQ, undefined, form(GOOD))).toEqual({ ok: false, error: "This enquiry is not available." });
    expect(await createManualQuoteAction(TENANT, "../x", undefined, form(GOOD))).toEqual({ ok: false, error: "This enquiry is not available." });
    expect(api.createManualQuote).not.toHaveBeenCalled();
  });
  it("an expired session goes to the login page", async () => {
    api.createManualQuote.mockRejectedValue(new ApiAuthError("expired"));
    expect(await redirectTarget(() => make())).toBe("/login");
  });
});

describe("every refusal is a fixed sentence of ours", () => {
  const cases: [number, string, RegExp, boolean][] = [
    [409, "enquiry_has_requirement", /already has a requirement from the line-by-line flow/, true],
    [403, "price_not_typed_by_person", /Only a person can type a price/, false],
    [403, "forbidden", /Only an owner or an admin/, false],
    [422, "quote_input_missing", /GST rate that applies today/, false],
    [422, "invalid_delivery_state", /not accepted/, false],
    [422, "invalid_reference", /item types is not available/, false],
    [422, "invalid_value", /no longer sold/, false],
    [422, "validation_error", /not accepted/, false],
    [409, "quote_mismatch", /nothing was saved/, false],
    [409, "quote_stale", /policy changed/, false],
    [409, "conflict", /out of date/, false],
    [404, "not_found", /not available/, false],
    [503, "quotes_unavailable", /not available right now/, false],
    [502, "upstream_error", /not available right now/, false],
    [500, "weird", /Could not save/, false],
  ];
  it.each(cases)("%i %s", async (status, code, pattern, blocked) => {
    api.createManualQuote.mockRejectedValue(refused(status, code));
    const r = await make();
    expect(r?.ok).toBe(false);
    expect(r?.error).toMatch(pattern);
    expect(Boolean(r?.blocked)).toBe(blocked);
    expect(JSON.stringify(r)).not.toContain(CANARY);
  });
  it("a requirement that is in the way blocks the form: pressing again cannot help", async () => {
    api.createManualQuote.mockRejectedValue(refused(409, "enquiry_has_requirement"));
    expect((await make())?.blocked).toBe(true);
  });
});
