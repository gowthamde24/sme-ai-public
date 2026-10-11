import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Store visits (job AS, ADR 0067): the opening hours and slots, the visits themselves and the steps of a visit. Server side only, with the signed-in user's own token. The field names are the contract's,
 * exactly (snake_case); times are ISO instants and the screens show them in Asia/Kolkata. `date` is the India calendar date of the start (`YYYY-MM-DD`); a slot is named by its India clock time (`HH:MM`).
 * Money is integer paise. A response that does not match the contract is an error and nothing is shown.
 *
 * Who may do what (the API decides; the screens only hide what it would refuse): every member reads. Owner, Admin and Sales book, change, confirm, arrive, no-show, cancel and complete a visit; the hours are
 * the Owner's and Admin's; "bought" with an order needs an Owner or Admin with the second factor; "Offer a store visit" is the Owner's, with the second factor. A Viewer only reads.
 */
export const VISIT_STATUSES = ["booked", "confirmed", "arrived", "completed", "no_show", "cancelled"] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export const VISIT_OUTCOMES = ["bought", "will_return", "not_interested"] as const;
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];
export const VISIT_SOURCES = ["staff", "assistant"] as const;
export type VisitSource = (typeof VISIT_SOURCES)[number];
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const SLOT_MINUTES = [15, 20, 30, 45, 60, 90, 120] as const;
/** The statuses of `GET /visits/today`: the customer has not confirmed (`requested`), has (`confirmed`) or has been sent the reminder (`reminder_sent`). */
export const TODAY_VISIT_STATUSES = ["confirmed", "reminder_sent", "requested"] as const;

export interface Visit {
  id: string;
  lead_id: string;
  customer: string | null;
  contact_name: string | null;
  /** The contact's short name, else the customer, else "A customer". */
  who: string;
  city: string | null;
  /** India calendar date of the start. */
  date: string;
  starts_at: string;
  ends_at: string;
  party_size: number;
  purpose: string | null;
  note: string | null;
  status: VisitStatus;
  source: VisitSource;
  outcome: VisitOutcome | null;
  order_id: string | null;
  advance_requested: boolean;
  advance_paise: number | null;
  confirmation_sent: boolean;
  reminder_sent: boolean;
  cancel_reason: string | null;
  created_at: string;
  confirmed_at: string | null;
  arrived_at: string | null;
  closed_at: string | null;
}

/** One line of "At the store today". `visit_status` tells "Here now" (`arrived`) from the others. */
export interface TodayVisit {
  id: string;
  lead_id: string;
  starts_at: string;
  who: string;
  /** People who come with the named one. */
  extra: number;
  topic: string | null;
  status: (typeof TODAY_VISIT_STATUSES)[number];
  visit_status: "booked" | "confirmed" | "arrived";
}

export interface Slot {
  /** "10:00", India clock time. */
  start: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  free: number;
  /** An earlier slot of today: it can still be booked (a walk-in being written down), but it is behind us. */
  past: boolean;
}

export interface Slots {
  date: string;
  open: boolean;
  /** Why there are none (`closed_date`, `past`, a closed weekday...). A closed set on the server's side; the screen has a sentence for each it knows and a plain one for the rest. */
  reason: string | null;
  slot_minutes: number;
  max_parallel: number;
  slots: Slot[];
}

export type DayHours = { open: string; close: string };
export interface StoreSettings {
  weekly_hours: Record<Weekday, DayHours | null>;
  closed_dates: string[];
  slot_minutes: number;
  max_parallel: number;
  /** true until the business saves its own hours. */
  is_default: boolean;
}

