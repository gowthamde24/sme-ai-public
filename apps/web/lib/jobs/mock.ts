import type { Job } from "./types";

/** JOBS=mock: the made-up jobs of the demo shop (Neelambari Silks), the ones in mocks/jobs. Nothing is sent or stored by them; a switch only changes the screen the person is on. */
const id = (n: number) => `66666666-6666-4666-8666-66666666660${n}`;
export const MOCK_JOBS: readonly Job[] = [
  { id: id(1), kind: "speed_to_lead", customName: null, enabled: true, status: "running", result: { code: "calls_today", params: { called: 6, picked_up: 4, visits: 2 } }, needsYou: 0, lastRunAt: "2026-11-19T04:20:00Z", fix: null },
  { id: id(2), kind: "answer_calls", customName: null, enabled: true, status: "running", result: { code: "answered_today", params: { answered: 3, callbacks: 1 } }, needsYou: 0, lastRunAt: "2026-11-19T04:02:00Z", fix: null },
  { id: id(3), kind: "followups", customName: null, enabled: true, status: "failed", result: { code: "not_sent_window", params: { n: 2 } }, needsYou: 2, lastRunAt: "2026-11-19T03:42:00Z", fix: { code: "template_needed", count: 2 } },
  { id: id(4), kind: "offers", customName: null, enabled: true, status: "waiting", result: { code: "offer_ready", params: { customers: 38 } }, needsYou: 1, lastRunAt: null, fix: null },
  { id: id(5), kind: "store_visits", customName: "Priya", enabled: true, status: "done", result: { code: "reminders_today", params: { sent: 3, tomorrow: 2 } }, needsYou: 0, lastRunAt: "2026-11-19T03:30:00Z", fix: null },
  { id: id(6), kind: "researcher", customName: null, enabled: true, status: "running", result: { code: "search_left", params: { shops: 12, left: 1, per_month: 1, last: "12 Nov" } }, needsYou: 0, lastRunAt: "2026-11-12T08:00:00Z", fix: null },
  { id: id(7), kind: "payment_reminders", customName: null, enabled: false, status: "paused", result: { code: "paused_on", params: { day: "14 Nov" } }, needsYou: 0, lastRunAt: null, fix: null },
];
