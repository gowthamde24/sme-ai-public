import type { CreditCheckOut, EntryOut, ReceiptOut, StatementOut, SummaryRowOut } from "@contracts";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, int, list, oneOf, optInt, optStr, rec, str, uuid, word } from "./shape";

/**
 * The shared receivables ledger (job CO for construction dues, job CS for education fees; the API of job CP, ADR 0086): one engine for a customer's dues and a student's fees. A party is a company or a contact;
 * an entry is a charge, a payment (with a receipt number), an adjustment or a concession and is never changed, only voided. Money is integer paise and comes from entries a person made, never from a model.
 * Server side only, with the signed-in user's own token. A response that does not match the contract is an error and nothing is shown.
 *
 * Who may do what (the API and the database decide; the screens only hide what they would refuse): Owner, Admin and Sales read the ledger and record charges and payments; adjustments and concessions are the
 * Owner's or Admin's with the second factor; Owner and Admin void; the credit limit is the Owner's with the second factor; a Viewer reads no money.
 */
export const MAX_PAISE = 100_000_000_000;
export const METHODS = ["cash", "upi", "bank_transfer", "cheque", "card", "other"] as const;
export type Method = (typeof METHODS)[number];
export const REASONS = ["correction", "late_fee", "waiver", "rounding", "scholarship", "sibling", "staff_ward", "hardship", "merit", "other"] as const;
export type Reason = (typeof REASONS)[number];
export const ENTRY_KINDS = ["charge", "payment", "adjustment", "concession"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

const paise = (v: unknown, what: string) => int(v, what, 0, MAX_PAISE);
const day = (v: unknown, what: string) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : bad(what));
const optDay = (v: unknown, what: string) => (v === null || v === undefined ? null : day(v, what));
const optUuid = (v: unknown, what: string) => (v === null || v === undefined ? null : uuid(v, what));

function parseAgeing(json: unknown) {
  const r = rec(json, "ageing");
  return { d0_30: paise(r.d0_30, "d0_30"), d31_60: paise(r.d31_60, "d31_60"), d61_90: paise(r.d61_90, "d61_90"), d90_plus: paise(r.d90_plus, "d90_plus") };
}
function parseOverdue(json: unknown) {
  if (json === null || json === undefined) return null;
  const r = rec(json, "overdue ageing");
  return { not_due: paise(r.not_due, "not_due"), d1_30: paise(r.d1_30, "d1_30"), d31_60: paise(r.d31_60, "d31_60"), d61_90: paise(r.d61_90, "d61_90"), d90_plus: paise(r.d90_plus, "d90_plus") };
}

function parseOpen(json: unknown): StatementOut["open_invoices"][number] {
  const r = rec(json, "open claim");
  return {
    invoice_id: uuid(r.invoice_id, "invoice_id"),
    entry_id: optUuid(r.entry_id, "entry_id"),
    kind: r.kind === null || r.kind === undefined ? null : oneOf(r.kind, ["charge", "adjustment"] as const, "kind"),
    invoice_no: optStr(r.invoice_no, "invoice_no", 80),
    reference: optStr(r.reference, "reference", 80),
    invoice_date: day(r.invoice_date, "invoice_date"),
    due_date: day(r.due_date, "due_date"),
    amount_paise: paise(r.amount_paise, "amount"),
    open_paise: paise(r.open_paise, "open"),
    age_days: int(r.age_days, "age_days", 0, 100_000),
    overdue_days: int(r.overdue_days, "overdue_days", 0, 100_000),
  };
}

function statementFields(r: Record<string, unknown>) {
  return {
    account_id: optUuid(r.account_id, "account_id"),
    company_id: optUuid(r.company_id, "company_id"),
    contact_id: optUuid(r.contact_id, "contact_id"),
    as_of: day(r.as_of, "as_of"),
    invoiced_paise: paise(r.invoiced_paise, "invoiced"),
    paid_paise: paise(r.paid_paise, "paid"),
    payments_paise: r.payments_paise === undefined ? undefined : paise(r.payments_paise, "payments"),
    concessions_paise: r.concessions_paise === undefined ? undefined : paise(r.concessions_paise, "concessions"),
    adjustments_paise: r.adjustments_paise === undefined ? undefined : int(r.adjustments_paise, "adjustments", -MAX_PAISE, MAX_PAISE),
    outstanding_paise: paise(r.outstanding_paise, "outstanding"),
    credit_paise: paise(r.credit_paise, "credit"),
    overdue_paise: paise(r.overdue_paise, "overdue"),
    ageing: parseAgeing(r.ageing),
    overdue_ageing: parseOverdue(r.overdue_ageing),
    open_invoices: list(r.open_invoices, "open claims", 500).map(parseOpen),
    credit_limit_paise: optInt(r.credit_limit_paise, "credit_limit", 0, MAX_PAISE),
    over_limit: bool(r.over_limit, "over_limit"),
  };
}

export function parseStatement(json: unknown): StatementOut {
  return statementFields(rec(json, "statement"));
}

