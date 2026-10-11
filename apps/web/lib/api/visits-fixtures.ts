import { parseVisit, type Slots, type StoreSettings, type TodayVisit, type Visit } from "./visits";

/**
 * Invented data in the shape of the visits contract (job AS), for tests and the screenshot pages. No real customer, number or business. All the clock-times are fixed instants: 2026-10-14 (a Wednesday)
 * in India; 10:30 India = 05:00Z.
 */
export const LEAD_A = "c5c78ed6-e536-46af-a5c3-872bb2d844a2";
export const LEAD_B = "7a32b310-66cb-4255-bf72-fa6b6e184c54";
export const LEAD_C = "85e1cfb1-2227-46bf-b668-738c22c48a5a";
export const VISIT_1 = "d894bfa2-0aaf-4700-85a9-70e4fa125fc1";
export const VISIT_2 = "7604201c-580a-4c63-93b4-8bc4c3b7724e";
export const VISIT_3 = "7e456fad-378a-485d-839a-5d34ee346c42";

export function visitJson(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: VISIT_1,
    lead_id: LEAD_A,
    contact_id: "ce3a5472-1764-439b-b0ec-7ed17b4b461f",
    customer: "Sri Lakshmi Silks",
    contact_name: "Priya S.",
    who: "Priya S.",
    city: "Hyderabad",
    date: "2026-10-14",
    starts_at: "2026-10-14T05:00:00Z",
    ends_at: "2026-10-14T05:30:00Z",
    party_size: 3,
    purpose: "Bridal sarees",
    note: null,
    status: "booked",
    source: "staff",
    outcome: null,
    order_id: null,
    advance_requested: false,
    advance_paise: null,
    confirmation_message_id: null,
    reminder_message_id: null,
    confirmation_sent: false,
    reminder_sent: false,
    cancel_reason: null,
    created_at: "2026-10-13T08:30:00Z",
    confirmed_at: null,
    arrived_at: null,
    closed_at: null,
    ...over,
  };
}

/** A visit parsed from the contract's JSON (with any field changed): for tests that need the screen's own shape. */
export const parseVisitFixture = (json: Record<string, unknown>): Visit => parseVisit(json);

export function visit(over: Partial<Visit> = {}): Visit {
  return { ...parseVisit(visitJson()), ...over };
}

export const TODAY_VISITS: TodayVisit[] = [
  { id: VISIT_3, lead_id: LEAD_C, starts_at: "2026-10-14T05:00:00Z", who: "Anita R.", extra: 0, topic: null, status: "requested", visit_status: "booked" },
  { id: VISIT_1, lead_id: LEAD_A, starts_at: "2026-10-14T06:30:00Z", who: "Priya S.", extra: 2, topic: "Bridal sarees", status: "confirmed", visit_status: "confirmed" },
  { id: VISIT_2, lead_id: LEAD_B, starts_at: "2026-10-14T10:30:00Z", who: "Lakshmi Textiles", extra: 0, topic: "Silk saree wholesale", status: "reminder_sent", visit_status: "confirmed" },
];

const hours = { open: "10:00", close: "20:30" };
export const SETTINGS: StoreSettings = {
  weekly_hours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: null },
  closed_dates: ["2026-10-20"],
  slot_minutes: 30,
  max_parallel: 2,
  is_default: false,
};

export function slotsJson(date = "2026-10-14", free: Record<string, number> = {}): Slots {
  const slots: Slots["slots"] = [];
  for (let minute = 10 * 60; minute < 20 * 60 + 30; minute += 30) {
    const start = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const utc = minute - 330;
    const at = (m: number) => `${date}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00Z`;
    slots.push({ start, starts_at: at(utc), ends_at: at(utc + 30), capacity: 2, free: free[start] ?? 2, past: false });
  }
  return { date, open: true, reason: null, slot_minutes: 30, max_parallel: 2, slots };
}