export interface BookInput {
  visitId: string;
  leadId: string;
  date: string;
  slot: string;
  partySize: number;
  purpose?: string | null;
  note?: string | null;
  advancePaise?: number | null;
}
export interface ChangeInput {
  date?: string;
  slot?: string;
  partySize?: number;
  purpose?: string | null;
  note?: string | null;
  advancePaise?: number | null;
  clearAdvance?: boolean;
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in a visits response.`);
}
const oneOf = <T extends string>(list: readonly T[], v: unknown, what: string): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : bad(what));
const uuid = (v: unknown, what: string): string => (typeof v === "string" && isCanonicalUuid(v) ? v : bad(what));
const nullableUuid = (v: unknown, what: string): string | null => (v === null ? null : uuid(v, what));
const str = (v: unknown, what: string, max: number): string => (typeof v === "string" && v.trim() !== "" && v.length <= max ? v : bad(what));
const nullableStr = (v: unknown, what: string, max: number): string | null => (v === null ? null : typeof v === "string" && v.length <= max ? v : bad(what));
const bool = (v: unknown, what: string): boolean => (typeof v === "boolean" ? v : bad(what));
const int = (v: unknown, what: string, min: number, max: number): number => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : bad(what));
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const CLOSE = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;
const day = (v: unknown, what: string): string => (typeof v === "string" && DAY.test(v) && !Number.isNaN(Date.parse(v)) ? v : bad(what));
function when(v: unknown, what: string): string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : bad(what);
}
const nullableWhen = (v: unknown, what: string): string | null => (v === null ? null : when(v, what));

export function parseVisit(json: unknown): Visit {
  if (!isRecord(json)) return bad("visit");
  const advance = json.advance_paise;
  return {
    id: uuid(json.id, "id"),
    lead_id: uuid(json.lead_id, "lead_id"),
    customer: nullableStr(json.customer, "customer", 200),
    contact_name: nullableStr(json.contact_name, "contact_name", 200),
    who: str(json.who, "who", 200),
    city: nullableStr(json.city, "city", 200),
    date: day(json.date, "date"),
    starts_at: when(json.starts_at, "starts_at"),
    ends_at: when(json.ends_at, "ends_at"),
    party_size: int(json.party_size, "party_size", 1, 50),
    purpose: nullableStr(json.purpose, "purpose", 400),
    note: nullableStr(json.note, "note", 2000),
    status: oneOf(VISIT_STATUSES, json.status, "status"),
    source: oneOf(VISIT_SOURCES, json.source, "source"),
    outcome: json.outcome === null ? null : oneOf(VISIT_OUTCOMES, json.outcome, "outcome"),
    order_id: nullableUuid(json.order_id, "order_id"),
    advance_requested: bool(json.advance_requested, "advance_requested"),
    advance_paise: advance === null ? null : int(advance, "advance_paise", 1, 100_000_000),
    confirmation_sent: bool(json.confirmation_sent, "confirmation_sent"),
    reminder_sent: bool(json.reminder_sent, "reminder_sent"),
    cancel_reason: nullableStr(json.cancel_reason, "cancel_reason", 400),
    created_at: when(json.created_at, "created_at"),
    confirmed_at: nullableWhen(json.confirmed_at, "confirmed_at"),
    arrived_at: nullableWhen(json.arrived_at, "arrived_at"),
    closed_at: nullableWhen(json.closed_at, "closed_at"),
  };
}

export function parseTodayVisits(json: unknown): { date: string; items: TodayVisit[] } {
  if (!isRecord(json) || !Array.isArray(json.items) || json.items.length > 300) return bad("today list");
  return {
    date: day(json.date, "date"),
    items: json.items.map((row): TodayVisit => {
      if (!isRecord(row)) return bad("today visit");
      return {
        id: uuid(row.id, "id"),
        lead_id: uuid(row.lead_id, "lead_id"),
        starts_at: when(row.starts_at, "starts_at"),
        who: str(row.who, "who", 200),
        extra: int(row.extra, "extra", 0, 49),
        topic: nullableStr(row.topic, "topic", 400),
        status: oneOf(TODAY_VISIT_STATUSES, row.status, "status"),
        visit_status: oneOf(["booked", "confirmed", "arrived"] as const, row.visit_status, "visit_status"),
      };
    }),
  };
}

export function parseVisitList(json: unknown): { from: string; to: string; items: Visit[] } {
  if (!isRecord(json) || !Array.isArray(json.items) || json.items.length > 300) return bad("visit list");
  return { from: day(json.from, "from"), to: day(json.to, "to"), items: json.items.map(parseVisit) };
}

export function parseSlots(json: unknown): Slots {
  if (!isRecord(json) || !Array.isArray(json.slots) || json.slots.length > 200) return bad("slots");
  return {
    date: day(json.date, "date"),
    open: bool(json.open, "open"),
    reason: nullableStr(json.reason, "reason", 40),
    slot_minutes: int(json.slot_minutes, "slot_minutes", 1, 600),
    max_parallel: int(json.max_parallel, "max_parallel", 1, 50),
    slots: json.slots.map((s): Slot => {
      if (!isRecord(s)) return bad("slot");
      return {
        start: typeof s.start === "string" && CLOCK.test(s.start) ? s.start : bad("slot start"),
        starts_at: when(s.starts_at, "starts_at"),
        ends_at: when(s.ends_at, "ends_at"),
        capacity: int(s.capacity, "capacity", 1, 50),
        free: int(s.free, "free", 0, 50),
        past: bool(s.past, "past"),
      };
    }),
  };
}

export function parseSettings(json: unknown): StoreSettings {
  if (!isRecord(json) || !isRecord(json.weekly_hours) || !Array.isArray(json.closed_dates) || json.closed_dates.length > 400) return bad("settings");
  const week = {} as Record<Weekday, DayHours | null>;
  for (const d of WEEKDAYS) {
    const h = json.weekly_hours[d];
    if (h === null) week[d] = null;
    else if (isRecord(h) && typeof h.open === "string" && CLOCK.test(h.open) && typeof h.close === "string" && CLOSE.test(h.close)) week[d] = { open: h.open, close: h.close };
    else return bad("weekly_hours");
  }
  return {
    weekly_hours: week,
    closed_dates: json.closed_dates.map((d) => day(d, "closed_dates")),
    slot_minutes: int(json.slot_minutes, "slot_minutes", 1, 600),
    max_parallel: int(json.max_parallel, "max_parallel", 1, 50),
    is_default: bool(json.is_default, "is_default"),
  };
}

/** The answer of a step: the visit as it now is; `replayed` is true when the same step was already done. */
export function parseStep(json: unknown): { visit: Visit; replayed: boolean } {
  if (!isRecord(json)) return bad("step");
  return { visit: parseVisit(json.visit), replayed: json.replayed === true };
}

export function parseChange(json: unknown): { visit: Visit; moved: boolean } {
  if (!isRecord(json)) return bad("change");
  return { visit: parseVisit(json.visit), moved: bool(json.moved, "moved") };
}

export function parseComplete(json: unknown): { visit: Visit; orderId: string | null; replayed: boolean } {
  if (!isRecord(json)) return bad("complete");
  return { visit: parseVisit(json.visit), orderId: nullableUuid(json.order_id, "order_id"), replayed: json.replayed === true };
}

/** `GET /ai-usage/week`: the share of this week's allowance used (a whole number, 0 to 100), and when the week starts again. Owner and Admin. */
export function parseWeek(json: unknown): { week_percent: number; resets_at_week: string } {
  if (!isRecord(json)) return bad("week");
  return { week_percent: int(json.week_percent, "week_percent", 0, 100), resets_at_week: when(json.resets_at_week, "resets_at_week") };
}

export function parseOfferVisit(json: unknown): { callRequestId: string; messageStatus: "queued" | "needs_approval" | "sent" | "blocked" | "failed"; scheduledFor: string | null } {
  if (!isRecord(json) || !isRecord(json.request) || !isRecord(json.message)) return bad("offer");
  return {
    callRequestId: uuid(json.request.id, "request id"),
    messageStatus: oneOf(["queued", "needs_approval", "sent", "blocked", "failed"] as const, json.message.status, "message status"),
    scheduledFor: nullableWhen(json.message.scheduled_for, "scheduled_for"),
  };
}

const tenantPath = (tenantId: string, tail: string) => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/${tail}`;
};
const idOf = (id: string) => {
  if (!isCanonicalUuid(id)) throw new ApiContractError("id");
  return id;
};
const post = (path: string, accessToken: string, body?: unknown) => apiRequest(path, accessToken, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** `GET /visits/today`: today's visits that are still to come or here now (India date), in time order. Every member. */
export async function getTodayVisits(accessToken: string, tenantId: string) {
  return parseTodayVisits(await apiRequest(tenantPath(tenantId, "visits/today"), accessToken));
}

/** `GET /visits?from=&to=`: visits of a range of India dates (at most 62 days, 300 visits), in time order. `status` narrows the list. */
export async function listVisits(accessToken: string, tenantId: string, opts: { from: string; to: string; status?: VisitStatus; leadId?: string }) {
  if (!DAY.test(opts.from) || !DAY.test(opts.to)) throw new ApiContractError("date");
  const q = new URLSearchParams({ from: opts.from, to: opts.to });
  if (opts.status) q.set("status", opts.status);
  if (opts.leadId) q.set("lead_id", idOf(opts.leadId));
  return parseVisitList(await apiRequest(tenantPath(tenantId, `visits?${q.toString()}`), accessToken));
}

/** `GET /visits/slots?date=`: the day's slots and the places left in each, or why there are none. */
export async function getSlots(accessToken: string, tenantId: string, date: string): Promise<Slots> {
  if (!DAY.test(date)) throw new ApiContractError("date");
  return parseSlots(await apiRequest(tenantPath(tenantId, `visits/slots?date=${date}`), accessToken));
}

export async function getVisitSettings(accessToken: string, tenantId: string): Promise<StoreSettings> {
  return parseSettings(await apiRequest(tenantPath(tenantId, "visits/settings"), accessToken));
}

/** `PUT /visits/settings`: the whole week at once. Owner and Admin. It changes no visit that is already booked. */
export async function putVisitSettings(accessToken: string, tenantId: string, s: Omit<StoreSettings, "is_default">): Promise<StoreSettings> {
  return parseSettings(await apiRequest(tenantPath(tenantId, "visits/settings"), accessToken, { method: "PUT", body: JSON.stringify({ weekly_hours: s.weekly_hours, closed_dates: s.closed_dates, slot_minutes: s.slot_minutes, max_parallel: s.max_parallel }) }));
}

/** `POST /visits`: book. The same `visitId` is a retry and replays. Nothing is sent to the customer. */
export async function bookVisit(accessToken: string, tenantId: string, input: BookInput) {
  const body: Record<string, unknown> = { visit_id: idOf(input.visitId), lead_id: idOf(input.leadId), date: input.date, slot_start: input.slot, party_size: input.partySize };
  if (input.purpose) body.purpose = input.purpose;
  if (input.note) body.note = input.note;
  if (input.advancePaise) body.advance_paise = input.advancePaise;
  return parseStep(await post(tenantPath(tenantId, "visits"), accessToken, body));
}

/** `POST /visits/{id}/change`: move (date and slot together) and/or change the party, purpose, note or advance. A moved visit is `booked` again. */
export async function changeVisit(accessToken: string, tenantId: string, id: string, input: ChangeInput) {
  const body: Record<string, unknown> = {};
  if (input.date !== undefined) body.date = input.date;
  if (input.slot !== undefined) body.slot_start = input.slot;
  if (input.partySize !== undefined) body.party_size = input.partySize;
  if (input.purpose) body.purpose = input.purpose;
  if (input.note) body.note = input.note;
  if (input.advancePaise) body.advance_paise = input.advancePaise;
  if (input.clearAdvance) body.clear_advance = true;
  return parseChange(await post(tenantPath(tenantId, `visits/${idOf(id)}/change`), accessToken, body));
}

export const VISIT_STEPS = ["confirm", "arrive", "no-show", "cancel"] as const;
export type VisitStep = (typeof VISIT_STEPS)[number];
/** `POST /visits/{id}/confirm | arrive | no-show | cancel` (cancel takes an optional short reason). */
export async function stepVisit(accessToken: string, tenantId: string, id: string, step: VisitStep, reason?: string) {
  const body = step === "cancel" && reason ? { reason } : undefined;
  return parseStep(await post(tenantPath(tenantId, `visits/${idOf(id)}/${step}`), accessToken, body));
}

/** `POST /visits/{id}/complete`: arrived to completed with how it ended. `orderId` (made by the page) starts the order from an approved quote with `bought`: Owner or Admin with the second factor. */
export async function completeVisit(accessToken: string, tenantId: string, id: string, input: { outcome: VisitOutcome; orderId?: string }) {
  const body: Record<string, unknown> = { outcome: input.outcome };
  if (input.orderId) body.order_id = idOf(input.orderId);
  return parseComplete(await post(tenantPath(tenantId, `visits/${idOf(id)}/complete`), accessToken, body));
}

/** `POST /call-requests/{id}/offer-visit`: the Owner, with the second factor. The call is declined with the fixed note and the offer message is made in the outbox, in one step. */
export async function offerStoreVisit(accessToken: string, tenantId: string, id: string, language: "en" | "te" | "hi" | "kn" | "ta" = "en") {
  return parseOfferVisit(await post(tenantPath(tenantId, `call-requests/${idOf(id)}/offer-visit`), accessToken, { language }));
}

/** `GET /ai-usage/week` (Owner and Admin). */
export async function getAiUsageWeek(accessToken: string, tenantId: string) {
  return parseWeek(await apiRequest(tenantPath(tenantId, "ai-usage/week"), accessToken));
}
