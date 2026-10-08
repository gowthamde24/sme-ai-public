/** Synthetic follow-up bodies as the API sends them (shared by the follow-up tests). Nothing here is a real customer, contact or person. */
export const TENANT = "22222222-2222-2222-2222-222222222222";
export const LEAD = "33333333-3333-3333-3333-333333333333";
export const DRAFT = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
export const DRAFT2 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
export const TOUCH = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
export const TOUCH2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
export const PERSON = "ffffffff-ffff-4fff-8fff-fffffffffff1";
export const OTHER_PERSON = "ffffffff-ffff-4fff-8fff-fffffffffff2";
export const CONTACT = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
export const POLICY = "99999999-9999-4999-8999-999999999999";
export const REQ = "66666666-6666-4666-8666-666666666666";
export const QUESTION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
export const HASH = "a".repeat(64);
export const BODY_TEXT = "Hello, I am following up on my earlier message about your saree requirement.";

export const TOUCH_JSON = {
  id: TOUCH, lead_id: LEAD, contact_id: CONTACT, direction: "out", channel: "email", occurred_at: "2026-10-02T06:30:00+00:00", draft_id: null, recorded_by: PERSON, recorded_at: "2026-10-02T06:30:01+00:00",
};
export const DRAFT_JSON = {
  id: DRAFT, lead_id: LEAD, contact_id: CONTACT, touch_number: 2, status: "draft", channel: "email", template_code: "followup_gentle", body: BODY_TEXT, policy_version_id: POLICY,
  engine_version: "1.0.0", state_hash: HASH, as_of: "2026-10-07T06:30:00+00:00", created_by: PERSON, created_at: "2026-10-07T06:30:01+00:00", approved_by: null, approved_at: null,
  discarded_by: null, discarded_at: null, discard_code: null,
};
export const DECISION_JSON = { action: "draft_followup", reason_code: "eligible_now", terminal: false, touch_number: 2, next_eligible_at: "2026-10-07T06:30:00Z", engine_version: "1.0.0" };
export const GATE_JSON = { blocked: null, stopped: null, policy_in_force: true };
export const CHANNELS_OPEN_JSON = [{ channel: "email", blocked: null }, { channel: "whatsapp", blocked: null }];
export const FOLLOWUP_JSON = { lead_id: LEAD, channel: "email", default_channel: "email", channels: CHANNELS_OPEN_JSON, gate: GATE_JSON, decision: DECISION_JSON, policy_version_id: POLICY, touches: [TOUCH_JSON], drafts: [DRAFT_JSON] };
export const DUE_JSON = [{ lead_id: LEAD, action: "draft_followup", reason_code: "eligible_now", touch_number: 2, next_eligible_at: "2026-10-07T06:30:00Z", open_draft_id: null, open_draft_channel: null, channels: CHANNELS_OPEN_JSON, default_channel: "email" }];
/** The same bodies as an API that predates the channel fields sent them (the three new fields of the due row, the two of the lead page, are absent). */
const without = (o: Record<string, unknown>, ...keys: string[]): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
export const FOLLOWUP_OLD_JSON = without(FOLLOWUP_JSON, "default_channel", "channels");
export const DUE_OLD_JSON = DUE_JSON.map((row) => without(row, "open_draft_channel", "channels", "default_channel"));
/** One page of the due list as the API now sends it (the bare list above is what an older API sent). */
export const DUE_LIST_JSON = { items: DUE_JSON, next_cursor: null, policy_in_force: true, left_out: 0 };
export const CURSOR = "eyJhdCI6IjIwMjYtMTAtMDJUMDg6MzA6MDArMDA6MDAiLCJpZCI6IjMzMzMzMzMzLTMzMzMtMzMzMy0zMzMzLTMzMzMzMzMzMzMzMyJ9";
export const POLICY_JSON = {
  id: POLICY, version_no: 1, effective_from: "2026-10-01", gap_days: [3, 7], max_touches: 3, quiet_start: "21:00", quiet_end: "09:00", allowed_weekdays: [0, 1, 2, 3, 4, 5], holidays: ["2026-12-25"],
  min_gap_hours: 24, recipient_utc_offset_minutes: 330, created_at: "2026-10-01T05:00:00+00:00",
};
export const QUESTION_JSON = {
  id: QUESTION, requirement_id: REQ, line_no: 0, question_code: "missing_delivery_city", question_text: "Which city should we deliver to?", status: "draft", created_by: PERSON,
  created_at: "2026-10-07T06:00:00+00:00", decided_by: null, decided_at: null, discard_code: null,
};
export const TOUCH_RESULT_JSON = { touch_id: TOUCH, lead_id: LEAD, direction: "out", replayed: false };
export const DRAFT_RESULT_JSON = { draft_id: DRAFT, lead_id: LEAD, touch_number: 2, status: "draft", replayed: false };
export const STATUS_JSON = { draft_id: DRAFT, status: "approved", replayed: false };
export const SENT_JSON = { draft_id: DRAFT, touch_id: TOUCH2, status: "recorded_sent", replayed: false };
export const POLICY_RESULT_JSON = { version_id: POLICY, version_no: 2, effective_from: "2026-10-08", replayed: false };
export const QUESTION_SYNC_JSON = { requirement_id: REQ, changed: 1, drafts: [QUESTION_JSON] };
export const QUESTION_DECISION_JSON = { draft_id: QUESTION, status: "approved", replayed: false };
