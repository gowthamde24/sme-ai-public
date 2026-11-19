/**
 * Answers of `.../queued-message` in the WIRE shape of contracts/composer-queue-DRAFT.md (C1's, 19 Nov 2026), one per state, parsed by the one adapter (lib/api/chat-queue.ts) in its test and used by the screens' scenarios. A change of the contract is a change here and in the parser.
 */
const base = { id: "a1b2c3d4-0000-4000-8000-000000000001", text: "Yes, the red Kanchi silk is in stock.", send_at: null, queued_at: "2026-11-20T09:00:00Z", expires_at: "2026-11-27T09:00:00Z", continue_chat: "sent", failure_code: null };
export const QUEUED_FIXTURES = {
  waiting: { ...base, status: "waiting_for_reply" },
  sending: { ...base, status: "sending", send_at: "2026-11-20T09:20:00Z" },
  sent: { ...base, status: "sent", send_at: "2026-11-20T09:20:00Z" },
  cancelled: { ...base, status: "cancelled" },
  expired: { ...base, status: "expired", queued_at: "2026-11-13T09:00:00Z", expires_at: "2026-11-20T09:00:00Z" },
  failed: { ...base, status: "failed", failure_code: "send_failed" },
  stopped: { ...base, status: "cancelled", failure_code: "stopped_by_customer" },
  /** the old night state (dropped 19 Nov): still accepted, shown as Sending… */
  legacy_morning: { ...base, status: "replied_waiting_for_morning", send_at: "2026-11-21T03:30:00Z" },
  hello_not_approved: { ...base, status: "waiting_for_reply", continue_chat: "not_approved" },
} as const;
