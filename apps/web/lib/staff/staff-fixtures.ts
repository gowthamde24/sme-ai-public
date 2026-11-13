import type { StaffRole } from "./types";

/**
 * The made-up staff console (STAFF_CONSOLE=mock): the numbers of the approved mock (approved-mocks/admin-overview.html) and a saree-shop business set, written as C1's JSON so the same readers that check the real API check this. Nothing here is real: no customer, no
 * number, no money. The role changes what the API would leave out (support: no MRR, margin or costs; finance: no support queue). Times are worked out from `now`, so "2 min ago" is always fresh.
 */
const MIN = 60_000;
const at = (now: Date, minutesAgo: number): string => new Date(now.getTime() - minutesAgo * MIN).toISOString();
const paise = (rupees: number): number => rupees * 100;

export const MOCK_NAMES: Record<StaffRole, string> = { owner: "Gowtham", support: "Anu S.", finance: "Priya R." };

const ID = (n: number): string => `00000000-0000-4000-8000-00000000000${n}`;
export const MOCK_BUSINESSES = [
  { n: 1, name: "Sri Lakshmi Silks", town: "Dharmavaram", plan: "sales_assistant", plan_name: "Sales Assistant", balance: "₹1,550", status: "live", ago: 2 },
  { n: 2, name: "Sri Venkateswara Sarees", town: "Bengaluru", plan: "payg", plan_name: "Pay as you go", balance: "₹86", status: "live", ago: 1 },
  { n: 3, name: "Lakshmi Textiles", town: "Hyderabad", plan: "sales_lead_finder", plan_name: "+ Lead Finder", balance: "₹4,210", status: "paused", ago: 180 },
  { n: 4, name: "Meenakshi Silks", town: "Bengaluru", plan: "sales_assistant", plan_name: "Sales Assistant", balance: "₹50", status: "in_training", ago: 1500 },
  { n: 5, name: "Vasavi Pattu Centre", town: "Mysuru", plan: "sales_assistant", plan_name: "Sales Assistant", balance: "₹720", status: "live", ago: 8 },
  { n: 6, name: "Gayatri Saree Point", town: "Vijayawada", plan: "payg", plan_name: "Pay as you go", balance: "₹50", status: "not_live", ago: 2880 },
] as const;

const businessJson = (b: (typeof MOCK_BUSINESSES)[number], now: Date) => ({
  tenant_id: ID(b.n),
  name: b.name,
  town: b.town,
  demo: true,
  business_type: "textiles",
  plan: b.plan,
  plan_name: b.plan_name,
  balance_paise: 0,
  balance_text: b.balance,
  status: b.status,
  signup_at: at(now, 60 * 24 * 30),
  last_activity_at: at(now, b.ago),
});

const TICKETS = [
  { priority: "urgent", channel: "phone", waiting_minutes: 12, assignee: "Ravi K.", business_name: "Sri Venkateswara Sarees", subject: "Calls not reaching assistant since 10:15" },
  { priority: "high", channel: "whatsapp", waiting_minutes: 34, assignee: null, business_name: "Lakshmi Textiles", subject: "Quote amount wrong on WhatsApp" },
  { priority: "normal", channel: "chat", waiting_minutes: 60, assignee: "Anu S.", business_name: "Meenakshi Silks", subject: "How to add second phone number?" },
  { priority: "normal", channel: "email", waiting_minutes: 120, assignee: null, business_name: "Gayatri Saree Point", subject: "Invoice GST number missing" },
  { priority: "normal", channel: "chat", waiting_minutes: 180, assignee: "Anu S.", business_name: "Vasavi Pattu Centre", subject: "Change assistant greeting to Kannada" },
] as const;

const PROVIDERS = [
  { provider: "cartesia", role: "voice", rupees: 38900 },
  { provider: "sarvam", role: "speech_to_text", rupees: 12400 },
  { provider: "plivo", role: "calls_and_numbers", rupees: 21700 },
  { provider: "anthropic", role: "ai_model", rupees: 8600 },
  { provider: "meta", role: "whatsapp", rupees: 2300 },
  { provider: "google", role: "lead_search", rupees: 0 },
] as const;

