/**
 * The lead-source cards (job context-and-easy-sources part B, contract-context-sources.md): `GET /lead-sources/cards` always in this order, each with a live status, ONE action and, when something is wrong, a problem in plain words with a one-tap fix. The card's own sentences
 * (headline, detail, problem) come from the API in plain words and are shown as they are; the card's title and the buttons are this app's own words, in the person's language. Keys are never read back: only a hint ("...a1b2").
 */
import { readCodes, type CardCodes } from "./codes";

export const CARD_KINDS = ["meta", "indiamart", "email_forward", "website", "files", "whatsapp", "missed_calls", "click_to_whatsapp", "google_ads", "sheets"] as const;
export type CardKind = (typeof CARD_KINDS)[number];
export const STATUSES = ["not_connected", "connected", "needs_attention", "coming_soon"] as const;
export const STATES = ["connected", "waiting", "needs_attention", "paused", "off"] as const;
export type CardState = (typeof STATES)[number];
export type CardStatus = (typeof STATUSES)[number];
export const ACTIONS = ["oauth", "paste_key", "copy_address", "copy_snippet", "upload", "resume", "open", "none"] as const;
export type CardAction = (typeof ACTIONS)[number];

export type Card = { kind: CardKind; status: CardStatus; headline: string; detail: string | null; received7d: number; lastReceivedAt: string | null; state: CardState; receivedTotal: number; canTest: boolean; canDisconnect: boolean; testLabel: string | null; costPerLeadPaise: number | null; costSource: string | null; action: CardAction; problem: { message: string; fix: CardAction } | null; available: boolean; /** The words as codes (C1 #832): this app's own sentence for a code it knows, the English field otherwise. */ codes?: CardCodes };
export type MetaPage = { id: string; name: string; selected: boolean };
export type EmailAddress = { address: string; guide: { step: number; text: string }[]; portals: string[]; confirmation: { code: string; receivedAt: string | null } | null };
export type WebsiteSnippet = { snippet: string; formLink: string | null; webhookUrl: string | null };
/** The closed words a refusal becomes. */
export type SourceError = "badkey" | "consent_required" | "notavailable" | "state" | "forbidden" | "slow" | "down" | "notconnected" | "paused";
/** What a test leaves behind: nothing real, one marked lead the owner can see arrive. */
export const TEST_RESULTS = ["lead_created", "reachable", "key_valid", "key_rejected", "rate_limited", "waiting_for_provider"] as const;
export type TestResult = { result: (typeof TEST_RESULTS)[number]; message: string; leadId: string | null; /** The portal the e-mail parser recognised in its test mail (e-mail card only). */ portal: string | null };
/** What a card's connect (or "new address") answers for the kinds whose address is shown ONCE (missed calls, Google Ads): the address and the short steps. Only a hash is kept by the API: the value is on screen only in that answer. */
export type ConnectInfo = { fields: { label: string; value: string }[]; steps: string[] };
export type Done<T> = { ok: true; data: T } | { ok: false; error: SourceError };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const s = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : null);
const action = (v: unknown): CardAction => ((ACTIONS as readonly unknown[]).includes(v) ? (v as CardAction) : "none");

/** The lead tag `PUT /outreach/source-costs` takes for a card (C1, 15 Nov): the API's own `cost_source` when it sends one, else this table. */
export const COST_SOURCE: Record<string, string> = { meta: "meta_lead_ads", indiamart: "indiamart", website: "website_form", email_forward: "email_forward", google_ads: "google_ads", click_to_whatsapp: "click_to_whatsapp", missed_calls: "missed_calls", sheets: "google_sheet", files: "excel_upload" };
const costSourceOf = (raw: Record<string, unknown>): string | null => (typeof raw.cost_source === "string" && /^[a-z0-9_]{1,40}$/.test(raw.cost_source) ? raw.cost_source : typeof raw.kind === "string" ? (COST_SOURCE[raw.kind] ?? null) : null);
const nat = (v: unknown): number => (typeof v === "number" && v >= 0 ? Math.trunc(v) : 0);
/** The card's one word: the API's `state` when it sends one, else worked out from the older `status` (an API without the new fields still draws right). */
const stateOf = (raw: Record<string, unknown>): CardState =>
  (STATES as readonly unknown[]).includes(raw.state) ? (raw.state as CardState) : raw.status === "connected" ? (nat(raw.received_7d) > 0 ? "connected" : "waiting") : raw.status === "needs_attention" ? "needs_attention" : "off";
