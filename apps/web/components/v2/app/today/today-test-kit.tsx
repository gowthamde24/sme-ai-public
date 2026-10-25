import { appT } from "@/i18n/app";
import { parseOutboxMessage } from "@/lib/api/outbox";
import { PRICE_JSON } from "@/lib/api/outbox-fixtures";

import { slotsJson } from "@/lib/api/visits-fixtures";

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
  message: { text: m.text, language: m.language, category: m.category, flags: m.flags, reasonText: m.reason_text, gloss: m.gloss_en, media: m.media.map((x) => ({ position: x.position, thumb_url: x.thumb_url })) },
  ...over,
});
export const call = (over: Partial<Extract<NeedsCard, { type: "call" }>> = {}): NeedsCard => ({
  type: "call",
  key: `call_approval-${CALL_ID}`,
  at: "2026-10-11T03:40:00Z",
  id: CALL_ID,
  customer: "Suresh K.",
  city: null,
  request: { reason: "Wedding order, about 12 sarees. Prefers after 6 pm.", language: "hi" },
  ...over,
});

export const VISIT_ID = "33333333-cccc-4ccc-8ccc-000000000001";
/** A visit Vijaya proposed: Wednesday 14 October, 11:00 in India. */
export const proposal = (over: Partial<Extract<NeedsCard, { type: "visit" }>> = {}): NeedsCard => ({
  type: "visit",
  key: `visit-${VISIT_ID}`,
  at: "2026-10-11T02:00:00Z",
  id: VISIT_ID,
  visit: { who: "Priya S.", customer: "Sri Lakshmi Silks", city: "Hyderabad", startsAt: "2026-10-14T05:30:00Z", partySize: 3, purpose: "Bridal sarees" },
  ...over,
});

export function fakeVisitActions() {
  return {
    confirm: vi.fn(async () => ({ ok: true as const, message: "Confirmed for Priya S., and nothing was sent to the customer." })),
    move: vi.fn(async () => ({ ok: true as const, message: "Moved to Thu 15 Oct, 12:00. It waits for the customer to confirm again. Nothing was sent." })),
    cancel: vi.fn(async () => ({ ok: true as const, message: "Cancelled for Priya S., and nothing was sent to the customer." })),
    slots: vi.fn(async (date: string) => ({ ok: true as const, slots: slotsJson(date) })),
  };
}

export function fakeActions(over: Partial<Record<Exclude<keyof TodayActions, "visit">, ReturnType<typeof vi.fn>>> & { visit?: ReturnType<typeof fakeVisitActions> | null } = {}) {
  const ok = (message: string) => vi.fn(async () => ({ ok: true as const, message }));
  const actions = {
    approveMessage: over.approveMessage ?? ok("Sent to Lakshmi R."),
    rejectMessage: over.rejectMessage ?? ok("Not sent. Nothing was sent to Lakshmi R."),
    editMessage: over.editMessage ?? vi.fn(async (_id: string, text: string) => ({ ok: true as const, message: "Saved. Read it once more, then approve.", text })),
    approveCall: over.approveCall ?? ok("Call approved for Suresh K. Nothing is dialled by this app."),
    offerVisit: over.offerVisit ?? ok("The call is declined and the visit offer is queued in the outbox."),
    visit: over.visit === undefined ? fakeVisitActions() : over.visit,
  };
  return actions as unknown as TodayActions & Record<Exclude<keyof TodayActions, "visit">, ReturnType<typeof vi.fn>> & { visit: ReturnType<typeof fakeVisitActions> };
}
