import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError, ApiRequestError } from "./client";
import {
  approveQuote,
  createQuote,
  fetchEnquiryQuotes,
  fetchQuote,
  fetchQuoteSetup,
  fetchQuoteText,
  formatBps,
  formatDate,
  formatRupees,
  parseApproval,
  parseQuote,
  parseQuoteSummary,
  parseSetup,
  pickProduct,
  rejectQuote,
  withdrawQuote,
} from "./quotes";
import { ENQ, P1, QUOTE, QUOTE_JSON, SETUP_JSON, SUMMARY_JSON, TENANT, TEXT_JSON } from "./quotes-fixtures";

function respond(body: unknown, status = 200) {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(body), { status }));
}

describe("money and dates", () => {
  it("formats integer paise as rupees with Indian grouping, always two decimals", () => {
    const cases: [number, string][] = [
      [0, "₹0.00"], [5, "₹0.05"], [99, "₹0.99"], [100, "₹1.00"], [99999, "₹999.99"], [100000, "₹1,000.00"], [9607500, "₹96,075.00"], [10000000, "₹1,00,000.00"],
      [123456789, "₹12,34,567.89"], [1000000000, "₹1,00,00,000.00"], [60000200000000, "₹6,00,00,20,00,000.00"],
    ];
    for (const [paise, shown] of cases) expect(formatRupees(paise)).toBe(shown);
  });

  it("refuses anything that is not a whole, non-negative amount of paise (a float is a contract error, never rounded)", () => {
    for (const bad of [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) expect(() => formatRupees(bad)).toThrow(ApiContractError);
  });

  it("formats basis points as a percentage without noise", () => {
    expect([0, 500, 1200, 1250, 1800, 10000, 5].map(formatBps)).toEqual(["0%", "5%", "12%", "12.5%", "18%", "100%", "0.05%"]);
    expect(() => formatBps(1.5)).toThrow(ApiContractError);
    expect(() => formatBps(-1)).toThrow(ApiContractError);
  });

  it("formats a calendar date and leaves anything else as it came", () => {
    expect(formatDate("2026-10-21")).toBe("21 Oct 2026");
    expect(formatDate("2026-01-05")).toBe("5 Jan 2026");
    for (const odd of ["2026-13-01", "21/10/2026", "", "2026-10-21T00:00:00Z"]) expect(formatDate(odd)).toBe(odd);
  });
});

describe("parsing is strict: a body outside the contract is an error, never rendered", () => {
  it("parses a quote", () => {
    const q = parseQuote(QUOTE_JSON);
    expect(q.total_paise).toBe(7985900);
    expect(q.lines[0].sku).toBe("SYN-K");
    expect(q.unquoted_lines).toEqual([]);
  });

  it.each([
    ["a float amount", { total_paise: 79859.5 }], ["a string amount", { total_paise: "7985900" }], ["an unknown outcome", { outcome: "sent" }], ["an unknown status", { status: "approving" }],
    ["an unknown customer kind", { customer_kind: "vip" }], ["a missing hash", { canonical_hash: undefined }], ["flags that are not a list", { engine_flags: "X" }],
    ["a flag that is not text", { review_flags: [1] }], ["a reject code outside the list", { reject_code: "because" }], ["a withdraw code outside the list", { withdraw_code: "oops" }],
    ["a boolean that is not one", { needs_owner_approval: "no" }], ["a supply kind outside the list", { gst_supply: "export" }], ["lines that are not a list", { lines: {} }],
    ["a line with a float", { lines: [{ ...QUOTE_JSON.lines[0], qty: 2.5 }] }], ["an unquoted line without a summary", { unquoted_lines: [{ line_no: 3 }] }],
  ])("refuses %s", (_label, over) => {
    expect(() => parseQuote({ ...QUOTE_JSON, ...over })).toThrow(ApiContractError);
  });

  it.each([null, "x", [], 3])("refuses a quote that is %j", (body) => {
    expect(() => parseQuote(body)).toThrow(ApiContractError);
  });

  it("parses a summary, a setup and an approval", () => {
    expect(parseQuoteSummary(SUMMARY_JSON).outcome).toBe("draft");
    expect(() => parseQuoteSummary({ ...SUMMARY_JSON, outcome: "sent" })).toThrow(ApiContractError);
    const s = parseSetup(SETUP_JSON);
    expect(s.lines[0].suggestion?.candidates[0].sku).toBe("SYN-K");
    expect(s.lines[1].quotable).toBe(false);
    expect(Object.keys(s.delivery_states)).toContain("TG");
    for (const broken of [
      { ...SETUP_JSON, delivery_states: { MH: 5 } }, { ...SETUP_JSON, missing: [1] }, { ...SETUP_JSON, requirement_status: "approved" },
      { ...SETUP_JSON, lines: [{ ...SETUP_JSON.lines[0], suggestion: { status: "certain", reason: null, candidates: [], truncated: false } }] },
      { ...SETUP_JSON, lines: [{ ...SETUP_JSON.lines[0], pick: { product_id: P1, qty: 1, sale_unit: "dozen", source: "manual" } }] },
      { ...SETUP_JSON, price_list: [{ ...SETUP_JSON.price_list[0], unit_price_paise: 1.5 }] },
    ])
      expect(() => parseSetup(broken)).toThrow(ApiContractError);
    const approved = parseApproval({ quote_id: QUOTE, status: "approved", replayed: false, approved_by: null, text: TEXT_JSON, text_error: null });
    expect(approved.text?.sent_by_system).toBe(false);
    expect(parseApproval({ quote_id: QUOTE, status: "approved", replayed: false, approved_by: null, text: null, text_error: "quote_text_refused" }).text).toBeNull();
  });

  it("refuses a customer text that does not say the system sent nothing", () => {
    expect(() => parseApproval({ quote_id: QUOTE, status: "approved", replayed: false, approved_by: null, text: { ...TEXT_JSON, sent_by_system: true }, text_error: null })).toThrow(ApiContractError);
    expect(() => parseApproval({ quote_id: QUOTE, status: "approved", replayed: false, approved_by: null, text: { ...TEXT_JSON, sent_by_system: undefined }, text_error: null })).toThrow(ApiContractError);
  });
});

describe("requests", () => {
  const original = globalThis.fetch;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://api.test";
  });
  afterEach(() => {
    globalThis.fetch = original;
    vi.restoreAllMocks();
  });

  it("reads the setup, the enquiry's quotes, one quote and its text through the right endpoints", async () => {
    let f = respond(SETUP_JSON);
    globalThis.fetch = f as unknown as typeof fetch;
    await fetchQuoteSetup("tok", TENANT, ENQ);
    expect(f.mock.calls[0][0]).toBe(`http://api.test/v1/tenants/${TENANT}/enquiries/${ENQ}/quote-setup`);
    f = respond([SUMMARY_JSON]);
    globalThis.fetch = f as unknown as typeof fetch;
    expect(await fetchEnquiryQuotes("tok", TENANT, ENQ)).toHaveLength(1);
    expect(f.mock.calls[0][0]).toBe(`http://api.test/v1/tenants/${TENANT}/enquiries/${ENQ}/quotes`);
    f = respond(QUOTE_JSON);
    globalThis.fetch = f as unknown as typeof fetch;
    await fetchQuote("tok", TENANT, QUOTE);
    expect(f.mock.calls[0][0]).toBe(`http://api.test/v1/tenants/${TENANT}/quotes/${QUOTE}`);
    f = respond(TEXT_JSON);
    globalThis.fetch = f as unknown as typeof fetch;
    expect((await fetchQuoteText("tok", TENANT, QUOTE)).sent_by_system).toBe(false);
    expect(f.mock.calls[0][0]).toBe(`http://api.test/v1/tenants/${TENANT}/quotes/${QUOTE}/text`);
    globalThis.fetch = respond({ not: "a list" }) as unknown as typeof fetch;
    await expect(fetchEnquiryQuotes("tok", TENANT, ENQ)).rejects.toThrow(ApiContractError);
  });

  it("sends a pick with the person's choice and whether it came from a suggestion, and nothing priced", async () => {
    const f = respond({ pick_id: QUOTE, line: 2, product_id: P1, qty: 5, sale_unit: "piece", source: "manual", replayed: false });
    globalThis.fetch = f as unknown as typeof fetch;
    await pickProduct("tok", TENANT, ENQ, { line: 2, productId: P1, qty: 5, saleUnit: "piece", fromSuggestion: false });
    expect(f.mock.calls[0][0]).toBe(`http://api.test/v1/tenants/${TENANT}/enquiries/${ENQ}/picks`);
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ line: 2, product_id: P1, qty: 5, sale_unit: "piece", from_suggestion: false });
  });

  it("creates a draft with the caller's id, the kind and the state, and no figure", async () => {
    const f = respond(QUOTE_JSON, 201);
    globalThis.fetch = f as unknown as typeof fetch;
    await createQuote("tok", TENANT, ENQ, { id: QUOTE, customerKind: "repeat", deliveryState: "MH" });
    expect(f.mock.calls[0][0]).toBe(`http://api.test/v1/tenants/${TENANT}/enquiries/${ENQ}/quotes`);
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ id: QUOTE, customer_kind: "repeat", delivery_state: "MH" });
  });

  it("approves with an empty body (the approver's recomputation is the API's), and rejects and withdraws with a code only", async () => {
    let f = respond({ quote_id: QUOTE, status: "approved", replayed: false, approved_by: null, text: null, text_error: null });
    globalThis.fetch = f as unknown as typeof fetch;
    await approveQuote("tok", TENANT, QUOTE);
    expect(f.mock.calls[0][0]).toBe(`http://api.test/v1/tenants/${TENANT}/quotes/${QUOTE}/approve`);
    expect(f.mock.calls[0][1]?.body).toBeUndefined();
    f = respond({ quote_id: QUOTE, status: "rejected", replayed: false });
    globalThis.fetch = f as unknown as typeof fetch;
    await rejectQuote("tok", TENANT, QUOTE, "wrong_prices");
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ code: "wrong_prices" });
    f = respond({ quote_id: QUOTE, status: "superseded", replayed: false });
    globalThis.fetch = f as unknown as typeof fetch;
    await withdrawQuote("tok", TENANT, QUOTE, "price_changed");
    expect(f.mock.calls[0][0]).toBe(`http://api.test/v1/tenants/${TENANT}/quotes/${QUOTE}/withdraw`);
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ code: "price_changed" });
  });

  it("carries the API's status and stable code, not its text, when a request is refused", async () => {
    globalThis.fetch = respond({ error: { code: "mfa_required", message: "Confirm with your authenticator app" } }, 403) as unknown as typeof fetch;
    await expect(approveQuote("tok", TENANT, QUOTE)).rejects.toMatchObject({ status: 403, code: "mfa_required" });
    await expect(approveQuote("tok", TENANT, QUOTE)).rejects.toBeInstanceOf(ApiRequestError);
  });

  it("never lets a malformed id reach the API", async () => {
    const f = respond({});
    globalThis.fetch = f as unknown as typeof fetch;
    await expect(fetchQuote("tok", "../me", QUOTE)).rejects.toThrow(ApiContractError);
    await expect(fetchQuote("tok", TENANT, "x")).rejects.toThrow(ApiContractError);
    await expect(fetchQuoteSetup("tok", TENANT, "../x")).rejects.toThrow(ApiContractError);
    await expect(approveQuote("tok", TENANT, "1")).rejects.toThrow(ApiContractError);
    await expect(pickProduct("tok", TENANT, ENQ, { line: 1, productId: "nope", qty: 1, saleUnit: "piece", fromSuggestion: false })).rejects.toThrow(ApiContractError);
    await expect(createQuote("tok", TENANT, ENQ, { id: "x", customerKind: "new", deliveryState: "MH" })).rejects.toThrow(ApiContractError);
    expect(f).not.toHaveBeenCalled();
  });
});
