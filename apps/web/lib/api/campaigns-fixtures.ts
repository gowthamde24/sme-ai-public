/** Synthetic campaign answers as the API sends them (job CQ). Nothing here is a real person, number or amount. */
export const CAMPAIGN = "ca000000-0000-4000-8000-000000000001";
export const CAMPAIGN2 = "ca000000-0000-4000-8000-000000000002";
export const TEMPLATE = "7e000000-0000-4000-8000-000000000001";
export const RECIPIENT = "4c000000-0000-4000-8000-000000000001";
export const CALL_ITEM = "ca110000-0000-4000-8000-000000000001";
export const CALL_REQUEST = "ca220000-0000-4000-8000-000000000001";
export const SHA = "a".repeat(64);
export const SHA2 = "b".repeat(64);

const base = {
  id: CAMPAIGN, name: "October payment reminders (synthetic)", kind: "payment_due", status: "draft", language: "en", wa_template_id: TEMPLATE,
  message_text: "Hello {{name}}, a payment of {{amount}} for {{reference}} is due on {{due_date}}. {{business}}", steps: [{ offset_days: -3, time: "10:00" }, { offset_days: 0, time: "10:00" }, { offset_days: 7, time: "11:00" }],
  call_after_step: 3, call_wait_hours: 24, audience_kind: "filter", audience_filter: { due_from: "2026-10-01", due_to: "2026-10-31" }, approved_by: null, approved_at: null, approved_recipients: null, approved_total_paise: null,
  created_at: "2026-10-10T05:00:00+00:00", updated_at: "2026-10-12T05:00:00+00:00", paused_at: null, cancelled_at: null, completed_at: null, recipients: 18, total_amount_paise: 41250000,
};
export const CAMPAIGN_JSON = base;
export const CAMPAIGN_RUNNING_JSON = { ...base, status: "running", approved_by: "11111111-1111-4111-8111-111111111111", approved_at: "2026-10-12T06:00:00+00:00", approved_recipients: 18, approved_total_paise: 41250000 };
export const CAMPAIGN_DONE_JSON = { ...CAMPAIGN_RUNNING_JSON, id: CAMPAIGN2, name: "September fee reminders (synthetic)", kind: "fee_due", status: "done", completed_at: "2026-10-05T06:00:00+00:00" };
export const LIST_JSON = { items: [CAMPAIGN_JSON, CAMPAIGN_RUNNING_JSON, CAMPAIGN_DONE_JSON], next_cursor: null };
export const DETAIL_JSON = { ...base, issues: [], issue_text: {}, sending_on: true };
export const DETAIL_ISSUES_JSON = { ...base, issues: ["no_template", "step_in_quiet_hours"], issue_text: { no_template: "The campaign has no approved WhatsApp template yet.", step_in_quiet_hours: "A step is at a time inside this business's quiet hours." }, sending_on: false, wa_template_id: null };
export const DETAIL_RUNNING_JSON = { ...CAMPAIGN_RUNNING_JSON, issues: [], issue_text: {}, sending_on: true };
export const SAVED_JSON = { campaign: base, created: true, back_to_draft: false };
const sample = (over: object) => ({ recipient_id: RECIPIENT, labels: ["first"], body: "Hello Ravi Kumar (synthetic), a payment of ₹1,25,000.00 for INV-1001 is due on 2026-10-20.", amount_paise: 12500000, due_date: "2026-10-20", ...over });
export const PREVIEW_JSON = {
  campaign: base, samples: [sample({ labels: ["first", "highest_amount"] }), sample({ recipient_id: "4c000000-0000-4000-8000-000000000002", labels: ["longest"], body: "Hello Lakshmi Constructions Private Limited (synthetic), a payment of ₹2,300.00 for INV-1007 is due on 2026-10-27.", amount_paise: 230000, due_date: "2026-10-27" }), sample({ recipient_id: "4c000000-0000-4000-8000-000000000003", labels: ["random"], body: "Hello Suresh (synthetic), a payment of ₹48,000.00 for INV-1003 is due on 2026-10-22.", amount_paise: 4800000, due_date: "2026-10-22" })],
  samples_sha256: SHA, content_sha256: SHA2, recipients: 18, total_amount_paise: 41250000, first_due: "2026-10-20", last_due: "2026-10-31", disclosure: "This message is from the business's AI assistant. Reply STOP to stop messages.", issues: [], issue_text: {}, sending_on: true,
};
export const PREVIEW_ISSUES_JSON = { ...PREVIEW_JSON, issues: ["no_template"], issue_text: { no_template: "The campaign has no approved WhatsApp template yet." }, sending_on: false };
export const APPROVED_JSON = { campaign: CAMPAIGN_RUNNING_JSON, planned_steps: 54, past_steps: 2, sending_on: true };
export const RECIPIENT_JSON = { id: RECIPIENT, seq: 1, contact_id: "22222222-2222-4222-8222-2222222222aa", contact_name: "Ravi Kumar (synthetic)", due_date: "2026-10-20", amount_paise: 12500000, reference: "INV-1001", closed_reason: null, promised_on: null, steps: [{ step_no: 1, scheduled_for: "2026-10-17T04:30:00+00:00", status: "submitted", reason: null }, { step_no: 2, scheduled_for: "2026-10-20T04:30:00+00:00", status: "planned", reason: null }] };
export const RECIPIENTS_JSON = [RECIPIENT_JSON, { ...RECIPIENT_JSON, id: "4c000000-0000-4000-8000-000000000002", seq: 2, contact_name: "Lakshmi Constructions (synthetic)", amount_paise: 230000, reference: "INV-1007", closed_reason: "paid", steps: [] }];
export const ADDED_JSON = { added: 16, skipped: [{ row: 3, reason: "party_not_found" }, { row: 9, reason: "no_phone" }], recipients: 16 };
export const RESULTS_JSON = {
  campaign_id: CAMPAIGN, status: "running", recipients: 18, by_state: { planned: 20, sent: 9, delivered: 14, read: 6, blocked: 3, skipped: 2, held: 0, failed: 0 }, by_reason: { no_opt_in: 2, stopped: 1, paid: 2 },
  by_day: [{ day: "2026-10-17", states: { sent: 9, delivered: 14, read: 6 } }, { day: "2026-10-18", states: { blocked: 3 } }], delivered_total: 20, replied: 4, paid_after_reminder: { recipients: 5, amount_paise: 9200000 }, closed: { paid: 5, wrong_number: 1 }, calls: { open: 3, done: 2, outcomes: { promised: 1, paid: 1 } },
};
export const CALL_ITEM_JSON = {
  id: CALL_ITEM, campaign_id: CAMPAIGN, campaign_name: "October payment reminders (synthetic)", recipient_id: RECIPIENT, contact_id: "22222222-2222-4222-8222-2222222222aa", contact_name: "Ravi Kumar (synthetic)", amount_paise: 12500000,
  due_date: "2026-10-20", reference: "INV-1001", step_no: 3, status: "open", outcome: null, promised_on: null, call_after: null, attempts: 0, call_request_id: CALL_REQUEST, created_at: "2026-10-27T05:00:00+00:00", sort_at: "2026-10-27T05:00:00+00:00",
};
export const CALL_LIST_JSON = { items: [CALL_ITEM_JSON, { ...CALL_ITEM_JSON, id: "ca110000-0000-4000-8000-000000000002", contact_name: "Suresh (synthetic)", amount_paise: 4800000, attempts: 1, call_after: "2026-10-28T10:00:00+00:00", call_request_id: "ca220000-0000-4000-8000-000000000002" }], next_cursor: null };
export const OUTCOME_JSON = { id: CALL_ITEM, status: "done", outcome: "paid", replayed: false };
export const BRIDGE_JSON = { bridge_id: "bb000000-0000-4000-8000-000000000001", status: "ringing", replayed: false };
