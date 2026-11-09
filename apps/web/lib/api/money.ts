import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, int, list, nstr, rec, uuid } from "./shape";

/**
 * Money at a glance (app v4 part 6, C1's docs/contracts/money-and-stock.md): `GET /v1/tenants/{t}/money/summary?as_of=YYYY-MM-DD` (Owner, Admin, Sales; a Viewer gets 403): what customers owe, how much of it is overdue, what was paid this
 * month, and the customers who owe most, all summed from the ledger's own per-customer statements (payments go to the oldest invoice first; concessions and voids count as the ledger counts them). Money is integer paise. Nothing here is
 * worked out by the screen. `complete` is false only past 5,000 customers who owe. Checked field by field; a row that breaks the contract is refused whole.
 */
export const MAX_PAISE = 100_000_000_000;
const paise = (v: unknown, what: string) => int(v, what, 0, MAX_PAISE);
const optUuid = (v: unknown, what: string) => (v === null || v === undefined ? null : uuid(v, what));
const day = (v: unknown, what: string) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : bad(what));

export type MoneyRow = { accountId: string | null; companyId: string | null; contactId: string | null; name: string; outstandingPaise: number; overduePaise: number };
export type MoneySummary = { asOf: string; owedPaise: number; overduePaise: number; customersOwing: number; customersOverdue: number; paidThisMonthPaise: number; monthFrom: string; top: MoneyRow[]; complete: boolean };

export function parseMoneySummary(json: unknown): MoneySummary {
  const r = rec(json, "money summary");
  return {
    asOf: day(r.as_of, "as_of"),
    owedPaise: paise(r.owed_paise, "owed_paise"),
    overduePaise: paise(r.overdue_paise, "overdue_paise"),
    customersOwing: int(r.customers_owing, "customers_owing", 0, 10_000_000),
    customersOverdue: int(r.customers_overdue, "customers_overdue", 0, 10_000_000),
    paidThisMonthPaise: paise(r.paid_this_month_paise, "paid_this_month_paise"),
    monthFrom: day(r.month_from, "month_from"),
    top: list(r.top, "top", 100).map((x): MoneyRow => {
      const t = rec(x, "top row");
      return { accountId: optUuid(t.account_id, "account_id"), companyId: optUuid(t.company_id, "company_id"), contactId: optUuid(t.contact_id, "contact_id"), name: nstr(t.name, "name", 200), outstandingPaise: paise(t.outstanding_paise, "outstanding_paise"), overduePaise: paise(t.overdue_paise, "overdue_paise") };
    }),
    complete: bool(r.complete, "complete"),
  };
}

export async function getMoneySummary(accessToken: string, tenantId: string, asOf?: string): Promise<MoneySummary> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  if (asOf !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new ApiContractError("date");
  return parseMoneySummary(await apiRequest(`/v1/tenants/${tenantId}/money/summary${asOf ? `?as_of=${asOf}` : ""}`, accessToken));
}
