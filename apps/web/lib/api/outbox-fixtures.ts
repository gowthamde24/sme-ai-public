/**
 * Synthetic answers of the outbox and call-request endpoints, shaped exactly as the API sends them (job AT report, "Example JSON for every endpoint") and parsed by the real parsers in the tests.
 * Invented names, ids and words; the Telugu message is a price, which always waits for a person.
 */
export const MSG_LEAD = "7c1f0a52-3b11-4c6e-9d0a-5e2b8f4a1c01";
export const MSG_PRICE = "11111111-aaaa-4aaa-8aaa-000000000001";
export const MSG_INFO = "11111111-aaaa-4aaa-8aaa-000000000002";
export const MSG_BLOCKED = "11111111-aaaa-4aaa-8aaa-000000000003";
export const MSG_QUIET = "11111111-aaaa-4aaa-8aaa-000000000004";
export const CALL_ID = "22222222-bbbb-4bbb-8bbb-000000000001";

const base = { lead_id: MSG_LEAD, contact_id: "a2d4c9e0-8c47-4b7f-8a3e-1f6d2b9c5e02", customer: "DEMO Lakshmi Textiles", city: "Demoville", channel: "whatsapp", model_flagged: false, uncertain: false, disclosure_added: false, scheduled_for: null, edited_at: null, decided_at: null, sent_at: null, failure_code: null };

export const PRICE_JSON = {
  ...base,
  id: MSG_PRICE,
  text: "ఈ చీర ధర 500 రూపాయలు మాత్రమే.\n\nఈ సందేశం వ్యాపారం యొక్క AI సహాయకుడి నుండి వచ్చింది.",
  language: "te",
  category: "reply_to_inbound",
  source: "assistant",
  status: "needs_approval",
  reason: "money",
  reason_text: "It mentions money (a price, an amount, a discount, GST, an advance, a payment...). A person decides.",
  flags: ["money"],
  disclosure_added: true,
  created_at: "2026-10-10T16:30:00Z",
};
export const SENT_JSON = { ...base, id: MSG_INFO, text: "Yes, we have silk sarees in stock. We are open from 10 am to 8 pm.", language: "en", category: "reply_to_inbound", source: "assistant", status: "sent", reason: "auto_allowed", reason_text: "Allowed to go automatically.", flags: [], scheduled_for: "2026-10-10T16:30:00Z", created_at: "2026-10-10T16:30:00Z", sent_at: "2026-10-10T16:31:02Z" };
export const BLOCKED_JSON = { ...base, id: MSG_BLOCKED, text: "Hello, would you like to see our new collection?", language: "en", category: "followup", source: "assistant", status: "blocked", reason: "no_opt_in", reason_text: "The customer has not agreed to WhatsApp messages and has never written to us.", flags: [], created_at: "2026-10-10T16:30:00Z" };
export const QUIET_JSON = { ...base, id: MSG_QUIET, text: "Our shop is open every day from 10 am to 8 pm.", language: "en", category: "info", source: "assistant", status: "queued", reason: "quiet_hours", reason_text: "Waiting for 9 am", flags: [], scheduled_for: "2026-10-11T03:30:00Z", created_at: "2026-10-10T16:45:00Z" };

export const CALL_JSON = { id: CALL_ID, lead_id: MSG_LEAD, contact_id: "a2d4c9e0-8c47-4b7f-8a3e-1f6d2b9c5e02", customer: "DEMO Lakshmi Textiles", city: "Demoville", reason: "The customer asked for a call about a large wedding order.", script_draft: "Hello, this is the DEMO shop. How many pieces do you need?", language: "en", status: "requested", created_at: "2026-10-10T16:32:00Z", decided_at: null, decision_note: null };

export const page = (items: unknown[], next_cursor: string | null = null) => ({ items, next_cursor });
