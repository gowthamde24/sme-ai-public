import { describe, expect, it } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { appT } from "@/i18n/app";

import { refusalOf } from "./visits-refusals";

const err = (status: number, code: string) => new ApiRequestError(status, code, "the API's own English sentence that must never reach the person");
const t = appT("en");

describe("why a visit step was refused", () => {
  it.each([
    [403, "forbidden", "today.err.role", {}],
    [403, "mfa_required", "today.err.mfa", { mfa: true }],
    [404, "not_found", "today.err.state", { stale: true }],
    [409, "visit_state", "visits.err.state", { stale: true }],
    [409, "shop_closed", "visits.err.shop_closed", {}],
    [409, "slot_invalid", "visits.err.slot_invalid", {}],
    [409, "slot_full", "visits.err.slot_full", { stale: true }],
    [409, "date_past", "visits.err.date_past", {}],
    [409, "customer_erased", "visits.err.erased", {}],
    [409, "conflict", "visits.err.conflict", {}],
    [409, "no_approved_quote", "visits.err.no_quote", { quotes: true }],
    [409, "order_exists", "visits.err.order_exists", {}],
    [409, "quote_expired", "visits.err.quote_expired", { quotes: true }],
    [409, "quote_not_approved", "visits.err.order_other", { quotes: true }],
    [409, "order_figures_invalid", "visits.err.order_other", {}],
    [409, "no_order_policy", "visits.err.order_other", {}],
    [422, "validation_error", "visits.err.invalid", {}],
    [422, "invalid_value", "visits.err.invalid", {}],
    [422, "invalid_reference", "visits.err.invalid", {}],
    [503, "visits_unavailable", "visits.err.unavailable", {}],
    [409, "outbox_state", "today.err.state", { stale: true }],
  ])("%s %s has its own sentence", (status, code, key, flags) => {
    expect(refusalOf(err(status, code))).toEqual({ key, ...flags });
  });
  it("an unknown code falls back on the status, then on the generic sentence", () => {
    expect(refusalOf(err(403, "something_new")).key).toBe("today.err.role");
    expect(refusalOf(err(404, "something_new")).key).toBe("today.err.state");
    expect(refusalOf(err(503, "something_new")).key).toBe("visits.err.unavailable");
    expect(refusalOf(err(500, "boom")).key).toBe("today.err.generic");
    expect(refusalOf(new Error("x")).key).toBe("today.err.generic");
  });
  it("every sentence exists, and none of them is the API's own text", () => {
    for (const code of ["forbidden", "mfa_required", "visit_state", "slot_full", "no_approved_quote", "order_exists", "validation_error"]) {
      const sentence = t(refusalOf(err(409, code)).key as "today.err.generic");
      expect(sentence.length).toBeGreaterThan(10);
      expect(sentence).not.toContain("API's own");
    }
  });
  it("a rejected session is thrown so the page can send the person to sign in", () => {
    expect(() => refusalOf(new ApiAuthError("x"))).toThrow(ApiAuthError);
  });
});
