import { ApiContractError } from "@/lib/api/client";

/**
 * The shapes of C1's staff console API (`GET /v1/admin/me`, `/overview`, `/search`, `POST /access`, `GET /businesses/{id}?access_id=`; docs/contracts/admin-console.md, "C1: PHASE 1 IS BUILT") as the web keeps them, and the readers that
 * check an answer. An answer that does not match is an error, never drawn. Money is text the API already formatted (never worked out here); times are ISO. Pure: no request API, no network.
 */
export type StaffRole = "owner" | "support" | "finance";
export const STAFF_ROLES: readonly StaffRole[] = ["owner", "support", "finance"];

export type HealthState = "healthy" | "degraded" | "down" | "unknown";
export type Priority = "urgent" | "high" | "normal";
export type BusinessStatus = "not_live" | "in_training" | "live" | "paused";

export interface StaffMe {
  /** Who is signed in (to "assign to me" on a ticket); "" when the API did not say. */
  staffId: string;
  name: string;
  role: StaffRole;
  secondFactor: boolean;
}
export type TicketStatus = "open" | "waiting" | "closed";
export const TICKET_STATUSES: readonly TicketStatus[] = ["open", "waiting", "closed"];
export interface Ticket {
  /** The ticket's id ("" for a row of the Overview queue that the API sent without one: it is then not a link). */
  id: string;
  tenantId: string;
  status: TicketStatus;
  priority: Priority;
  channel: string;
  waitingMinutes: number;
  assignee: string | null;
  businessName: string;
  subject: string;
}
export interface TicketMessage {
  id: string;
  kind: "reply" | "note";
  at: string | null;
  staffName: string;
  body: string;
  /** false = saved on the ticket, not sent to the shop yet (their Help form and delivery are not built). */
  delivered: boolean;
}
export interface TicketThread extends Ticket {
  assigneeId: string | null;
  createdAt: string | null;
  lastMessageAt: string | null;
  messages: TicketMessage[];
}
export interface TicketList {
  items: Ticket[];
  total: number;
}
export interface BusinessList {
  items: BusinessRow[];
  nextCursor: string | null;
}
export interface GoodwillResult {
  creditedText: string;
  balanceText: string;
  replayed: boolean;
}
/** The real names and numbers of the ten calls and ten chats a support view lists (matched by `id` / `leadId`), from ONE unmask look. */
export interface Unmasked {
  calls: { id: string; customer: string; customerPhone: string }[];
  chats: { leadId: string; customer: string; customerPhone: string }[];
}
export interface HealthComponent {
  key: string;
  label: string;
  state: HealthState;
  note: string;
}
export interface BusinessRow {
  tenantId: string;
  name: string;
  town: string;
  planName: string;
  status: BusinessStatus;
  balanceText: string;
  lastActivityAt: string | null;
}
export interface ProviderCost {
  provider: string;
  role: string;
  costPaise: number;
  costText: string;
}
export interface Overview {
  generatedAt: string;
  role: StaffRole;
  environment: { key: string; label: string };
  badges: { businesses: number; supportOpen: number; healthIssues: number; complianceOpen: number };
  kpis: {
    mrr: { text: string; changePercent: number | null } | null;
    active: { count: number; addedThisWeek: number; onFreeStart: number };
    calls: { count: number; connectedPercent: number | null };
    margin: { percent: number | null; revenueText: string; costText: string; costsRecordedSince: string | null } | null;
  };
  supportQueue: { totalOpen: number; items: Ticket[] } | null;
  health: { components: HealthComponent[]; issues: number };
  businesses: BusinessRow[];
  costs: { periodStart: string | null; revenueText: string; costText: string; marginText: string; providers: ProviderCost[] } | null;
}

export interface SearchInvoice {
  number: string;
  kind: string;
  businessName: string;
  totalText: string;
  issuedAt: string | null;
}
export interface SearchTicket {
  subject: string;
  businessName: string;
  priority: Priority;
  channel: string;
}
export interface SearchResults {
  businesses: BusinessRow[];
  invoices: SearchInvoice[];
  tickets: SearchTicket[];
}

export interface AccessGrant {
  accessId: string;
  tenantId: string;
  expiresAt: string | null;
}
export interface SupportView {
  business: BusinessRow | null;
  setup: { businessName: string; phoneNumber: string; voiceSaved: boolean; rulesSaved: boolean };
  phoneNumbers: { number: string; label: string; inboundOn: boolean }[];
  whatsapp: { connected: boolean; status: string; displayPhone: string | null; connectedAt: string | null };
  numbers30d: { calls: number; callMinutes: number; messagesSent: number; leads: number; quotes: number; visits: number };
  recentCalls: { id: string; at: string | null; direction: string; state: string; durationS: number; outcome: string; customer: string; customerPhone: string }[];
  recentChats: { leadId: string; lastAt: string | null; customer: string; customerPhone: string }[];
}