export function parseSummary(json: unknown): { items: SummaryRowOut[]; next_cursor: string | null } {
  const r = rec(json, "summary");
  return {
    items: list(r.items, "items", 200).map((row) => {
      const x = rec(row, "summary row");
      return {
        ...statementFields(x),
        company_name: optStr(x.company_name, "company_name", 200),
        party_kind: x.party_kind === null || x.party_kind === undefined ? null : oneOf(x.party_kind, ["company", "contact"] as const, "party_kind"),
        party_name: optStr(x.party_name, "party_name", 200),
      };
    }),
    next_cursor: optStr(r.next_cursor, "next_cursor", 400),
  };
}

export function parseEntry(json: unknown): EntryOut {
  const r = rec(json, "entry");
  return {
    id: uuid(r.id, "id"),
    kind: oneOf(r.kind, ENTRY_KINDS, "kind"),
    direction: oneOf(r.direction, ["debit", "credit"] as const, "direction"),
    amount_paise: paise(r.amount_paise, "amount"),
    entry_date: day(r.entry_date, "entry_date"),
    due_date: optDay(r.due_date, "due_date"),
    invoice_no: optStr(r.invoice_no, "invoice_no", 80),
    reference: optStr(r.reference, "reference", 80),
    method: r.method === null || r.method === undefined ? null : oneOf(r.method, METHODS, "method"),
    reason_code: r.reason_code === null || r.reason_code === undefined ? null : oneOf(r.reason_code, REASONS, "reason_code"),
    receipt_no: optStr(r.receipt_no, "receipt_no", 40),
    against_entry_id: optUuid(r.against_entry_id, "against_entry_id"),
    order_id: optUuid(r.order_id, "order_id"),
    source: oneOf(r.source, ["manual", "import"] as const, "source"),
    voided: bool(r.voided, "voided"),
  };
}

export function parseEntries(json: unknown): { account_id: string | null; entries: EntryOut[] } {
  const r = rec(json, "entries");
  return { account_id: optUuid(r.account_id, "account_id"), entries: list(r.entries, "entries", 600).map(parseEntry) };
}

export function parseRecorded(json: unknown): { id: string; account_id: string; receipt_no: string | null; replayed: boolean } {
  const r = rec(json, "recorded entry");
  return { id: uuid(r.id, "id"), account_id: uuid(r.account_id, "account_id"), receipt_no: optStr(r.receipt_no, "receipt_no", 40), replayed: r.replayed === true };
}

export function parseReceipt(json: unknown): ReceiptOut {
  const r = rec(json, "receipt");
  return {
    receipt_no: str(r.receipt_no, "receipt_no", 40),
    received_on: day(r.received_on, "received_on"),
    amount_paise: paise(r.amount_paise, "amount"),
    method: oneOf(r.method, METHODS, "method"),
    voided: bool(r.voided, "voided"),
    business_name: str(r.business_name, "business_name", 200),
    party_name: optStr(r.party_name, "party_name", 200),
    party_kind: oneOf(r.party_kind, ["company", "contact"] as const, "party_kind"),
    against: optStr(r.against, "against", 200),
    balance_after_paise: int(r.balance_after_paise, "balance_after", -MAX_PAISE, MAX_PAISE),
    recorded_at: str(r.recorded_at, "recorded_at", 40),
  };
}

export function parseCreditCheck(json: unknown): CreditCheckOut {
  const r = rec(json, "credit check");
  return {
    company_id: uuid(r.company_id, "company_id"),
    credit_limit_paise: optInt(r.credit_limit_paise, "credit_limit", 0, MAX_PAISE),
    outstanding_paise: paise(r.outstanding_paise, "outstanding"),
    new_amount_paise: paise(r.new_amount_paise, "new_amount"),
    would_be_paise: paise(r.would_be_paise, "would_be"),
    has_limit: bool(r.has_limit, "has_limit"),
    exceeded: bool(r.exceeded, "exceeded"),
  };
}

export function parseImportResult(json: unknown): { batch_id: string; added: number; skipped: { row: number; reason: string }[] } {
  const r = rec(json, "import result");
  return {
    batch_id: uuid(r.batch_id, "batch_id"),
    added: int(r.added, "added", 0, 10_000),
    skipped: list(r.skipped, "skipped", 5000).map((s) => {
      const x = rec(s, "skipped row");
      return { row: int(x.row, "row", 1, 10_000), reason: word(x.reason, "reason") };
    }),
  };
}