export function overviewJson(role: StaffRole, now: Date = new Date()): Record<string, unknown> {
  const money = role !== "support";
  return {
    generated_at: now.toISOString(),
    role,
    environment: { key: "staging", label: "Staging · test data" },
    badges: { businesses: 128, support_open: 7, health_issues: 1, compliance_open: 3 },
    kpis: {
      mrr: money ? { paise: paise(241800), text: "₹2,41,800", change_percent: 12 } : null,
      active_businesses: { count: 128, added_this_week: 9, on_free_start: 14 },
      calls_today: { count: 3412, connected_percent: 98.6 },
      gross_margin: money ? { percent: 41, revenue_paise: paise(241800), revenue_text: "₹2,41,800", cost_paise: paise(83900), cost_text: "₹83,900", costs_recorded_since: at(now, 60 * 24 * 2) } : null,
    },
    support_queue: role === "finance" ? null : { total_open: 7, items: TICKETS.map((t, i) => ({ id: `t${i}`, tenant_id: ID(i + 1), created_at: at(now, t.waiting_minutes), last_message_at: at(now, t.waiting_minutes), status: "open", ...t, assignee: t.assignee ? { id: `s${i}`, name: t.assignee } : null })) },
    health: {
      components: [
        { key: "api", label: "API", state: "healthy", note: "" },
        { key: "phone_calls", label: "Phone calls", state: "healthy", note: "" },
        { key: "whatsapp", label: "WhatsApp webhook", state: "degraded", note: "2 errors / 1h" },
        { key: "voice", label: "Voice (Cartesia)", state: "unknown", note: "Latency is not measured yet" },
        { key: "database", label: "Database", state: "healthy", note: "" },
        { key: "payments", label: "Payments (test)", state: "healthy", note: "" },
      ],
      issues: 1,
    },
    businesses: MOCK_BUSINESSES.map((b) => businessJson(b, now)),
    costs_this_month: money
      ? {
          period_start: "2026-11-01T00:00:00+05:30",
          revenue_paise: paise(241800),
          revenue_text: "₹2,41,800",
          cost_paise: paise(83900),
          cost_text: "₹83,900",
          margin_paise: paise(157900),
          margin_text: "₹1,57,900",
          providers: PROVIDERS.map((p) => ({ provider: p.provider, role: p.role, cost_paise: paise(p.rupees), cost_text: `₹${p.rupees.toLocaleString("en-IN")}` })),
        }
      : null,
  };
}

export function meJson(role: StaffRole): Record<string, unknown> {
  return { staff_id: `staff-${role}`, name: MOCK_NAMES[role], role, second_factor: true, session_idle_limit_minutes: 30 };
}

export function searchJson(role: StaffRole, q: string, now: Date = new Date()): Record<string, unknown> {
  const needle = q.trim().toLowerCase();
  const hit = (s: string) => s.toLowerCase().includes(needle);
  const businesses = MOCK_BUSINESSES.filter((b) => hit(b.name) || hit(b.town)).map((b) => businessJson(b, now));
  const invoices = role === "support" ? [] : MOCK_BUSINESSES.filter((b) => hit(b.name) || hit(`inv-${b.n}`) || hit("invoice")).slice(0, 3).map((b) => ({ number: `S19-2026-00${b.n}${b.n}`, kind: "plan", tenant_id: ID(b.n), business_name: b.name, total_paise: paise(1499), total_text: "₹1,499", issued_at: at(now, 60 * 24 * 5) }));
  const tickets = role === "finance" ? [] : TICKETS.filter((t) => hit(t.business_name) || hit(t.subject)).slice(0, 3).map((t) => ({ id: "t", tenant_id: ID(1), status: "open", created_at: at(now, t.waiting_minutes), last_message_at: at(now, 1), ...t, assignee: null }));
  return { businesses, invoices, tickets };
}

export function accessJson(tenantId: string, now: Date = new Date()): Record<string, unknown> {
  return { access_id: `mock-access-${tenantId}`, tenant_id: tenantId, scope: "profile", expires_at: new Date(now.getTime() + 15 * MIN).toISOString() };
}

/** The masked support view of one mock business: names and numbers drawn the way C1 masks them. */
export function supportViewJson(tenantId: string, now: Date = new Date()): Record<string, unknown> | null {
  const b = MOCK_BUSINESSES.find((x) => ID(x.n) === tenantId);
  if (!b) return null;
  return {
    business: businessJson(b, now),
    setup: { business_name: b.name, phone_number: "+•• ••••• ••210", voice_saved: b.status !== "not_live", rules_saved: b.status === "live" || b.status === "paused" },
    phone_numbers: [{ number: "+•• ••••• ••210", label: "Shop line", inbound_on: b.status === "live" }],
    whatsapp: { connected: b.status !== "not_live", status: b.status === "not_live" ? "not_connected" : "connected", display_phone: b.status === "not_live" ? null : "+•• ••••• ••514", connected_at: b.status === "not_live" ? null : at(now, 60 * 24 * 20) },
    numbers_30d: { calls: 412, call_minutes: 1180, messages_sent: 960, leads: 87, quotes: 31, visits: 12 },
    recent_calls: [
      { id: "c1", at: at(now, 14), direction: "inbound", state: "completed", duration_s: 84, outcome: "Visit booked", customer: "P•••••• N••••", customer_phone: "+•• ••••• ••210" },
      { id: "c2", at: at(now, 95), direction: "inbound", state: "completed", duration_s: 41, outcome: "Asked for a quote", customer: "K••••• R•••", customer_phone: "+•• ••••• ••733" },
      { id: "c3", at: at(now, 400), direction: "outbound", state: "no_answer", duration_s: 0, outcome: "No answer", customer: "S•••• L•••••", customer_phone: "+•• ••••• ••058" },
    ],
    recent_chats: [
      { lead_id: "l1", last_at: at(now, 22), customer: "P•••••• N••••", customer_phone: "+•• ••••• ••210" },
      { lead_id: "l2", last_at: at(now, 300), customer: "M••••• D••••", customer_phone: "+•• ••••• ••419" },
    ],
    support_view: true,
  };
}