export function parseCards(json: unknown): Card[] | null {
  if (!isRec(json) || !Array.isArray(json.items)) return null;
  const out: Card[] = [];
  for (const raw of json.items.slice(0, 20)) {
    if (!isRec(raw) || !(CARD_KINDS as readonly unknown[]).includes(raw.kind) || !(STATUSES as readonly unknown[]).includes(raw.status)) continue; // a card this app does not know is left out
    const problem = isRec(raw.problem) && s(raw.problem.message, 300) ? { message: s(raw.problem.message, 300) as string, fix: action(isRec(raw.problem.fix) ? raw.problem.fix.type : null) } : null;
    out.push({ kind: raw.kind as CardKind, status: raw.status as CardStatus, headline: s(raw.headline, 120) ?? "", detail: s(raw.detail, 200), received7d: typeof raw.received_7d === "number" && raw.received_7d >= 0 ? Math.trunc(raw.received_7d) : 0, lastReceivedAt: s(raw.last_received_at, 40), state: stateOf(raw), receivedTotal: nat(raw.received_total), canTest: raw.can_test === true, canDisconnect: raw.can_disconnect === true, testLabel: s(raw.test_label, 120), costPerLeadPaise: isRec(raw.ad_cost) && typeof raw.ad_cost.cost_per_lead_paise === "number" && raw.ad_cost.cost_per_lead_paise >= 0 ? Math.trunc(raw.ad_cost.cost_per_lead_paise) : null, costSource: costSourceOf(raw), action: isRec(raw.action) ? action(raw.action.type) : "none", problem, available: raw.available !== false, codes: readCodes(raw.text) });
  }
  return out;
}
export function parsePages(json: unknown): MetaPage[] | null {
  if (!isRec(json) || !Array.isArray(json.items)) return null;
  return json.items.filter(isRec).slice(0, 50).flatMap((p) => (typeof p.id === "string" && typeof p.name === "string" ? [{ id: p.id.slice(0, 64), name: p.name.slice(0, 120), selected: p.selected === true }] : []));
}
export function parseAuthorize(json: unknown): string | null {
  if (!isRec(json) || typeof json.authorize_url !== "string") return null;
  try {
    const u = new URL(json.authorize_url);
    return u.protocol === "https:" ? u.toString() : null; // only a secure address is ever opened
  } catch {
    return null;
  }
}
export function parseEmail(json: unknown): EmailAddress | null {
  if (!isRec(json) || !s(json.address, 200)) return null;
  const guide = Array.isArray(json.gmail_filter_guide) ? json.gmail_filter_guide.filter(isRec).slice(0, 10).flatMap((g, i) => (s(g.text, 300) ? [{ step: typeof g.step === "number" ? g.step : i + 1, text: s(g.text, 300) as string }] : [])) : [];
  return { address: s(json.address, 200) as string, guide, portals: Array.isArray(json.sample_portals) ? json.sample_portals.filter((x): x is string => typeof x === "string").slice(0, 8) : [], confirmation: isRec(json.gmail_confirmation) && s(json.gmail_confirmation.code, 40) ? { code: s(json.gmail_confirmation.code, 40) as string, receivedAt: s(json.gmail_confirmation.received_at, 40) } : null };
}
/** A portal that has no connector of its own (JustDial, 99acres, MagicBricks, Housing, Sulekha, TradeIndia): the portal's team switches lead delivery on; `askText` is the short message the owner sends them (contract lead-sources-v2.md, "Portal leads arrive by themselves"). */
export type Portal = { id: string; name: string; askText: string };
/** `GET /lead-sources/portals`: only the portals that are set up by their account manager; IndiaMART (automatic) has its own card. Anything unreadable is left out. */
export function parsePortals(json: unknown): Portal[] | null {
  if (!isRec(json) || !Array.isArray(json.portals)) return null;
  return json.portals.filter(isRec).slice(0, 12).flatMap((p) => (p.how === "account_manager" && s(p.id, 40) && s(p.name, 60) && s(p.ask_text, 2000) ? [{ id: s(p.id, 40) as string, name: s(p.name, 60) as string, askText: s(p.ask_text, 2000) as string }] : []));
}
export function parseWebsite(json: unknown): WebsiteSnippet | null {
  return isRec(json) && s(json.snippet, 4000) ? { snippet: s(json.snippet, 4000) as string, formLink: s(json.form_link, 500), webhookUrl: s(json.webhook_url, 500) } : null;
}
export function parseTest(json: unknown): TestResult | null {
  if (!isRec(json) || json.ok === false || !(TEST_RESULTS as readonly unknown[]).includes(json.result)) return null; // the IndiaMART check answers {result, checked_at} without `ok`
  return { result: json.result as TestResult["result"], message: s(json.message, 200) ?? "", leadId: isRec(json.lead) && typeof json.lead.lead_id === "string" ? json.lead.lead_id.slice(0, 64) : null, portal: s(json.portal, 60) };
}

/** `GET /outreach/source-costs`: the owner's cost per lead by lead tag, as a list of {source, cost_per_lead_paise} (bare or under `costs` / `items`). Anything unreadable is left out, never guessed. */
export function parseCosts(json: unknown): Record<string, number> {
  const rows = Array.isArray(json) ? json : isRec(json) && Array.isArray(json.costs) ? json.costs : isRec(json) && Array.isArray(json.items) ? json.items : [];
  const out: Record<string, number> = {};
  for (const r of rows.slice(0, 50)) if (isRec(r) && typeof r.source === "string" && /^[a-z0-9_]{1,40}$/.test(r.source) && typeof r.cost_per_lead_paise === "number" && r.cost_per_lead_paise >= 0) out[r.source] = Math.trunc(r.cost_per_lead_paise);
  return out;
}

export function parseConnect(json: unknown): ConnectInfo | null {
  if (!isRec(json) || !isRec(json.connect) || json.connect.type !== "copy" || !Array.isArray(json.connect.fields)) return null;
  const fields = json.connect.fields.filter(isRec).slice(0, 4).flatMap((f) => (s(f.label, 120) && s(f.value, 500) ? [{ label: s(f.label, 120) as string, value: s(f.value, 500) as string }] : []));
  const steps = Array.isArray(json.connect.steps) ? json.connect.steps.filter((x): x is string => typeof x === "string").slice(0, 6).map((x) => x.slice(0, 300)) : [];
  return fields.length > 0 ? { fields, steps } : null;
}
