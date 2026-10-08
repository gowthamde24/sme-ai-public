import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiContractError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const apiRequest = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
// The real API client of the quote policy runs; only the one door to the network is replaced, so the test sees the exact request the page would make.
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { FIELD_TEXT, OUT_OF_DATE, publishRefusal } from "./quote-policy-logic";
import { publishQuotePolicyAction } from "./quote-policy-actions";

// Every number in this file is a SYNTHETIC placeholder for a test, not a suggestion and not the family's policy.
const T = "22222222-2222-4222-8222-222222222222";
const ID = "55555555-5555-4555-8555-555555555555";
const CANARY = "CANARY-8c2f19";
const GOOD: Record<string, string> = {
  policy_id: ID,
  effective_from: "2026-10-20",
  validity_days: "7",
  new_advance: "50",
  repeat_advance: "25.5",
  new_net_days: "10",
  repeat_net_days: "45",
  credit_limit: "2500.50",
  seller_state: "XX",
  discount_ceiling: "0",
};
const RESULT = { version_id: ID, version_no: 3, effective_from: "2026-10-20", replayed: false };

function form(over: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries({ ...GOOD, ...over })) data.set(k, v);
  return data;
}
const run = (over: Record<string, string> = {}) => publishQuotePolicyAction(T, undefined, form(over));
const sentBody = (n = 0) => JSON.parse(String((apiRequest.mock.calls[n] as [string, string, RequestInit])[2].body)) as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T10:00:00.000Z")); // 15:30 in India: the date there is 2026-10-08
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal2" });
  apiRequest.mockResolvedValue(RESULT);
});
afterEach(() => vi.useRealTimers());

