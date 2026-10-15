import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { checkCredit, getLedgerEntries, getLedgerReceipt, getLedgerStatement, getLedgerSummary, importLedgerCharges, parseEntries, parseReceipt, parseStatement, parseSummary, putLedgerEntry, setCreditLimit, voidLedgerEntry } from "./ledger";
import { COMPANY, ENTRIES_JSON, ENTRY_PAYMENT, RECEIPT_JSON, RECORDED_JSON, STATEMENT_JSON, SUMMARY_JSON } from "./ledger-fixtures";

const T = "22222222-2222-2222-2222-222222222222";
const base = `/v1/tenants/${T}`;
beforeEach(() => vi.clearAllMocks());

describe("an account as the ledger sends it", () => {
  it("reads what is owed, the age of it and the open claims", () => {
    const s = parseStatement(STATEMENT_JSON);
    expect(s).toMatchObject({ outstanding_paise: 13000000, overdue_paise: 5000000, over_limit: false, credit_limit_paise: 15000000, ageing: { d0_30: 8000000, d31_60: 5000000 } });
    expect(s.open_invoices.map((o) => o.invoice_no)).toEqual(["INV-1001", "INV-1002"]);
  });
  it.each([["outstanding_paise", -1], ["ageing", null], ["as_of", "yesterday"], ["over_limit", "yes"], ["open_invoices", {}], ["company_id", "x"]])("an account with %s = %j is a contract error", (key, value) => {
    expect(() => parseStatement({ ...STATEMENT_JSON, [key]: value })).toThrow(ApiContractError);
  });
  it("reads the summary and the entries; a voided entry is marked", () => {
    expect(parseSummary(SUMMARY_JSON).items.map((r) => r.party_name)).toEqual(["Sri Rama Builders (synthetic)", "Lakshmi Constructions (synthetic)"]);
    expect(parseSummary(SUMMARY_JSON).items[1].over_limit).toBe(true);
    const e = parseEntries(ENTRIES_JSON).entries;
    expect(e.map((x) => [x.kind, x.voided])).toEqual([["payment", false], ["charge", false], ["adjustment", true]]);
    expect(e[0]).toMatchObject({ method: "upi", receipt_no: "R/2026-27/000012" });
    expect(() => parseEntries({ ...ENTRIES_JSON, entries: [{ ...ENTRIES_JSON.entries[0], kind: "gift" }] })).toThrow(ApiContractError);
  });
  it("reads a receipt", () => {
    expect(parseReceipt(RECEIPT_JSON)).toMatchObject({ receipt_no: "R/2026-27/000012", amount_paise: 7000000, method: "upi", against: "INV-1001" });
    expect(() => parseReceipt({ ...RECEIPT_JSON, method: "barter" })).toThrow(ApiContractError);
  });
});

describe("the calls", () => {
  it("reads the summary, one statement and the entries of a company", async () => {
    apiRequest.mockResolvedValue(SUMMARY_JSON);
    await getLedgerSummary("tok", T, { party: "company", asOf: "2026-10-14", after: "c", limit: 20 });
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/ledger/summary?limit=20&party=company&as_of=2026-10-14&after=c`, "tok");
    await expect(getLedgerSummary("tok", T, { asOf: "today" })).rejects.toThrow(ApiContractError);
    apiRequest.mockResolvedValueOnce(STATEMENT_JSON).mockResolvedValueOnce(ENTRIES_JSON);
    await getLedgerStatement("tok", T, { company_id: COMPANY });
    expect(apiRequest.mock.calls.at(-1)![0]).toBe(`${base}/ledger/statement?company_id=${COMPANY}`);
    await getLedgerEntries("tok", T, { contact_id: COMPANY }, 50);
    expect(apiRequest.mock.calls.at(-1)![0]).toBe(`${base}/ledger/entries?contact_id=${COMPANY}&limit=50`);
  });
  it("records a payment with the caller's id; only the fields of that kind go", async () => {
    apiRequest.mockResolvedValue(RECORDED_JSON);
    const out = await putLedgerEntry("tok", T, ENTRY_PAYMENT, { kind: "payment", party: { company_id: COMPANY }, entryDate: "2026-10-02", amountPaise: 7000000, method: "upi" });
    expect(out.receipt_no).toBe("R/2026-27/000012");
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/ledger/entries/${ENTRY_PAYMENT}`);
    expect(apiRequest.mock.calls[0][2].method).toBe("PUT");
    expect(JSON.parse(apiRequest.mock.calls[0][2].body)).toEqual({ kind: "payment", company_id: COMPANY, entry_date: "2026-10-02", amount_paise: 7000000, method: "upi" });
    await putLedgerEntry("tok", T, ENTRY_PAYMENT, { kind: "adjustment", party: { contact_id: COMPANY }, entryDate: "2026-10-02", amountPaise: 100000, dueDate: "2026-10-20", direction: "debit", reasonCode: "late_fee" });
    expect(JSON.parse(apiRequest.mock.calls[1][2].body)).toMatchObject({ kind: "adjustment", contact_id: COMPANY, direction: "debit", reason_code: "late_fee", due_date: "2026-10-20" });
    await expect(putLedgerEntry("tok", T, ENTRY_PAYMENT, { kind: "payment", party: { company_id: COMPANY }, entryDate: "soon", amountPaise: 1 })).rejects.toThrow(ApiContractError);
  });
  it("voids, imports (at most 5,000 rows), reads a receipt, checks and sets the credit limit", async () => {
    apiRequest.mockResolvedValueOnce({ entry_id: ENTRY_PAYMENT, kind: "payment", voided: true });
    expect((await voidLedgerEntry("tok", T, ENTRY_PAYMENT)).voided).toBe(true);
    apiRequest.mockResolvedValueOnce({ batch_id: ENTRY_PAYMENT, added: 2, skipped: [{ row: 3, reason: "party_not_found" }] });
    expect((await importLedgerCharges("tok", T, ENTRY_PAYMENT, [])).skipped[0]).toEqual({ row: 3, reason: "party_not_found" });
    await expect(importLedgerCharges("tok", T, ENTRY_PAYMENT, Array.from({ length: 5001 }, () => ({ company_id: COMPANY, entry_date: "2026-10-01", due_date: "2026-10-02", amount_paise: 1 })))).rejects.toThrow(ApiContractError);
    apiRequest.mockResolvedValueOnce(RECEIPT_JSON);
    await getLedgerReceipt("tok", T, ENTRY_PAYMENT);
    expect(apiRequest.mock.calls.at(-1)![0]).toBe(`${base}/ledger/receipts/${ENTRY_PAYMENT}`);
    apiRequest.mockResolvedValueOnce({ company_id: COMPANY, credit_limit_paise: 100, outstanding_paise: 50, new_amount_paise: 60, would_be_paise: 110, has_limit: true, exceeded: true });
    expect((await checkCredit("tok", T, COMPANY, 60)).exceeded).toBe(true);
    apiRequest.mockResolvedValueOnce({ company_id: COMPANY, limit_paise: null });
    expect((await setCreditLimit("tok", T, COMPANY, null)).limit_paise).toBeNull();
    expect(apiRequest.mock.calls.at(-1)![0]).toBe(`${base}/dues/customers/${COMPANY}/credit-limit`);
  });
});
