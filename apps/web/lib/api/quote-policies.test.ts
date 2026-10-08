import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";
import {
  POLICY_LIMITS,
  createQuotePolicyVersion,
  fetchQuotePolicyVersions,
  parseQuotePolicyResult,
  parseQuotePolicyVersion,
  parseQuotePolicyVersions,
  policyBody,
  type QuotePolicyInput,
} from "./quote-policies";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));
afterEach(() => vi.clearAllMocks());

// Every number below is a SYNTHETIC placeholder, not the family's policy.
const TENANT = "22222222-2222-4222-8222-222222222222";
const ID = "55555555-5555-4555-8555-555555555555";
const VERSION = {
  id: ID,
  version_no: 2,
  effective_from: "2026-10-20",
  discount_ceiling_bps: 0,
  shipping_flat_fee_paise: 0,
  shipping_free_above_paise: null,
  shipping_tax_bps: 0,
  validity_days: 7,
  new_advance_bps: 5000,
  repeat_advance_bps: 2500,
  net_days: 30,
  tax_mode: "exclusive",
  rounding_mode: "half_up",
  repeat_credit_limit_paise: 250_000,
  seller_state: "XX",
  required_inputs: ["delivery_state"],
  created_at: "2026-10-08T10:00:00.000000+00:00",
  in_force: true,
};
const RESULT = { version_id: ID, version_no: 2, effective_from: "2026-10-20", replayed: false };
const INPUT: QuotePolicyInput = {
  id: ID,
  effectiveFrom: "2026-10-20",
  discountCeilingBps: 0,
  validityDays: 7,
  newAdvanceBps: 5000,
  repeatAdvanceBps: 2500,
  netDays: 30,
  repeatCreditLimitPaise: 250_000,
  sellerState: "XX",
};
const call = () => apiRequest.mock.calls[0] as [string, string, RequestInit | undefined];
const sentBody = () => JSON.parse(String(call()[2]?.body ?? "null")) as Record<string, unknown>;