const bad = (what: string): never => {
  throw new ApiContractError(`Unexpected ${what} in a staff console response.`);
};
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const rec = (v: unknown, what: string): Record<string, unknown> => (isRecord(v) ? v : bad(what));
const str = (v: unknown, what: string, max = 400): string => (typeof v === "string" && v.length <= max ? v : bad(what));
const num = (v: unknown, what: string): number => (typeof v === "number" && Number.isFinite(v) ? v : bad(what));
const bool = (v: unknown, what: string): boolean => (typeof v === "boolean" ? v : bad(what));
const arr = (v: unknown, what: string): unknown[] => (Array.isArray(v) ? v : bad(what));
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], what: string): T => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : bad(what));
const maybe = <T>(v: unknown, read: (x: unknown) => T): T | null => (v === null || v === undefined ? null : read(v));
const iso = (v: unknown, what: string): string => {
  const s = str(v, what, 40);
  return Number.isNaN(Date.parse(s)) ? bad(what) : s;
};

const HEALTH: readonly HealthState[] = ["healthy", "degraded", "down", "unknown"];
const PRIORITIES: readonly Priority[] = ["urgent", "high", "normal"];
const STATUSES: readonly BusinessStatus[] = ["not_live", "in_training", "live", "paused"];

export function parseMe(json: unknown): StaffMe {
  const o = rec(json, "me");
  return { staffId: typeof o.staff_id === "string" ? str(o.staff_id, "staff_id", 80) : "", name: str(o.name, "name", 200), role: oneOf(o.role, STAFF_ROLES, "role"), secondFactor: bool(o.second_factor, "second_factor") };
}

const TICKET_STATUS_OF = (v: unknown): TicketStatus => (typeof v === "string" && (TICKET_STATUSES as readonly string[]).includes(v) ? (v as TicketStatus) : "open");

export function parseTicket(json: unknown): Ticket {
  const o = rec(json, "ticket");
  const assignee = maybe(o.assignee, (a) => str(rec(a, "assignee").name, "assignee name", 200));
  return {
    id: typeof o.id === "string" ? str(o.id, "id", 64) : "",
    tenantId: typeof o.tenant_id === "string" ? str(o.tenant_id, "tenant_id", 64) : "",
    status: TICKET_STATUS_OF(o.status),
    priority: oneOf(o.priority, PRIORITIES, "priority"),
    channel: str(o.channel, "channel", 20),
    waitingMinutes: Math.max(0, Math.round(num(o.waiting_minutes, "waiting_minutes"))),
    assignee,
    businessName: str(o.business_name, "business_name", 200),
    subject: str(o.subject, "subject", 300),
  };
}

export function parseTicketList(json: unknown): TicketList {
  const o = rec(json, "tickets");
  const items = arr(o.items, "items").map(parseTicket);
  return { items, total: typeof o.total === "number" && Number.isFinite(o.total) ? o.total : items.length };
}

export function parseThread(json: unknown): TicketThread {
  const o = rec(json, "ticket thread");
  const base = parseTicket(o);
  if (base.id === "") bad("ticket id");
  const assignee = isRecord(o.assignee) ? o.assignee : null;
  return {
    ...base,
    assigneeId: assignee && typeof assignee.id === "string" ? assignee.id : null,
    createdAt: maybe(o.created_at, (d) => iso(d, "created_at")),
    lastMessageAt: maybe(o.last_message_at, (d) => iso(d, "last_message_at")),
    messages: arr(o.messages, "messages").map((m) => {
      const r = rec(m, "message");
      const staff = isRecord(r.staff) ? r.staff : null;
      return {
        id: str(r.id, "message id", 64),
        kind: oneOf(r.kind, ["reply", "note"] as const, "message kind"),
        at: maybe(r.at, (d) => iso(d, "at")),
        staffName: staff && typeof staff.name === "string" ? str(staff.name, "staff name", 200) : "Staff",
        body: str(r.body, "body", 4100),
        delivered: r.delivered === true,
      };
    }),
  };
}

export function parseBusinessList(json: unknown): BusinessList {
  const o = rec(json, "businesses");
  return { items: arr(o.items, "items").map(parseBusinessRow), nextCursor: typeof o.next_cursor === "string" && o.next_cursor !== "" ? o.next_cursor : null };
}

