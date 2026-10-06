import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";
import {
  EVENT_LABELS,
  EVENT_TYPES,
  LEDGER_TYPES,
  LOST_REASONS,
  LOST_REASON_LABELS,
  ORDER_STATES,
  OUTCOMES,
  OUTCOME_LABELS,
  REFUSAL_TEXT,
  STATE_LABELS,
  createOrder,
  eventsOffered,
  fetchOrder,
  fetchOrders,
  formatRupees,
  parseEventResult,
  parseMembers,
  parseOrder,
  parseOrderDetail,
  parseOrderPage,
  parseRupees,
  recordEvent,
  type EventType,
} from "./orders";
import { DETAIL_JSON, EVENT, EVENT_JSON, LEDGER, MEMBERS_JSON, ORDER, ORDER_JSON, QUOTE, RESULT_JSON, TENANT } from "./orders-fixtures";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

afterEach(() => vi.clearAllMocks());

describe("money", () => {
  it.each([
    [0, "₹0.00"],
    [5, "₹0.05"],
    [100, "₹1.00"],
    [99999, "₹999.99"],
    [100000, "₹1,000.00"],
    [15000000, "₹1,50,000.00"],
    [123456789, "₹12,34,567.89"],
    [1000000000, "₹1,00,00,000.00"],
  ])("%i paise is %s with Indian grouping", (paise, text) => expect(formatRupees(paise)).toBe(text));

  it.each([-1, 1.5, Number.NaN, 2 ** 60])("%s is a contract error, never a number on a screen", (bad) => expect(() => formatRupees(bad)).toThrow(ApiContractError));

  it.each([
    ["25,000", 2500000],
    ["1,50,000.50", 15000050],
    ["₹ 500", 50000],
    ["0.05", 5],
    ["40000.5", 4000050],
    [" 12 ", 1200],
  ])("what a person types, %s, is %i paise", (text, paise) => expect(parseRupees(text)).toBe(paise));

  it("the cap is exact: ₹1,00,00,000 is the largest amount, one paisa more is not an amount", () => {
    expect(parseRupees("1,00,00,000")).toBe(1_000_000_000);
    expect(parseRupees("10000000.00")).toBe(1_000_000_000);
    expect(parseRupees("1,00,00,000.01")).toBeNull();
    expect(parseRupees("0.01")).toBe(1);
  });

  it.each(["", "abc", "0", "0.00", "-5", "1.234", "1e3", "10,00,00,000.01", "12345678901", "5 rupees", "1..2"])("%j is not an amount", (text) => expect(parseRupees(text)).toBeNull());
});

describe("which forms a role is offered (guidance: the database decides again)", () => {
  const all: EventType[] = [...EVENT_TYPES];
  const funded = { paid_paise: 100, refunded_paise: 0 };
  const empty = { paid_paise: 0, refunded_paise: 0 };

  it("the owner is offered everything the rules allow", () => expect(eventsOffered({ role: "owner", allowed: all, order: funded })).toEqual(all));
  it("an admin is not offered a refund, nor a cancellation that carries money", () => {
    expect(eventsOffered({ role: "admin", allowed: all, order: funded })).toEqual(all.filter((e) => e !== "record_refund" && e !== "cancel"));
    expect(eventsOffered({ role: "admin", allowed: all, order: empty })).toContain("cancel");
    expect(eventsOffered({ role: "admin", allowed: all, order: { paid_paise: 500, refunded_paise: 500 } })).toContain("cancel"); // all of it refunded: no money left in it
  });
  it("sales is offered no money event, no cancellation and no refund", () => {
    const offered = eventsOffered({ role: "sales", allowed: all, order: funded });
    expect(offered).toEqual(["send_quote", "customer_accept", "customer_decline", "expire", "request_advance", "start_preparation", "dispatch", "deliver"]);
    for (const e of ["record_payment", "record_refund", "cancel"]) expect(offered).not.toContain(e);
  });
  it.each(["viewer", "", "superuser"])("%j is offered nothing", (role) => expect(eventsOffered({ role, allowed: all, order: funded })).toEqual([]));
  it("never offers what the rules did not allow", () => expect(eventsOffered({ role: "owner", allowed: ["send_quote"], order: empty })).toEqual(["send_quote"]));
});

describe("the words", () => {
  it("every state, outcome, event and reason has our wording", () => {
    for (const s of ORDER_STATES) expect(STATE_LABELS[s]).toBeTruthy();
    for (const o of OUTCOMES) expect(OUTCOME_LABELS[o]).toBeTruthy();
    for (const e of LEDGER_TYPES) expect(EVENT_LABELS[e]).toBeTruthy();
    for (const r of LOST_REASONS) expect(LOST_REASON_LABELS[r]).toBeTruthy();
    expect(OUTCOMES.map((o) => OUTCOME_LABELS[o])).toEqual(["Open", "Won", "Lost", "Cancelled", "Expired"]);
  });
  it("no label claims this system sent something", () => {
    for (const text of [...Object.values(STATE_LABELS), ...Object.values(EVENT_LABELS)]) expect(text).not.toMatch(/^Quote sent$|was sent to|we sent|emailed|messaged/i);
  });
  it("the closed refusal reasons each have a sentence", () => {
    expect(Object.keys(REFUSAL_TEXT)).toHaveLength(16);
    expect(REFUSAL_TEXT.ADVANCE_NOT_PAID).toBe("The advance has not been paid.");
  });
});

