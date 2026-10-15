/** Synthetic ledger answers as the API sends them (jobs CO, CS). Nothing here is a real customer, student or amount. */
export const COMPANY = "11111111-1111-4111-8111-111111111111";
export const COMPANY2 = "11111111-1111-4111-8111-111111111112";
export const ENTRY_PAYMENT = "ee000000-0000-4000-8000-000000000001";
export const ENTRY_CHARGE = "ee000000-0000-4000-8000-000000000002";
export const INVOICE = "ee000000-0000-4000-8000-000000000003";
export const ACCOUNT = "acacacac-acac-4cac-8cac-acacacacacac";

export const STATEMENT_JSON = {
  account_id: ACCOUNT, company_id: COMPANY, contact_id: null, as_of: "2026-10-14", invoiced_paise: 20000000, paid_paise: 7000000, payments_paise: 7000000, concessions_paise: 0, adjustments_paise: 0,
  outstanding_paise: 13000000, credit_paise: 0, overdue_paise: 5000000, ageing: { d0_30: 8000000, d31_60: 5000000, d61_90: 0, d90_plus: 0 }, overdue_ageing: { not_due: 8000000, d1_30: 5000000, d31_60: 0, d61_90: 0, d90_plus: 0 },
  open_invoices: [
    { invoice_id: INVOICE, entry_id: INVOICE, kind: "charge", invoice_no: "INV-1001", reference: null, invoice_date: "2026-09-20", due_date: "2026-10-05", amount_paise: 12000000, open_paise: 5000000, age_days: 24, overdue_days: 9 },
    { invoice_id: "ee000000-0000-4000-8000-000000000004", entry_id: "ee000000-0000-4000-8000-000000000004", kind: "charge", invoice_no: "INV-1002", reference: null, invoice_date: "2026-09-25", due_date: "2026-10-09", amount_paise: 8000000, open_paise: 8000000, age_days: 4, overdue_days: 0 },
  ],
  credit_limit_paise: 15000000, over_limit: false,
};
export const SUMMARY_JSON = {
  items: [
    { ...STATEMENT_JSON, company_name: "Sri Rama Builders (synthetic)", party_kind: "company", party_name: "Sri Rama Builders (synthetic)" },
    { ...STATEMENT_JSON, account_id: "adadadad-adad-4dad-8dad-adadadadadad", company_id: COMPANY2, outstanding_paise: 4500000, overdue_paise: 0, ageing: { d0_30: 4500000, d31_60: 0, d61_90: 0, d90_plus: 0 }, open_invoices: [], credit_limit_paise: 4000000, over_limit: true, company_name: "Lakshmi Constructions (synthetic)", party_kind: "company", party_name: "Lakshmi Constructions (synthetic)" },
  ],
  next_cursor: null,
};
const entry = (over: object) => ({ id: ENTRY_CHARGE, kind: "charge", direction: "debit", amount_paise: 12000000, entry_date: "2026-09-20", due_date: "2026-10-05", invoice_no: "INV-1001", reference: null, method: null, reason_code: null, receipt_no: null, against_entry_id: null, order_id: null, source: "manual", voided: false, ...over });
export const ENTRIES_JSON = {
  account_id: ACCOUNT,
  entries: [
    entry({ id: ENTRY_PAYMENT, kind: "payment", direction: "credit", amount_paise: 7000000, entry_date: "2026-10-02", due_date: null, invoice_no: null, method: "upi", receipt_no: "R/2026-27/000012" }),
    entry({}),
    entry({ id: "ee000000-0000-4000-8000-000000000009", kind: "adjustment", direction: "credit", amount_paise: 100000, entry_date: "2026-09-25", due_date: null, invoice_no: null, reason_code: "waiver", voided: true }),
  ],
};
export const RECORDED_JSON = { id: ENTRY_PAYMENT, account_id: ACCOUNT, receipt_no: "R/2026-27/000012", replayed: false };
export const RECEIPT_JSON = { receipt_no: "R/2026-27/000012", received_on: "2026-10-02", amount_paise: 7000000, method: "upi", voided: false, business_name: "Pavers Corner (synthetic)", party_name: "Sri Rama Builders (synthetic)", party_kind: "company", against: "INV-1001", balance_after_paise: 13000000, recorded_at: "2026-10-02T05:00:00+00:00" };