export function parseGoodwill(json: unknown): GoodwillResult {
  const o = rec(json, "goodwill credit");
  return { creditedText: str(o.credited_text, "credited_text", 40), balanceText: str(o.balance_text, "balance_text", 40), replayed: o.replayed === true };
}

export function parseUnmasked(json: unknown): Unmasked {
  const o = rec(json, "unmasked");
  return {
    calls: arr(o.recent_calls, "recent_calls").map((c) => {
      const r = rec(c, "call");
      return { id: str(r.id, "id", 64), customer: typeof r.customer === "string" ? str(r.customer, "customer", 300) : "", customerPhone: typeof r.customer_phone === "string" ? str(r.customer_phone, "customer_phone", 60) : "" };
    }),
    chats: arr(o.recent_chats, "recent_chats").map((c) => {
      const r = rec(c, "chat");
      return { leadId: str(r.lead_id, "lead_id", 64), customer: typeof r.customer === "string" ? str(r.customer, "customer", 300) : "", customerPhone: typeof r.customer_phone === "string" ? str(r.customer_phone, "customer_phone", 60) : "" };
    }),
  };
}

export function parseBusinessRow(json: unknown): BusinessRow {
  const o = rec(json, "business");
  return {
    tenantId: str(o.tenant_id, "tenant_id", 64),
    name: str(o.name, "name", 200),
    town: typeof o.town === "string" ? str(o.town, "town", 200) : "",
    planName: typeof o.plan_name === "string" ? str(o.plan_name, "plan_name", 100) : "",
    status: oneOf(o.status, STATUSES, "status"),
    balanceText: str(o.balance_text, "balance_text", 40),
    lastActivityAt: maybe(o.last_activity_at, (v) => iso(v, "last_activity_at")),
  };
}

export function parseOverview(json: unknown): Overview {
  const o = rec(json, "overview");
  const badges = rec(o.badges, "badges");
  const kpis = rec(o.kpis, "kpis");
  const active = rec(kpis.active_businesses, "active_businesses");
  const calls = rec(kpis.calls_today, "calls_today");
  const health = rec(o.health, "health");
  const env = rec(o.environment, "environment");
  return {
    generatedAt: iso(o.generated_at, "generated_at"),
    role: oneOf(o.role, STAFF_ROLES, "role"),
    environment: { key: str(env.key, "environment key", 20), label: typeof env.label === "string" ? str(env.label, "environment label", 60) : "" },
    badges: { businesses: num(badges.businesses, "badge"), supportOpen: num(badges.support_open, "badge"), healthIssues: num(badges.health_issues, "badge"), complianceOpen: num(badges.compliance_open, "badge") },
    kpis: {
      mrr: maybe(kpis.mrr, (v) => {
        const m = rec(v, "mrr");
        return { text: str(m.text, "mrr text", 40), changePercent: maybe(m.change_percent, (c) => num(c, "change_percent")) };
      }),
      active: { count: num(active.count, "count"), addedThisWeek: num(active.added_this_week, "added_this_week"), onFreeStart: num(active.on_free_start, "on_free_start") },
      calls: { count: num(calls.count, "calls count"), connectedPercent: maybe(calls.connected_percent, (c) => num(c, "connected_percent")) },
      margin: maybe(kpis.gross_margin, (v) => {
        const m = rec(v, "gross_margin");
        return { percent: maybe(m.percent, (p) => num(p, "percent")), revenueText: str(m.revenue_text, "revenue_text", 40), costText: str(m.cost_text, "cost_text", 40), costsRecordedSince: maybe(m.costs_recorded_since, (d) => iso(d, "costs_recorded_since")) };
      }),
    },
    supportQueue: maybe(o.support_queue, (v) => {
      const q = rec(v, "support_queue");
      return { totalOpen: num(q.total_open, "total_open"), items: arr(q.items, "items").map(parseTicket) };
    }),
    health: {
      components: arr(health.components, "components").map((c) => {
        const h = rec(c, "component");
        return { key: str(h.key, "component key", 40), label: str(h.label, "component label", 100), state: oneOf(h.state, HEALTH, "health state"), note: typeof h.note === "string" ? str(h.note, "note", 200) : "" };
      }),
      issues: typeof health.issues === "number" ? health.issues : 0,
    },
    businesses: arr(o.businesses, "businesses").map(parseBusinessRow),
    costs: maybe(o.costs_this_month, (v) => {
      const c = rec(v, "costs_this_month");
      return {
        periodStart: maybe(c.period_start, (d) => iso(d, "period_start")),
        revenueText: str(c.revenue_text, "revenue_text", 40),
        costText: str(c.cost_text, "cost_text", 40),
        marginText: str(c.margin_text, "margin_text", 40),
        providers: arr(c.providers, "providers").map((p) => {
          const r = rec(p, "provider");
          return { provider: str(r.provider, "provider", 40), role: str(r.role, "provider role", 40), costPaise: num(r.cost_paise, "cost_paise"), costText: str(r.cost_text, "cost_text", 40) };
        }),
      };
    }),
  };
}