describe("what is sent", () => {
  it("publishes to the tenant's quote-policy-versions path with a POST and the user's token", async () => {
    apiRequest.mockResolvedValue(RESULT);
    await createQuotePolicyVersion("tok", TENANT, INPUT);
    expect(call()[0]).toBe(`/v1/tenants/${TENANT}/quote-policy-versions`);
    expect(call()[1]).toBe("tok");
    expect(call()[2]?.method).toBe("POST");
  });
  it("sends exactly the typed fields and the shipping fixed at zero, and nothing else", async () => {
    apiRequest.mockResolvedValue(RESULT);
    await createQuotePolicyVersion("tok", TENANT, INPUT);
    expect(sentBody()).toEqual({
      id: ID,
      effective_from: "2026-10-20",
      discount_ceiling_bps: 0,
      shipping_flat_fee_paise: 0,
      shipping_tax_bps: 0,
      validity_days: 7,
      new_advance_bps: 5000,
      repeat_advance_bps: 2500,
      net_days: 30,
      repeat_credit_limit_paise: 250_000,
      seller_state: "XX",
    });
  });
  it("never sends a free-shipping threshold, a tax mode, a rounding mode, required inputs, a tenant, a status or a GST field", () => {
    const keys = Object.keys(policyBody(INPUT));
    for (const forbidden of ["shipping_free_above_paise", "tax_mode", "rounding_mode", "required_inputs", "tenant_id", "status", "version_no", "created_by", "gst_bps", "tax_bps", "price_warn_min_paise", "price_warn_max_paise", "last_price_warn_bps"])
      expect(keys, forbidden).not.toContain(forbidden);
  });
  it("the shipping stays zero whatever the input object carries", () => {
    const body = policyBody({ ...INPUT, shipping_flat_fee_paise: 999, shipping_tax_bps: 1800 } as unknown as QuotePolicyInput);
    expect([body.shipping_flat_fee_paise, body.shipping_tax_bps]).toEqual([0, 0]);
  });
  it("an id that is not a canonical UUID never reaches a path or a body", async () => {
    await expect(createQuotePolicyVersion("t", "x", INPUT)).rejects.toBeInstanceOf(ApiContractError);
    await expect(createQuotePolicyVersion("t", TENANT, { ...INPUT, id: "../x" })).rejects.toBeInstanceOf(ApiContractError);
    await expect(fetchQuotePolicyVersions("t", "../x")).rejects.toBeInstanceOf(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it("reads the list from the same path with a GET", async () => {
    apiRequest.mockResolvedValue([VERSION]);
    const list = await fetchQuotePolicyVersions("tok", TENANT);
    expect(call()[0]).toBe(`/v1/tenants/${TENANT}/quote-policy-versions`);
    expect(call()[2]).toBeUndefined();
    expect(list).toHaveLength(1);
  });
});

describe("the list is parsed strictly", () => {
  it("accepts a version, keeps the in-force marker and a free-shipping threshold when there is one", () => {
    expect(parseQuotePolicyVersion(VERSION)).toEqual(VERSION);
    expect(parseQuotePolicyVersion({ ...VERSION, shipping_free_above_paise: 100_000 }).shipping_free_above_paise).toBe(100_000);
    expect(parseQuotePolicyVersion({ ...VERSION, in_force: false }).in_force).toBe(false);
  });
  it("keeps only the known fields", () => {
    const parsed = parseQuotePolicyVersion({ ...VERSION, content_sha256: "abc", tenant_id: TENANT });
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(VERSION).sort());
  });
  it.each(Object.keys(VERSION))("a missing %s is a contract error", (key) => {
    const copy: Record<string, unknown> = { ...VERSION };
    delete copy[key];
    expect(() => parseQuotePolicyVersion(copy)).toThrow(ApiContractError);
  });
  it.each([
    ["id", "not-a-uuid"],
    ["id", 5],
    ["version_no", 0],
    ["version_no", "2"],
    ["version_no", 1.5],
    ["effective_from", "2026-02-30"],
    ["effective_from", "20-10-2026"],
    ["effective_from", 20261020],
    ["discount_ceiling_bps", -1],
    ["discount_ceiling_bps", 10_001],
    ["discount_ceiling_bps", 12.5],
    ["discount_ceiling_bps", "0"],
    ["shipping_flat_fee_paise", 100_000_001],
    ["shipping_free_above_paise", "1"],
    ["shipping_tax_bps", 10_001],
    ["validity_days", 0],
    ["validity_days", 366],
    ["new_advance_bps", 10_001],
    ["repeat_advance_bps", -5],
    ["net_days", 181],
    ["tax_mode", null],
    ["rounding_mode", 1],
    ["repeat_credit_limit_paise", 1_000_000_001],
    ["repeat_credit_limit_paise", null],
    ["seller_state", "xx"],
    ["seller_state", "XXX"],
    ["seller_state", null],
    ["required_inputs", "delivery_state"],
    ["required_inputs", [1]],
    ["created_at", ""],
    ["created_at", "not a time"],
    ["in_force", "true"],
    ["in_force", 1],
  ])("%s = %j is a contract error", (key, value) => {
    expect(() => parseQuotePolicyVersion({ ...VERSION, [key]: value })).toThrow(ApiContractError);
  });
  it("accepts every limit exactly", () => {
    const L = POLICY_LIMITS;
    for (const [key, value] of [
      ["discount_ceiling_bps", L.discountCeilingBps.max],
      ["validity_days", L.validityDays.min],
      ["validity_days", L.validityDays.max],
      ["net_days", L.netDays.min],
      ["net_days", L.netDays.max],
      ["repeat_credit_limit_paise", L.repeatCreditLimitPaise.max],
    ] as const)
      expect(parseQuotePolicyVersion({ ...VERSION, [key]: value })[key]).toBe(value);
  });
  it("a body that is not a list, or a list with one bad version, is a contract error", () => {
    expect(() => parseQuotePolicyVersions({ items: [] })).toThrow(ApiContractError);
    expect(() => parseQuotePolicyVersions(null)).toThrow(ApiContractError);
    expect(() => parseQuotePolicyVersions([VERSION, { ...VERSION, id: "x" }])).toThrow(ApiContractError);
    expect(parseQuotePolicyVersions([])).toEqual([]);
  });
  it("a bad answer to the list or to a publish is never returned", async () => {
    apiRequest.mockResolvedValue([{ ...VERSION, net_days: "30" }]);
    await expect(fetchQuotePolicyVersions("t", TENANT)).rejects.toBeInstanceOf(ApiContractError);
    apiRequest.mockResolvedValue({ ...RESULT, replayed: "no" });
    await expect(createQuotePolicyVersion("t", TENANT, INPUT)).rejects.toBeInstanceOf(ApiContractError);
  });
});

describe("the publish result is parsed strictly", () => {
  it("accepts a result and a replay", () => {
    expect(parseQuotePolicyResult(RESULT)).toEqual(RESULT);
    expect(parseQuotePolicyResult({ ...RESULT, replayed: true }).replayed).toBe(true);
  });
  it.each([
    ["version_id", "x"],
    ["version_no", 0],
    ["version_no", "2"],
    ["effective_from", "2026-13-01"],
    ["replayed", "false"],
    ["replayed", undefined],
  ])("%s = %j is a contract error", (key, value) => {
    expect(() => parseQuotePolicyResult({ ...RESULT, [key]: value })).toThrow(ApiContractError);
  });
  it("a result that is not an object is a contract error", () => {
    expect(() => parseQuotePolicyResult(null)).toThrow(ApiContractError);
    expect(() => parseQuotePolicyResult([RESULT])).toThrow(ApiContractError);
  });
});
