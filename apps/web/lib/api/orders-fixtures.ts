/** Synthetic order bodies as the API sends them (shared by the order tests). Nothing here is a real customer, amount or person. */
export const TENANT = "22222222-2222-2222-2222-222222222222";
export const ORDER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
export const QUOTE = "88888888-8888-4888-8888-888888888888";
export const ENQ = "44444444-4444-4444-4444-444444444444";
export const LEAD = "33333333-3333-3333-3333-333333333333";
export const EVENT = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
export const LEDGER = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
export const PERSON = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";

export const EVENT_JSON = {
  id: EVENT, seq: 1, type: "created", prior_state: null, new_state: "quote_approved", amount_paise: null, ledger_id: null, occurred_at: "2026-10-06T05:00:00+00:00",
  reason_code: null, owner_approved_by: null, recorded_by: PERSON, recorded_at: "2026-10-06T05:00:01+00:00", engine_version: null, canonical_hash: null,
};
export const ORDER_JSON = {
  id: ORDER, order_no: 7, quote_id: QUOTE, enquiry_id: ENQ, requirement_id: "66666666-6666-4666-8666-666666666666", lead_id: LEAD, state: "quote_approved", outcome: "open",
  order_total_paise: 15000000, advance_paise: 7500000, valid_until: "2026-10-21", policy_version_id: "99999999-9999-4999-8999-999999999999", created_at: "2026-10-06T05:00:00+00:00",
  closed_at: null, paid_paise: 0, refunded_paise: 0, net_paise: 0, balance_paise: 15000000, event_count: 1, lost_reason: null,
};
export const DETAIL_JSON = { ...ORDER_JSON, events: [EVENT_JSON], allowed_next_events: ["send_quote", "cancel"] };
export const RESULT_JSON = {
  event_id: EVENT, order_id: ORDER, seq: 2, state: "quote_sent", prior_state: "quote_approved", outcome: "open", replayed: false, allowed_next_events: ["customer_accept"],
  flags: [], paid_total: null, balance_due: null,
};
export const MEMBERS_JSON = { members: [{ user_id: PERSON, role: "owner", display_name: "Asha (synthetic)" }] };