export function parseSearch(json: unknown): SearchResults {
  const o = rec(json, "search");
  const list = (v: unknown): unknown[] => (v === undefined || v === null ? [] : arr(v, "search list"));
  return {
    businesses: list(o.businesses).map(parseBusinessRow),
    invoices: list(o.invoices).map((i) => {
      const r = rec(i, "invoice");
      return { number: str(r.number, "number", 60), kind: str(r.kind, "kind", 40), businessName: str(r.business_name, "business_name", 200), totalText: str(r.total_text, "total_text", 40), issuedAt: maybe(r.issued_at, (d) => iso(d, "issued_at")) };
    }),
    tickets: list(o.tickets).map((t) => {
      const r = rec(t, "ticket");
      return { subject: str(r.subject, "subject", 300), businessName: str(r.business_name, "business_name", 200), priority: oneOf(r.priority, PRIORITIES, "priority"), channel: str(r.channel, "channel", 20) };
    }),
  };
}

export function parseAccess(json: unknown): AccessGrant {
  const o = rec(json, "access");
  return { accessId: str(o.access_id, "access_id", 80), tenantId: str(o.tenant_id, "tenant_id", 64), expiresAt: maybe(o.expires_at, (d) => iso(d, "expires_at")) };
}

export function parseSupportView(json: unknown): SupportView {
  const o = rec(json, "support view");
  if (o.support_view !== true) bad("support view marker"); // a body that is not the masked support view is never drawn
  const setup = rec(o.setup, "setup");
  const wa = rec(o.whatsapp, "whatsapp");
  const n = rec(o.numbers_30d, "numbers_30d");
  return {
    business: isRecord(o.business) ? parseBusinessRow(o.business) : null,
    setup: { businessName: str(setup.business_name, "business_name", 200), phoneNumber: typeof setup.phone_number === "string" ? setup.phone_number : "", voiceSaved: setup.voice_saved === true, rulesSaved: setup.rules_saved === true },
    phoneNumbers: arr(o.phone_numbers, "phone_numbers").map((p) => {
      const r = rec(p, "phone number");
      return { number: str(r.number, "number", 40), label: typeof r.label === "string" ? r.label : "", inboundOn: r.inbound_on === true };
    }),
    whatsapp: { connected: wa.connected === true, status: typeof wa.status === "string" ? wa.status : "", displayPhone: maybe(wa.display_phone, (d) => str(d, "display_phone", 40)), connectedAt: maybe(wa.connected_at, (d) => iso(d, "connected_at")) },
    numbers30d: { calls: num(n.calls, "calls"), callMinutes: num(n.call_minutes, "call_minutes"), messagesSent: num(n.messages_sent, "messages_sent"), leads: num(n.leads, "leads"), quotes: num(n.quotes, "quotes"), visits: num(n.visits, "visits") },
    recentCalls: arr(o.recent_calls, "recent_calls").map((c) => {
      const r = rec(c, "call");
      return { id: str(r.id, "id", 64), at: maybe(r.at, (d) => iso(d, "at")), direction: typeof r.direction === "string" ? r.direction : "", state: typeof r.state === "string" ? r.state : "", durationS: typeof r.duration_s === "number" ? r.duration_s : 0, outcome: typeof r.outcome === "string" ? r.outcome : "", customer: typeof r.customer === "string" ? r.customer : "", customerPhone: typeof r.customer_phone === "string" ? r.customer_phone : "" };
    }),
    recentChats: arr(o.recent_chats, "recent_chats").map((c) => {
      const r = rec(c, "chat");
      return { leadId: str(r.lead_id, "lead_id", 64), lastAt: maybe(r.last_at, (d) => iso(d, "last_at")), customer: typeof r.customer === "string" ? r.customer : "", customerPhone: typeof r.customer_phone === "string" ? r.customer_phone : "" };
    }),
  };
}
