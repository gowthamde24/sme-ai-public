import { appT } from "@/i18n/app";
import { parseOutboxMessage } from "@/lib/api/outbox";
import { PRICE_JSON } from "@/lib/api/outbox-fixtures";

import type { TodayActions } from "./actions-types";
import { todayWords } from "./today-words";
import type { NeedsCard, T } from "./types";
import { vi } from "vitest";

/** Shared by the tests of Today: the English words, a pinned clock, one card of each kind and actions that can be watched. Test code only. */
export const en = appT("en");
export const t: T = (k, v) => en(k as "frame.notyet", v);
export const WORDS = todayWords((k) => en(k as "frame.notyet"));
/** 2026-10-11 05:00 UTC: 10:30 in India. */
export const NOW = Date.parse("2026-10-11T05:00:00Z");
export const U = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

export const classic = (over: Partial<Extract<NeedsCard, { type: "item" }>["item"]> = {}): NeedsCard => ({
  type: "item",
  key: `quote_approval-${U}`,
  at: "2026-10-11T03:12:00Z",
  item: { kind: "quote_approval", id: U, customer: "SYNTHETIC Textiles", city: "Hyderabad", agent: "quote_writer", summary: "Quote 3 for ₹14,175.00 is ready for your approval.", at: "2026-10-11T03:12:00Z", amount_paise: 1417500, target: { type: "quote", id: U }, href: "/app/tenants/T/enquiries/E", ...over },
});
export const MESSAGE_ID = "11111111-aaaa-4aaa-8aaa-000000000001";
export const CALL_ID = "22222222-bbbb-4bbb-8bbb-000000000001";
const m = parseOutboxMessage(PRICE_JSON);
export const outbox = (over: Partial<Extract<NeedsCard, { type: "outbox" }>> = {}): NeedsCard => ({
  type: "outbox",
  key: `outbox_approval-${MESSAGE_ID}`,
  at: "2026-10-11T03:12:00Z",
  id: MESSAGE_ID,
  customer: "Lakshmi R.",
  city: "Demoville",
  message: { text: m.text, language: m.language, category: m.category, flags: m.flags, reasonText: m.reason_text },
  ...over,
});
export const call = (over: Partial<Extract<NeedsCard, { type: "call" }>> = {}): NeedsCard => ({
  type: "call",
  key: `call_approval-${CALL_ID}`,
  at: "2026-10-11T03:40:00Z",
  id: CALL_ID,
  customer: "Suresh K.",
  city: null,
  request: { reason: "Wedding order, about 12 sarees. Prefers after 6 pm." },
  ...over,
});

export function fakeActions(over: Partial<Record<keyof TodayActions, ReturnType<typeof vi.fn>>> = {}) {
  const ok = (message: string) => vi.fn(async () => ({ ok: true as const, message }));
  const actions = {
    approveMessage: over.approveMessage ?? ok("Sent to Lakshmi R."),
    rejectMessage: over.rejectMessage ?? ok("Not sent. Nothing was sent to Lakshmi R."),
    editMessage: over.editMessage ?? vi.fn(async (_id: string, text: string) => ({ ok: true as const, message: "Saved. Read it once more, then approve.", text })),
    approveCall: over.approveCall ?? ok("Call approved for Suresh K. Nothing is dialled by this app."),
    offerVisit: over.offerVisit ?? ok("Call not approved. Saved with the request: offer Suresh K. a store visit. This app has not sent the offer."),
  };
  return actions as unknown as TodayActions & Record<keyof TodayActions, ReturnType<typeof vi.fn>>;
}