describe("parsing is strict: a body that does not match the contract is an error", () => {
  it("accepts the API's bodies", () => {
    expect(parseOrder(ORDER_JSON).order_no).toBe(7);
    expect(parseOrderDetail(DETAIL_JSON).allowed_next_events).toEqual(["send_quote", "cancel"]);
    expect(parseOrderPage({ items: [ORDER_JSON], next_cursor: null }).items).toHaveLength(1);
    expect(parseEventResult(RESULT_JSON).state).toBe("quote_sent");
    expect(parseMembers(MEMBERS_JSON)[0].display_name).toBe("Asha (synthetic)");
  });
  it.each([
    ["a state we do not know", { ...ORDER_JSON, state: "shipped" }],
    ["an outcome we do not know", { ...ORDER_JSON, outcome: "done" }],
    ["a money amount that is a string", { ...ORDER_JSON, order_total_paise: "150" }],
    ["a money amount with a fraction", { ...ORDER_JSON, paid_paise: 1.5 }],
    ["a missing field", Object.fromEntries(Object.entries(ORDER_JSON).filter(([k]) => k !== "lead_id"))],
    ["a lost reason we do not know", { ...ORDER_JSON, lost_reason: "rude" }],
  ])("refuses %s", (_what, body) => expect(() => parseOrder(body)).toThrow(ApiContractError));
  it("refuses an event type or a guidance entry we do not know", () => {
    expect(() => parseOrderDetail({ ...DETAIL_JSON, events: [{ ...EVENT_JSON, type: "teleport" }] })).toThrow(ApiContractError);
    expect(() => parseOrderDetail({ ...DETAIL_JSON, allowed_next_events: ["teleport"] })).toThrow(ApiContractError);
    expect(() => parseEventResult({ ...RESULT_JSON, replayed: "yes" })).toThrow(ApiContractError);
    expect(() => parseOrderPage({ items: "x", next_cursor: null })).toThrow(ApiContractError);
    expect(() => parseMembers({ members: [1] })).toThrow(ApiContractError);
  });
});

describe("requests", () => {
  it("reads go to the tenant's own paths with the caller's token, ids checked first", async () => {
    apiRequest.mockResolvedValue({ items: [], next_cursor: null });
    await fetchOrders("tok", TENANT, { limit: 5, cursor: "abc" });
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${TENANT}/orders?limit=5&cursor=abc`, "tok");
    apiRequest.mockResolvedValue(DETAIL_JSON);
    await fetchOrder("tok", TENANT, ORDER);
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${TENANT}/orders/${ORDER}`, "tok");
    await expect(fetchOrder("tok", TENANT, "../../x")).rejects.toThrow(ApiContractError);
    await expect(fetchOrders("tok", "nope")).rejects.toThrow(ApiContractError);
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("starting an order sends the two ids and nothing else (no figure)", async () => {
    apiRequest.mockResolvedValue(DETAIL_JSON);
    await createOrder("tok", TENANT, { id: ORDER, quoteId: QUOTE });
    const [path, token, init] = apiRequest.mock.calls[0] as [string, string, RequestInit];
    expect(path).toBe(`/v1/tenants/${TENANT}/orders`);
    expect(token).toBe("tok");
    expect(JSON.parse(String(init.body))).toEqual({ id: ORDER, quote_id: QUOTE });
  });

  it("an event carries the person's inputs only: never a total, a state, an approver or an override", async () => {
    apiRequest.mockResolvedValue(RESULT_JSON);
    await recordEvent("tok", TENANT, ORDER, { id: EVENT, type: "record_payment", occurredAt: "2026-10-06T05:00:00.000Z", amountPaise: 2500000, ledgerId: LEDGER });
    await recordEvent("tok", TENANT, ORDER, { id: EVENT, type: "customer_decline", reasonCode: "price" });
    await recordEvent("tok", TENANT, ORDER, { id: EVENT, type: "send_quote" });
    const bodies = apiRequest.mock.calls.map((c) => JSON.parse(String((c[2] as RequestInit).body)));
    expect(bodies[0]).toEqual({ id: EVENT, type: "record_payment", occurred_at: "2026-10-06T05:00:00.000Z", amount_paise: 2500000, ledger_id: LEDGER });
    expect(bodies[1]).toEqual({ id: EVENT, type: "customer_decline", reason_code: "price" });
    expect(bodies[2]).toEqual({ id: EVENT, type: "send_quote" });
    for (const b of bodies) for (const forbidden of ["order_total_paise", "state", "new_state", "approved_by", "owner_approved_by", "owner_override"]) expect(b).not.toHaveProperty(forbidden);
  });

  it("a malformed id never reaches a path", async () => {
    await expect(recordEvent("tok", TENANT, "x", { id: EVENT, type: "send_quote" })).rejects.toThrow(ApiContractError);
    await expect(recordEvent("tok", TENANT, ORDER, { id: "x", type: "send_quote" })).rejects.toThrow(ApiContractError);
    await expect(recordEvent("tok", TENANT, ORDER, { id: EVENT, type: "record_payment", amountPaise: 1, ledgerId: "x" })).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
