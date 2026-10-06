import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { ENQ, EVENT, LEDGER, ORDER, QUOTE, TENANT } from "@/lib/api/orders-fixtures";
import { REFUSAL_TEXT, parseEventResult } from "@/lib/api/orders";
import { RESULT_JSON } from "@/lib/api/orders-fixtures";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const api = { createOrder: vi.fn(), recordEvent: vi.fn() };
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/orders")>()),
  createOrder: (...a: unknown[]) => api.createOrder(...a),
  recordEvent: (...a: unknown[]) => api.recordEvent(...a),
}));

import { recordEventAction, startOrderAction } from "./order-actions";

const CANARY = "CANARY-5e1a77";
const TODAY = "2026-10-06";
const RENDERED = "2026-10-06T08:30:00.000Z";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}
const base = { event_id: EVENT, rendered_at: RENDERED, today: TODAY };
const record = (type: string, values: Record<string, string> = {}) => recordEventAction(TENANT, ORDER, type, undefined, form({ ...base, ...values }));
const start = (over: Record<string, string> = {}) => startOrderAction(TENANT, ENQ, QUOTE, undefined, form({ order_id: ORDER, ...over }));

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal2" });
  api.createOrder.mockResolvedValue({ id: ORDER });
  api.recordEvent.mockResolvedValue(parseEventResult(RESULT_JSON));
});