describe("publishQuotePolicyAction: what it sends", () => {
  it("authenticates first, then posts to the tenant's quote-policy-versions with the user's token", async () => {
    await run();
    expect(requireUser).toHaveBeenCalledTimes(1);
    const [path, token, init] = apiRequest.mock.calls[0] as [string, string, RequestInit];
    expect([path, token, init.method]).toEqual([`/v1/tenants/${T}/quote-policy-versions`, "tok", "POST"]);
  });
  it("sends the typed numbers converted exactly, the page's id, and the shipping fixed at zero", async () => {
    await run();
    expect(sentBody()).toEqual({
      id: ID,
      effective_from: "2026-10-20",
      discount_ceiling_bps: 0,
      shipping_flat_fee_paise: 0,
      validity_days: 7,
      new_advance_bps: 5000,
      repeat_advance_bps: 2550,
      new_net_days: 10,
      repeat_net_days: 45,
      repeat_credit_limit_paise: 250_050,
      seller_state: "XX",
    });
  });
  it("sends no free-shipping threshold, tax mode, rounding mode or required inputs", async () => {
    await run();
    for (const key of ["shipping_tax_bps", "shipping_free_above_paise", "tax_mode", "rounding_mode", "required_inputs", "gst_rate_bps", "gst_effective_from", "net_days"]) expect(Object.keys(sentBody())).not.toContain(key);
  });
  it("a form that carries shipping, tax, tenant, status or GST fields of its own is not believed: nothing but the eight fields and the id is read", async () => {
    await run({
      shipping_flat_fee_paise: "99900",
      shipping_tax_bps: "1800",
      shipping_free_above_paise: "5",
      tax_mode: "inclusive",
      rounding_mode: "down",
      required_inputs: "deadline",
      tenant_id: "99999999-9999-4999-8999-999999999999",
      status: "approved",
      gst_bps: "1800",
      version_no: "99",
    });
    const body = sentBody();
    expect(body.shipping_flat_fee_paise).toBe(0);
    expect(Object.keys(body)).not.toContain("shipping_tax_bps");
    expect(Object.keys(body).sort()).toEqual(
      ["discount_ceiling_bps", "effective_from", "id", "new_advance_bps", "new_net_days", "repeat_advance_bps", "repeat_credit_limit_paise", "repeat_net_days", "seller_state", "shipping_flat_fee_paise", "validity_days"].sort(),
    );
  });
  it("revalidates the policy page so the list shows the new version", async () => {
    await run();
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/quote-policy`);
  });
  it("answers with ONE sentence that names the version number and the start date", async () => {
    expect(await run()).toEqual({ ok: true, message: "Published version 3, starting on 20 Oct 2026." });
  });
  it("a replay says so; it is still a success", async () => {
    apiRequest.mockResolvedValue({ ...RESULT, replayed: true });
    expect(await run()).toEqual({ ok: true, message: "Version 3 was already published, starting on 20 Oct 2026. Nothing was published twice." });
  });
  it("a retry sends the same id; a different page render sends its own", async () => {
    await run();
    await run();
    await run({ policy_id: "66666666-6666-4666-8666-666666666666" });
    expect([sentBody(0).id, sentBody(1).id, sentBody(2).id]).toEqual([ID, ID, "66666666-6666-4666-8666-666666666666"]);
  });
  it("the edges are accepted: a start date of today, zero advances, zero credit, the longest validity, the biggest credit and discount", async () => {
    await run({ effective_from: "2026-10-08", validity_days: "365", new_advance: "0", repeat_advance: "100", new_net_days: "180", repeat_net_days: "0", credit_limit: "10000000", discount_ceiling: "100" });
    expect(sentBody()).toMatchObject({ validity_days: 365, new_advance_bps: 0, repeat_advance_bps: 10_000, new_net_days: 180, repeat_net_days: 0, repeat_credit_limit_paise: 1_000_000_000, discount_ceiling_bps: 10_000 });
  });
  it("spaces around the numbers are ignored", async () => {
    await run({ validity_days: " 7 ", new_advance: "  50", credit_limit: "2500.50  ", seller_state: " XX " });
    expect(sentBody()).toMatchObject({ validity_days: 7, new_advance_bps: 5000, repeat_credit_limit_paise: 250_050, seller_state: "XX" });
  });
});

describe("publishQuotePolicyAction: a wrong value is refused with a sentence BEFORE any request", () => {
  it.each(Object.keys(FIELD_TEXT))("a missing %s", async (field) => {
    expect(await run({ [field]: "" })).toEqual({ ok: false, error: FIELD_TEXT[field as keyof typeof FIELD_TEXT] });
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it.each([
    ["effective_from", "2026-10-07"],
    ["effective_from", "2026-02-30"],
    ["validity_days", "0"],
    ["validity_days", "366"],
    ["validity_days", "1e1"],
    ["new_advance", "100.01"],
    ["new_advance", "12.345"],
    ["new_advance", "-0.01"],
    ["repeat_advance", "٥٠"],
    ["new_net_days", "181"],
    ["repeat_net_days", "181"],
    ["credit_limit", "10000000.01"],
    ["credit_limit", "1,000"],
    ["seller_state", "xx"],
    ["seller_state", "XXX"],
    ["discount_ceiling", "100.01"],
    ["discount_ceiling", "1e3"],
  ])("%s = %j", async (field, value) => {
    expect(await run({ [field]: value })).toEqual({ ok: false, error: FIELD_TEXT[field as keyof typeof FIELD_TEXT] });
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it("a start date of today in India is not 'in the past', whatever the server's own date is", async () => {
    vi.setSystemTime(new Date("2026-10-08T20:00:00.000Z")); // 01:30 on 9 Oct in India
    expect(await run({ effective_from: "2026-10-08" })).toEqual({ ok: false, error: FIELD_TEXT.effective_from });
    expect((await run({ effective_from: "2026-10-09" }))?.ok).toBe(true);
  });
  it("a missing or malformed id is out of date, and a bad tenant is not available", async () => {
    expect(await run({ policy_id: "" })).toEqual({ ok: false, error: OUT_OF_DATE });
    expect(await run({ policy_id: "x" })).toEqual({ ok: false, error: OUT_OF_DATE });
    expect(await publishQuotePolicyAction("../x", undefined, form())).toEqual({ ok: false, error: "This workspace is not available." });
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it("a field that is not text (a file) counts as empty", async () => {
    const data = form();
    data.set("validity_days", new File(["7"], "7.txt"));
    expect(await publishQuotePolicyAction(T, undefined, data)).toEqual({ ok: false, error: FIELD_TEXT.validity_days });
  });
  it("what the person typed is never repeated in a sentence", async () => {
    const r = await run({ new_advance: `${CANARY}-typed` });
    expect(JSON.stringify(r)).not.toContain(CANARY);
  });
});

describe("publishQuotePolicyAction: every refusal is one of our sentences", () => {
  const refuse = (status: number, code: string, message = `server text ${CANARY}`, reason?: string) => apiRequest.mockRejectedValue(new ApiRequestError(status, code, message, reason));
  it.each([
    [403, "forbidden"],
    [403, "mfa_required"],
    [422, "validation_error"],
    [422, "invalid_value"],
    [409, "conflict"],
    [404, "not_found"],
    [429, "rate_limited"],
    [429, "http_error"],
    [503, "quotes_unavailable"],
    [502, "upstream_error"],
    [503, "api_unreachable"],
    [500, "something_new"],
  ])("%i %s gives exactly the sentence for that code, with no API text", async (status, code) => {
    refuse(status, code);
    const r = await run();
    expect(r).toEqual({ ok: false, ...publishRefusal(status, code) });
    expect(JSON.stringify(r)).not.toContain(CANARY);
  });
  it("a missing second factor carries the reason that makes the screen show the link", async () => {
    refuse(403, "mfa_required");
    expect(await run()).toMatchObject({ ok: false, reason: "mfa" });
  });
  it("an invalid session goes to the sign-in page", async () => {
    apiRequest.mockRejectedValue(new ApiAuthError("expired"));
    expect(await redirectTarget(() => run())).toBe("/login");
  });
  it("an answer that does not match the contract, or a network failure, is a plain 'could not publish' and nothing is revalidated", async () => {
    apiRequest.mockResolvedValue({ ...RESULT, version_no: "3" });
    const bad = await run();
    expect(bad).toMatchObject({ ok: false });
    expect(bad?.error ?? "").toMatch(/Could not publish this/);
    apiRequest.mockRejectedValue(new TypeError(`boom ${CANARY}`));
    const net = await run();
    expect(JSON.stringify(net)).not.toContain(CANARY);
    apiRequest.mockRejectedValue(new ApiContractError(`contract ${CANARY}`));
    expect(JSON.stringify(await run())).not.toContain(CANARY);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("a refusal does not revalidate the page", async () => {
    refuse(422, "invalid_value");
    await run();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
