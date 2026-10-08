import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";
import { ENQ, MANUAL_QUOTE, MANUAL_QUOTE_JSON, MANUAL_SUMMARY_JSON, QUOTE_JSON, SUMMARY_JSON, TENANT } from "./quotes-fixtures";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { FLAG_TEXT, createManualQuote, isManual, parseQuote, parseQuoteSummary } from "./quotes";

beforeEach(() => vi.clearAllMocks());
const call = () => apiRequest.mock.calls[0] as [string, string, RequestInit | undefined];
const sentBody = () => JSON.parse(String(call()[2]?.body ?? "null")) as Record<string, unknown>;
const ID = "77777777-7777-4777-8777-777777777777";
const INPUT = { id: ID, customerKind: "new" as const, deliveryState: null, lines: [{ itemTypeCode: "A", qty: 3, unitPricePaise: 250_000 }] };

describe("a quote whose prices a person typed", () => {
  it("parses with nulls where a list quote has values, and keeps the item type and the price source", () => {
    const q = parseQuote(MANUAL_QUOTE_JSON);
    expect(q.pricing_kind).toBe("manual");
    expect(isManual(q)).toBe(true);
    expect([q.price_list_version_id, q.delivery_state, q.gst_supply]).toEqual([null, null, null]);
    expect(q.lines.map((l) => [l.product_id, l.item_type_code, l.price_source, l.name])).toEqual([
      [null, "A", "typed_by_person", "Type A"],
      [null, "B", "typed_by_person", "Type B"],
    ]);
    expect(q.total_paise).toBe(892_499);
  });
  it("a typed-price quote made WITH a delivery state keeps it and its label", () => {
    const q = parseQuote({ ...MANUAL_QUOTE_JSON, delivery_state: "KA", gst_supply: "inter_state" });
    expect([q.delivery_state, q.gst_supply]).toEqual(["KA", "inter_state"]);
  });
  it("the summary carries the kind", () => {
    expect(parseQuoteSummary(MANUAL_SUMMARY_JSON).pricing_kind).toBe("manual");
  });
  it.each([["pricing_kind", "typed"], ["pricing_kind", null], ["pricing_kind", 1]])("%s = %j is a contract error", (key, value) => {
    expect(() => parseQuote({ ...MANUAL_QUOTE_JSON, [key]: value })).toThrow(ApiContractError);
  });
  it("a line's price source and item type must be what the API sends", () => {
    const line = MANUAL_QUOTE_JSON.lines[0];
    expect(() => parseQuote({ ...MANUAL_QUOTE_JSON, lines: [{ ...line, price_source: "guessed" }] })).toThrow(ApiContractError);
    expect(() => parseQuote({ ...MANUAL_QUOTE_JSON, lines: [{ ...line, item_type_code: 5 }] })).toThrow(ApiContractError);
  });
  it("the warning flag has a sentence of our own", () => {
    expect(FLAG_TEXT.TYPED_PRICE_OUTSIDE_RANGE).toMatch(/outside the usual range/);
  });
});

describe("a list-price quote parses exactly as before", () => {
  it("a missing pricing_kind means list, and no manual-only key appears in the parsed quote or its lines", () => {
    const q = parseQuote(QUOTE_JSON);
    expect(isManual(q)).toBe(false);
    expect("pricing_kind" in q).toBe(false);
    expect(q.lines.every((l) => !("price_source" in l) && !("item_type_code" in l))).toBe(true);
    expect(q.price_list_version_id).toBe(QUOTE_JSON.price_list_version_id);
    expect(q.delivery_state).toBe("MH");
    expect("pricing_kind" in parseQuoteSummary(SUMMARY_JSON)).toBe(false);
  });
  it("an explicit list kind is accepted too", () => {
    expect(isManual(parseQuote({ ...QUOTE_JSON, pricing_kind: "list" }))).toBe(false);
  });
});

describe("createManualQuote", () => {
  it("posts to the enquiry's manual-quotes path with the user's token and EXACTLY the keys the API allows", async () => {
    apiRequest.mockResolvedValue(MANUAL_QUOTE_JSON);
    const q = await createManualQuote("tok", TENANT, ENQ, INPUT);
    expect(q.id).toBe(MANUAL_QUOTE);
    expect(call()[0]).toBe(`/v1/tenants/${TENANT}/enquiries/${ENQ}/manual-quotes`);
    expect(call()[1]).toBe("tok");
    expect(call()[2]?.method).toBe("POST");
    expect(sentBody()).toEqual({ id: ID, customer_kind: "new", lines: [{ item_type_code: "A", qty: 3, unit_price_paise: 250_000 }] });
    expect(Object.keys(sentBody()).sort()).toEqual(["customer_kind", "id", "lines"]);
    expect(Object.keys((sentBody().lines as object[])[0]).sort()).toEqual(["item_type_code", "qty", "unit_price_paise"]);
  });
  it("sends the delivery state only when there is one", async () => {
    apiRequest.mockResolvedValue(MANUAL_QUOTE_JSON);
    await createManualQuote("tok", TENANT, ENQ, { ...INPUT, deliveryState: "KA", customerKind: "repeat" });
    expect(sentBody()).toMatchObject({ delivery_state: "KA", customer_kind: "repeat" });
  });
  it("never sends a price source, a name, a tax rate, a total or a tenant", async () => {
    apiRequest.mockResolvedValue(MANUAL_QUOTE_JSON);
    await createManualQuote("tok", TENANT, ENQ, { ...INPUT, price: 1, total: 1, tenant_id: "x" } as unknown as typeof INPUT);
    const text = JSON.stringify(sentBody());
    for (const forbidden of ["price_source", "name", "tax", "total", "tenant", "gst", "rate"]) expect(text).not.toContain(forbidden);
  });
  it("accepts one to five lines and no other number", async () => {
    apiRequest.mockResolvedValue(MANUAL_QUOTE_JSON);
    const line = INPUT.lines[0];
    await createManualQuote("tok", TENANT, ENQ, { ...INPUT, lines: [line, line, line, line, line] });
    await expect(createManualQuote("tok", TENANT, ENQ, { ...INPUT, lines: [] })).rejects.toBeInstanceOf(ApiContractError);
    await expect(createManualQuote("tok", TENANT, ENQ, { ...INPUT, lines: Array(6).fill(line) })).rejects.toBeInstanceOf(ApiContractError);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });
  it("an id that is not a canonical UUID never reaches a path or a body", async () => {
    await expect(createManualQuote("tok", "x", ENQ, INPUT)).rejects.toBeInstanceOf(ApiContractError);
    await expect(createManualQuote("tok", TENANT, "../x", INPUT)).rejects.toBeInstanceOf(ApiContractError);
    await expect(createManualQuote("tok", TENANT, ENQ, { ...INPUT, id: "nope" })).rejects.toBeInstanceOf(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it("a response that is not a quote is a contract error and is never returned", async () => {
    apiRequest.mockResolvedValue({ ...MANUAL_QUOTE_JSON, total_paise: 1.5 });
    await expect(createManualQuote("tok", TENANT, ENQ, INPUT)).rejects.toBeInstanceOf(ApiContractError);
  });
});