describe("startOrderAction", () => {
  it("authenticates first, sends only the two ids, and goes to the new order", async () => {
    expect(await redirectTarget(() => start())).toBe(`/app/tenants/${TENANT}/orders/${ORDER}`);
    expect(api.createOrder).toHaveBeenCalledWith("tok", TENANT, { id: ORDER, quoteId: QUOTE });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${TENANT}/enquiries/${ENQ}`);
  });

  it("refuses a stale form and malformed ids before the API is called", async () => {
    expect(await start({ order_id: "x" })).toEqual({ ok: false, error: "This form is out of date. Reload the page and try again." });
    expect((await startOrderAction("x", ENQ, QUOTE, undefined, form({ order_id: ORDER })))?.ok).toBe(false);
    expect((await startOrderAction(TENANT, ENQ, "x", undefined, form({ order_id: ORDER })))?.ok).toBe(false);
    expect(api.createOrder).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiRequestError(403, "mfa_required", CANARY), /authenticator app/],
    [new ApiRequestError(403, "forbidden", CANARY), /role does not allow/],
    [new ApiRequestError(409, "order_exists", CANARY), /already has an order/],
    [new ApiRequestError(409, "quote_not_approved", CANARY), /Only an approved quote/],
    [new ApiRequestError(409, "quote_expired", CANARY), /has expired/],
    [new ApiRequestError(409, "no_order_policy", CANARY), /order policy/],
    [new ApiRequestError(409, "order_figures_invalid", CANARY), /cannot become an order/],
    [new ApiRequestError(404, "not_found", CANARY), /not available/],
    [new ApiRequestError(503, "orders_unavailable", CANARY), /not available right now/],
    [new Error(CANARY), /Could not save/],
  ])("answers in our own words and never echoes the API's text (%#)", async (error, words) => {
    api.createOrder.mockRejectedValue(error);
    const r = await start();
    expect(r?.error).toMatch(words);
    expect(JSON.stringify(r)).not.toContain(CANARY);
  });

  it("a rejected session goes to the sign-in page", async () => {
    api.createOrder.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => start())).toBe("/login");
  });
});

describe("recordEventAction", () => {
  it("a plain event sends the id, the type and the page's own render time (so a retry sends the same value)", async () => {
    const r = await record("send_quote");
    expect(r).toEqual({ ok: true, message: "Recorded: I sent the quote. Nothing was sent to anyone." });
    expect(api.recordEvent).toHaveBeenCalledWith("tok", TENANT, ORDER, { id: EVENT, type: "send_quote", occurredAt: RENDERED });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${TENANT}/orders/${ORDER}`);
  });

  it("a payment carries the amount in paise, the ledger id and the day; today means the render time, an earlier day noon in India", async () => {
    await record("record_payment", { amount: "1,50,000.50", ledger_id: LEDGER, happened_on: TODAY });
    expect(api.recordEvent).toHaveBeenLastCalledWith("tok", TENANT, ORDER, { id: EVENT, type: "record_payment", occurredAt: RENDERED, amountPaise: 15000050, ledgerId: LEDGER });
    await record("record_refund", { amount: "500", ledger_id: LEDGER, happened_on: "2026-10-01" });
    expect(api.recordEvent).toHaveBeenLastCalledWith("tok", TENANT, ORDER, { id: EVENT, type: "record_refund", occurredAt: "2026-10-01T06:30:00.000Z", amountPaise: 50000, ledgerId: LEDGER });
  });

  it("a decline carries one reason from the closed list", async () => {
    await record("customer_decline", { reason: "price" });
    expect(api.recordEvent).toHaveBeenLastCalledWith("tok", TENANT, ORDER, { id: EVENT, type: "customer_decline", occurredAt: RENDERED, reasonCode: "price" });
    expect((await record("customer_decline", { reason: "rude" }))?.error).toBe("Choose why the customer declined.");
    expect((await record("customer_decline"))?.error).toBe("Choose why the customer declined.");
  });

  it("nothing but the person's inputs is ever sent: other form fields are ignored", async () => {
    await record("send_quote", { order_total: "1", state: "closed_paid", owner_override: "true", approved_by: "x" });
    const sent = api.recordEvent.mock.calls[0][3] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["id", "occurredAt", "type"]);
  });

  it("refuses a malformed type, id, amount, day or ledger id before the API is called", async () => {
    expect((await record("teleport"))?.ok).toBe(false);
    expect((await recordEventAction(TENANT, "x", "send_quote", undefined, form(base)))?.ok).toBe(false);
    expect((await recordEventAction("x", ORDER, "send_quote", undefined, form(base)))?.ok).toBe(false);
    expect((await record("send_quote", { event_id: "x" }))?.error).toMatch(/out of date/);
    for (const amount of ["", "0", "abc", "-5", "1.234", "99999999999"]) expect((await record("record_payment", { amount, ledger_id: LEDGER, happened_on: TODAY }))?.error).toMatch(/Enter the amount/);
    expect((await record("record_payment", { amount: "5", ledger_id: "x", happened_on: TODAY }))?.error).toMatch(/out of date/);
    for (const happened_on of ["2026-10-07", "tomorrow", "06/10/2026", "2099-01-01"]) expect((await record("record_payment", { amount: "5", ledger_id: LEDGER, happened_on }))?.error).toMatch(/Choose the day/);
    expect((await record("send_quote", { rendered_at: "never" }))?.error).toMatch(/Choose the day/);
    expect(api.recordEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["mfa_required", 403, undefined, /authenticator app/],
    ["owner_required", 403, undefined, /needs the owner/],
    ["forbidden", 403, undefined, /role does not allow/],
    ["order_closed", 409, undefined, /order is closed/],
    ["order_changed", 409, undefined, /changed while you were working/],
    ["conflict", 409, undefined, /out of date/],
    ["order_event_refused", 409, "ADVANCE_NOT_PAID", /The advance has not been paid\./],
    ["order_event_refused", 409, "OVERPAYMENT", /more than the order's total/],
    ["order_event_refused", 409, "SOMETHING_NEW", /The order rules refuse this event\./],
    ["order_event_refused", 409, undefined, /The order rules refuse this event\./],
    ["x", 422, undefined, /not accepted/],
    ["x", 409, undefined, /not possible right now/],
  ])("%s (%i, %s) is answered in our own words", async (code, status, reason, words) => {
    api.recordEvent.mockRejectedValue(new ApiRequestError(status, code, CANARY, reason));
    const r = await record("dispatch");
    expect(r?.ok).toBe(false);
    expect(r?.error).toMatch(words);
    expect(JSON.stringify(r)).not.toContain(CANARY);
  });

  it("every refusal sentence the lifecycle can give is shown as the API says it", async () => {
    for (const [reason, sentence] of Object.entries(REFUSAL_TEXT)) {
      api.recordEvent.mockRejectedValue(new ApiRequestError(409, "order_event_refused", CANARY, reason));
      expect((await record("dispatch"))?.error).toBe(sentence);
    }
  });

  it("says what the rules flagged, in our words, and that nothing was sent", async () => {
    api.recordEvent.mockResolvedValue({ ...parseEventResult(RESULT_JSON), flags: ["ADVANCE_OVERRIDE", "SOMETHING_ELSE"] });
    const r = await record("dispatch");
    expect(r?.message).toContain("Nothing was sent to anyone.");
    expect(r?.message).toContain("used the owner's override");
    expect(r?.message).toContain("flagged this for the owner to review");
    expect(r?.message).not.toContain("SOMETHING_ELSE");
  });

  it("a rejected session goes to the sign-in page", async () => {
    api.recordEvent.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => record("send_quote"))).toBe("/login");
  });
});
