import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const api = { put: vi.fn(), void: vi.fn(), limit: vi.fn() };
const revalidatePath = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/ledger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/ledger")>()),
  putLedgerEntry: (...a: unknown[]) => api.put(...a),
  voidLedgerEntry: (...a: unknown[]) => api.void(...a),
  setCreditLimit: (...a: unknown[]) => api.limit(...a),
}));

import { recordEntryAction, setCreditLimitAction, voidEntryAction } from "./ledger-actions";
import { ledgerRefusalOf } from "./ledger-refusals";

const T = "22222222-2222-4222-8222-222222222222";
const C = "11111111-1111-4111-8111-111111111111";
const E = "ee000000-0000-4000-8000-000000000001";
const HERE = `/app/tenants/${T}/dues/${C}`;
const pay = { entryId: E, kind: "payment" as const, amount: "70,000", entryDate: "2026-10-02", dueDate: "2026-10-02", invoiceNo: "", reference: "", method: "upi", reasonCode: "", direction: "debit" as const };
const refusal = (status: number, code: string) => new ApiRequestError(status, code, "the API's own English sentence that must never reach the person");
beforeEach(() => vi.clearAllMocks());

describe("recording an entry", () => {
  it("turns typed rupees into paise, binds the party from the page and the id from the form, and refreshes the account", async () => {
    api.put.mockResolvedValue({ id: E, account_id: "a", receipt_no: "R/2026-27/000012", replayed: false });
    const r = await recordEntryAction(T, { company_id: C }, HERE, pay);
    expect(r).toEqual({ ok: true, receiptNo: "R/2026-27/000012", entryId: E, replayed: false });
    expect(api.put).toHaveBeenCalledWith("tok", T, E, { kind: "payment", party: { company_id: C }, entryDate: "2026-10-02", amountPaise: 7000000, method: "upi" });
    expect(revalidatePath).toHaveBeenCalledWith(HERE);
  });
  it("an invoice carries its due date and number; a late fee is a debit with a reason", async () => {
    api.put.mockResolvedValue({ id: E, account_id: "a", receipt_no: null, replayed: false });
    await recordEntryAction(T, { company_id: C }, HERE, { ...pay, kind: "charge", invoiceNo: " INV-9 ", dueDate: "2026-10-30" });
    expect(api.put.mock.calls[0][3]).toMatchObject({ kind: "charge", dueDate: "2026-10-30", invoiceNo: "INV-9" });
    await recordEntryAction(T, { company_id: C }, HERE, { ...pay, kind: "adjustment", direction: "debit", reasonCode: "late_fee", dueDate: "2026-10-30" });
    expect(api.put.mock.calls[1][3]).toMatchObject({ kind: "adjustment", direction: "debit", reasonCode: "late_fee", dueDate: "2026-10-30" });
    await recordEntryAction(T, { company_id: C }, HERE, { ...pay, kind: "adjustment", direction: "credit", reasonCode: "waiver" });
    expect(api.put.mock.calls[2][3]).not.toHaveProperty("dueDate");
  });
  it.each([
    ["an amount that is not an amount", { amount: "abc" }], ["less than one rupee", { amount: "0.5" }], ["three decimals", { amount: "10.123" }], ["a bad date", { entryDate: "2026-13-01" }], ["a bad entry id", { entryId: "x" }],
    ["a payment method outside the list", { method: "barter" }], ["a due date before the date", { kind: "charge" as const, dueDate: "2026-09-01" }], ["a reason outside the list", { kind: "adjustment" as const, reasonCode: "pity" }],
    ["an invoice number that is too long", { invoiceNo: "x".repeat(41) }], ["a kind outside the list", { kind: "gift" as never }],
  ])("%s never reaches the API", async (_n, over) => {
    expect(await recordEntryAction(T, { company_id: C }, HERE, { ...pay, ...over })).toEqual({ ok: false, error: "Something in the form is not right. Nothing was written down." });
    expect(api.put).not.toHaveBeenCalled();
  });
  it("a party that is not a canonical id never reaches the API", async () => {
    expect(await recordEntryAction(T, { company_id: "x" }, HERE, pay)).toMatchObject({ ok: false });
    expect(api.put).not.toHaveBeenCalled();
  });
  it.each([[403, "mfa_required", "authenticator", true], [403, "forbidden", "role does not allow", false], [409, "invoice_number_used", "already used", false], [503, "dues_unavailable", "not available", false]])("%i %s is said in our words", async (s, c, text, mfa) => {
    api.put.mockRejectedValue(refusal(s, c));
    const r = await recordEntryAction(T, { company_id: C }, HERE, pay);
    expect((r as { error: string }).error.toLowerCase()).toContain(text);
    expect("mfa" in r && r.mfa === true).toBe(mfa);
  });
  it("a rejected session goes to sign-in", async () => {
    api.put.mockRejectedValue(new ApiAuthError("x"));
    await expect(recordEntryAction(T, { company_id: C }, HERE, pay)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("voiding and the credit limit", () => {
  it("voids by id", async () => {
    api.void.mockResolvedValue({ entry_id: E, kind: "payment", voided: true });
    expect(await voidEntryAction(T, HERE, E)).toEqual({ ok: true });
    expect(await voidEntryAction(T, HERE, "x")).toMatchObject({ ok: false });
    expect(api.void).toHaveBeenCalledTimes(1);
  });
  it("sets or clears a credit limit within the bounds only", async () => {
    api.limit.mockResolvedValue({ company_id: C, limit_paise: 1 });
    expect(await setCreditLimitAction(T, C, HERE, 5_000_000)).toEqual({ ok: true });
    expect(await setCreditLimitAction(T, C, HERE, null)).toEqual({ ok: true });
    for (const bad of [0, 50, -1, 1.5, 100_000_000_001]) expect(await setCreditLimitAction(T, C, HERE, bad)).toMatchObject({ ok: false });
    expect(api.limit).toHaveBeenCalledTimes(2);
  });
});

describe("the refusal map", () => {
  it("never shows the server's text", () => {
    expect(ledgerRefusalOf(refusal(418, "teapot"))).toEqual({ key: "today.err.generic" });
    expect(() => ledgerRefusalOf(new ApiAuthError("x"))).toThrow(ApiAuthError);
  });
});
