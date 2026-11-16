/**
 * The browser actions the assistant can trigger (owner, 14 Nov: "everything a user can do anywhere in the app, they can ask for"): ONE typed registry. The server sends a `client_action` work card
 * `{action, args}` (C1 emits only what this list names); the web checks it here, strictly, and runs it in the browser. Anything not listed, or with an argument outside its list, is dropped: never run, never guessed.
 * Pure: no browser in this file (the card does the running). Every address is built HERE from closed words and canonical ids, never from text the server (or a customer) wrote.
 */
export const PAGES = ["today", "my_assistant", "calls", "chats", "leads", "campaigns", "reports", "catalogue", "catalogue_new", "price_lists", "price_ranges", "phone_numbers", "billing", "settings", "outbox", "templates", "visits", "lead_sources"] as const;
export type Page = (typeof PAGES)[number];
export const PATH: Readonly<Record<Page, string>> = { today: "", my_assistant: "/my-assistant", calls: "/calls", chats: "/chats", leads: "/lead-desk", campaigns: "/outreach", reports: "/report", catalogue: "/catalogue", catalogue_new: "/catalogue/new", price_lists: "/price-list", price_ranges: "/price-list#price-ranges", phone_numbers: "/phone-number", billing: "/billing", settings: "/settings", outbox: "/outbox", templates: "/chats/templates", visits: "/visits", lead_sources: "/lead-sources" };

export const THEMES = ["light", "dark", "system"] as const;
export const APP_LANGS = ["en", "te", "hi", "kn"] as const;
export const RECORD_TYPES = ["lead", "call", "chat", "customer", "campaign", "quote"] as const;
export const RECORD_PATH: Readonly<Record<(typeof RECORD_TYPES)[number], string>> = { lead: "/leads", call: "/calls", chat: "/chats", customer: "/customers", campaign: "/campaigns", quote: "/quotes" };
export const CALL_STATUSES = ["all", "completed", "transferred", "no_answer", "rejected", "spam", "live"] as const;
export const LEAD_FILTERS = ["all", "new", "contacted", "visit_booked", "quote", "won", "lost"] as const;
export const CALL_WHENS = ["any", "today", "7d", "30d"] as const;
export const SETTINGS_SECTIONS = ["business", "profile", "plan", "members", "quotes", "fields", "data", "language", "assistant", "activity", "agent", "leadfinder", "notifications", "limits", "security"] as const; // plan-id-ok: Settings sections ("plan" is the Plan section), not plan names

export type Period = { key: "today" | "14" | "month" } | { key: "custom"; from: string; to: string };
export type ClientAction =
  | { action: "theme"; mode: (typeof THEMES)[number] }
  | { action: "language"; lang: (typeof APP_LANGS)[number] }
  | { action: "navigate"; page: Page; period: Period | null; card: string | null }
  | { action: "open_record"; type: (typeof RECORD_TYPES)[number]; id: string }
  | { action: "filter"; page: "calls"; status: (typeof CALL_STATUSES)[number]; when: (typeof CALL_WHENS)[number]; q: string }
  | { action: "filter"; page: "leads"; chip: (typeof LEAD_FILTERS)[number]; q: string }
  | { action: "open_settings"; section: (typeof SETTINGS_SECTIONS)[number] }
  | { action: "talk_live"; state: "start" | "stop" };

const rec = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const one = <T extends string>(list: readonly T[], v: unknown): T | null => ((list as readonly unknown[]).includes(v) ? (v as T) : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function parsePeriod(v: unknown): Period | null {
  if (typeof v === "string") return v === "today" || v === "14" || v === "month" ? { key: v } : null;
  const r = rec(v);
  if (!r) return null;
  const key = r.key ?? "custom";
  if (key === "today" || key === "14" || key === "month") return { key };
  return key === "custom" && typeof r.from === "string" && typeof r.to === "string" && DAY.test(r.from) && DAY.test(r.to) && r.from <= r.to ? { key: "custom", from: r.from, to: r.to } : null;
}

/** The action of a `client_action` card, or null when it is not one this registry runs. `json` is the card: `{action, args}`. */
export function parseClientAction(json: unknown): ClientAction | null {
  const card = rec(json);
  const args = rec(card?.args) ?? {};
  switch (card?.action) {
    case "theme": {
      const mode = one(THEMES, args.mode);
      return mode ? { action: "theme", mode } : null;
    }
    case "language": {
      const lang = one(APP_LANGS, args.lang);
      return lang ? { action: "language", lang } : null;
    }
    case "navigate": {
      const page = one(PAGES, args.page);
      if (!page) return null;
      const period = args.period === undefined || args.period === null ? null : parsePeriod(args.period);
      if (args.period !== undefined && args.period !== null && period === null) return null; // a period it does not know is not guessed
      const card = page === "lead_sources" && typeof args.card === "string" && /^[a-z_]{1,20}$/.test(args.card) ? args.card : null; // only the sources page opens a card ("connect my IndiaMART"); the page checks the name against its own list
      return { action: "navigate", page, period: page === "reports" ? period : null, card }; // only the Reports page reads a period
    }
    case "open_record": {
      const type = one(RECORD_TYPES, args.type);
      return type && typeof args.id === "string" && UUID.test(args.id) ? { action: "open_record", type, id: args.id } : null;
    }
    case "filter": {
      const text = typeof args.q === "string" ? args.q.replace(/\s+/g, " ").trim().slice(0, 80) : "";
      if (args.page === "leads") {
        const chip = args.status === undefined ? "all" : one(LEAD_FILTERS, args.status);
        return chip ? { action: "filter", page: "leads", chip, q: text } : null;
      }
      if (args.page !== "calls") return null; // the pages whose filters are in their address
      const status = args.status === undefined ? "all" : one(CALL_STATUSES, args.status);
      const when = args.when === undefined ? "any" : one(CALL_WHENS, args.when);
      if (!status || !when) return null;
      return { action: "filter", page: "calls", status, when, q: text };
    }
    case "open_settings": {
      const section = one(SETTINGS_SECTIONS, args.section);
      return section ? { action: "open_settings", section } : null;
    }
    case "talk_live": {
      const state = one(["start", "stop"] as const, args.state);
      return state ? { action: "talk_live", state } : null;
    }
    default:
      return null;
  }
}