const tenantPath = (tenantId: string, tail: string) => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/${tail}`;
};
const idOf = (id: string) => {
  if (!isCanonicalUuid(id)) throw new ApiContractError("id");
  return id;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export type Party = { company_id: string } | { contact_id: string };
const partyQuery = (p: Party) => ("company_id" in p ? `company_id=${idOf(p.company_id)}` : `contact_id=${idOf(p.contact_id)}`);

/** `GET /ledger/summary`: every party with something open, the largest first. `party` narrows to companies or contacts. */
export async function getLedgerSummary(accessToken: string, tenantId: string, opts: { party?: "company" | "contact"; asOf?: string; after?: string | null; limit?: number } = {}) {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.party) q.set("party", opts.party);
  if (opts.asOf) {
    if (!DAY.test(opts.asOf)) throw new ApiContractError("date");
    q.set("as_of", opts.asOf);
  }
  if (opts.after) q.set("after", opts.after);
  return parseSummary(await apiRequest(tenantPath(tenantId, `ledger/summary?${q.toString()}`), accessToken));
}

export async function getLedgerStatement(accessToken: string, tenantId: string, party: Party, asOf?: string) {
  if (asOf !== undefined && !DAY.test(asOf)) throw new ApiContractError("date");
  return parseStatement(await apiRequest(tenantPath(tenantId, `ledger/statement?${partyQuery(party)}${asOf ? `&as_of=${asOf}` : ""}`), accessToken));
}

export async function getLedgerEntries(accessToken: string, tenantId: string, party: Party, limit = 100) {
  return parseEntries(await apiRequest(tenantPath(tenantId, `ledger/entries?${partyQuery(party)}&limit=${limit}`), accessToken));
}

export type EntryInput = {
  kind: EntryKind;
  party: Party;
  entryDate: string;
  amountPaise: number;
  dueDate?: string | null;
  direction?: "debit" | "credit" | null;
  invoiceNo?: string | null;
  reference?: string | null;
  method?: Method | null;
  reasonCode?: Reason | null;
  againstEntryId?: string | null;
  orderId?: string | null;
};

/** `PUT /ledger/entries/{id}`: record an entry; the same id again is a retry and replays. Adjustments and concessions: Owner or Admin with the second factor. */
export async function putLedgerEntry(accessToken: string, tenantId: string, id: string, e: EntryInput) {
  if (!DAY.test(e.entryDate) || (e.dueDate && !DAY.test(e.dueDate))) throw new ApiContractError("date");
  const body: Record<string, unknown> = { kind: e.kind, entry_date: e.entryDate, amount_paise: e.amountPaise, ...("company_id" in e.party ? { company_id: idOf(e.party.company_id) } : { contact_id: idOf(e.party.contact_id) }) };
  if (e.dueDate) body.due_date = e.dueDate;
  if (e.direction) body.direction = e.direction;
  if (e.invoiceNo) body.invoice_no = e.invoiceNo;
  if (e.reference) body.reference = e.reference;
  if (e.method) body.method = e.method;
  if (e.reasonCode) body.reason_code = e.reasonCode;
  if (e.againstEntryId) body.against_entry_id = idOf(e.againstEntryId);
  if (e.orderId) body.order_id = idOf(e.orderId);
  return parseRecorded(await apiRequest(tenantPath(tenantId, `ledger/entries/${idOf(id)}`), accessToken, { method: "PUT", body: JSON.stringify(body) }));
}

export async function voidLedgerEntry(accessToken: string, tenantId: string, id: string) {
  const r = rec(await apiRequest(tenantPath(tenantId, `ledger/entries/${idOf(id)}/void`), accessToken, { method: "POST" }), "voided entry");
  return { entry_id: uuid(r.entry_id, "entry_id"), kind: oneOf(r.kind, ENTRY_KINDS, "kind"), voided: bool(r.voided, "voided") };
}

export type ChargeRow = { company_id?: string; contact_id?: string; entry_date: string; due_date: string; amount_paise: number; invoice_no?: string | null; reference?: string | null };

/** `POST /ledger/charges/import`: up to 5,000 rows; the same `batchId` again adds nothing. */
export async function importLedgerCharges(accessToken: string, tenantId: string, batchId: string, rows: readonly ChargeRow[]) {
  if (rows.length > 5000) throw new ApiContractError("rows");
  return parseImportResult(await apiRequest(tenantPath(tenantId, "ledger/charges/import"), accessToken, { method: "POST", body: JSON.stringify({ batch_id: idOf(batchId), rows }) }));
}

export async function getLedgerReceipt(accessToken: string, tenantId: string, entryId: string) {
  return parseReceipt(await apiRequest(tenantPath(tenantId, `ledger/receipts/${idOf(entryId)}`), accessToken));
}

/** `POST /dues/customers/{id}/credit-check`: would a new amount pass the credit limit? A warning, never a block. */
export async function checkCredit(accessToken: string, tenantId: string, companyId: string, amountPaise: number) {
  return parseCreditCheck(await apiRequest(tenantPath(tenantId, `dues/customers/${idOf(companyId)}/credit-check`), accessToken, { method: "POST", body: JSON.stringify({ amount_paise: amountPaise }) }));
}

/** `PUT /dues/customers/{id}/credit-limit`: the Owner, with the second factor; `null` clears the limit. */
export async function setCreditLimit(accessToken: string, tenantId: string, companyId: string, limitPaise: number | null) {
  const r = rec(await apiRequest(tenantPath(tenantId, `dues/customers/${idOf(companyId)}/credit-limit`), accessToken, { method: "PUT", body: JSON.stringify({ limit_paise: limitPaise }) }), "credit limit");
  return { company_id: uuid(r.company_id, "company_id"), limit_paise: optInt(r.limit_paise, "limit", 0, MAX_PAISE) };
}
