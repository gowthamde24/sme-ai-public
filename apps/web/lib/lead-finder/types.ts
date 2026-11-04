/**
 * The Lead Finder's shapes and closed words (job lead-finder part D; the API contract is docs/contracts/lead-finder.md, ADR 0119). Pure: no request, no server code, so the browser parts (the plan card, the list, the practice
 * call, the settings form) can use the constants and the checks too. The reader of the API's answers is lib/api/lead-finder.ts.
 */
export const PROSPECT_STATUSES = ["new", "researching", "call_ready", "needs_owner", "skipped", "contacted", "qualified", "not_interested"] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];
/** The order of the filter on the Prospects tab: what waits for a person first. */
export const STATUS_FILTER: readonly ProspectStatus[] = ["needs_owner", "call_ready", "researching", "contacted", "qualified", "skipped", "not_interested", "new"];

/** The closed words of the one-line why (contract section 3). */
export const DECISION_REASONS = ["fit_high", "fit_middle", "fit_low", "first_calls", "low_stock", "no_stock_match", "very_large", "competitor", "not_a_buyer", "suppressed", "contacted_recently", "outside_hours", "daily_cap", "owner_approved", "owner_skipped", "asked_later", "no_phone"] as const;
export type DecisionReason = (typeof DECISION_REASONS)[number];

export const SEARCH_STATES = ["planned", "approved", "done", "failed", "cancelled"] as const;
export type SearchState = (typeof SEARCH_STATES)[number];
export const CATEGORY_HINTS = ["retailer", "boutique", "contractor", "builder", "dealer", "other"] as const;
export const PROVIDERS = ["fixture", "places"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const ACTIONS = ["call", "later", "skip", "not_interested", "do_not_call"] as const;
export type ProspectAction = (typeof ACTIONS)[number];
/** The two that suppress a business for good in this workspace: behind a confirm. */
export const FOR_GOOD: readonly ProspectAction[] = ["not_interested", "do_not_call"];
export const MAX_BULK = 50;

export const PERSONAS = ["interested", "price_shopper", "busy_call_later", "not_interested", "wants_whatsapp", "rude_hangs_up"] as const;
export type Persona = (typeof PERSONAS)[number];
export const CALL_LANGUAGES = ["en", "te"] as const;
export type CallLanguage = (typeof CALL_LANGUAGES)[number];
export const OUTCOMES = ["qualified", "contacted", "not_interested", "do_not_call"] as const;
export type CallOutcome = (typeof OUTCOMES)[number];
export const END_REASONS = ["goodbye", "caller_hung_up", "we_hung_up", "stopped"] as const;
export const CAPTURED = ["sells", "price", "quantity", "supplier", "timing", "decision"] as const;
export type CapturedKey = (typeof CAPTURED)[number];

export type Availability = { available: boolean; source: Provider | null; /** `not_for_your_role`: a Viewer (#298); hidden like any other `available: false`. */ reason: "ok" | "not_for_this_business" | "switched_off" | "not_for_your_role" };

/** The keys of a done search's counts (contract section 2); an absent key is 0. */
export const COUNT_KEYS = ["found", "new", "duplicates", "call_ready", "needs_owner", "skipped", "researching", "duplicate_customer", "duplicate_company", "duplicate_prospect", "duplicate_suppressed"] as const;
export type SearchCounts = Record<(typeof COUNT_KEYS)[number], number>;

export type Search = {
  id: string;
  state: SearchState;
  query: string;
  area: string | null;
  categoryHint: (typeof CATEGORY_HINTS)[number] | null;
  maxResults: number;
  provider: Provider;
  sku: string;
  estCostPaise: number;
  costPaise: number;
  costIsEstimate: boolean;
  sourceLabel: string;
  found: number;
  counts: SearchCounts | null;
  searchesLeftToday: number | null;
  /** Set ("Google Maps") when the results come from Google: the screen shows "Google Maps" next to them. */
  attribution: string | null;
  createdAt: string;
  approvedAt: string | null;
  finishedAt: string | null;
};

export type StockMatch = { matched: string[]; low: string[]; enough: boolean };
export type QuoteLine = { item: string; unit: string; pricePaise: number | null; moq: number | null; quantitySaid: string };
export type Qualification = { summary: string; captured: Partial<Record<CapturedKey, string>>; language: string; whatsappOk: boolean; callback: boolean; pitched: string[]; quoteSuggestion: QuoteLine[]; simulated: true };

export type Prospect = {
  id: string;
  searchId: string | null;
  name: string;
  category: string | null;
  area: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  source: "google_maps" | "fixture";
  sourceLabel: string;
  attribution: string | null;
  status: ProspectStatus;
  decisionReason: DecisionReason | null;
  fitScore: number | null;
  fitReason: string | null;
  stockMatch: StockMatch | null;
  ownerApproved: boolean;
  suppressed: boolean;
  askAfter: string | null;
  lastContactedAt: string | null;
  leadId: string | null;
  qualification: Qualification | null;
  createdAt: string;
  updatedAt: string;
};
export type ProspectPage = { items: Prospect[]; nextCursor: string | null };
export type ProspectStats = { total: number; byStatus: Partial<Record<ProspectStatus, number>> };
export type ActionResult = { id: string; ok: boolean; status: ProspectStatus | null; error: "prospect_state" | "not_found" | null };

export type Turn = { who: "assistant" | "business"; text: string; t: number };
export type PracticeCall = {
  simulated: true;
  callId: string;
  prospect: Prospect;
  persona: Persona;
  language: CallLanguage;
  outcome: CallOutcome;
  endReason: (typeof END_REASONS)[number];
  summary: string;
  whatsappOk: boolean;
  pitched: string[];
  quoteSuggestion: QuoteLine[];
  transcript: Turn[];
  evals: Record<string, boolean>;
};

/** Settings -> Lead Finder (contract section 6) and the ranges the API takes. */
export type FinderSettings = { fitBar: number; dailyCallCap: number; callFromHour: number; callToHour: number; searchesPerDay: number; resultsPerSearch: number; updatedAt: string | null };
export type SettingsField = Exclude<keyof FinderSettings, "updatedAt">;
export const SETTINGS_FIELDS: readonly SettingsField[] = ["fitBar", "dailyCallCap", "callFromHour", "callToHour", "searchesPerDay", "resultsPerSearch"];
export const RANGES: Record<SettingsField, readonly [number, number]> = { fitBar: [50, 100], dailyCallCap: [0, 500], callFromHour: [9, 20], callToHour: [10, 21], searchesPerDay: [1, 20], resultsPerSearch: [1, 20] };
export const WIRE: Record<SettingsField, string> = { fitBar: "fit_bar", dailyCallCap: "daily_call_cap", callFromHour: "call_from_hour", callToHour: "call_to_hour", searchesPerDay: "searches_per_day", resultsPerSearch: "results_per_search" };

export type SettingsProblem = { field: SettingsField; kind: "range" | "hours" };
/**
 * The changes a settings form would send: only the fields that differ from what is stored (PUT takes a subset), each a whole number in its range, and the calling hours starting before they end (the stored hours count for the one
 * that is not changed). A problem names the field, so the form can say which one.
 */
export function settingsChanges(stored: FinderSettings, typed: Partial<Record<SettingsField, string | number>>): { ok: true; changes: Partial<Record<SettingsField, number>> } | { ok: false; problem: SettingsProblem } {
  const changes: Partial<Record<SettingsField, number>> = {};
  for (const f of SETTINGS_FIELDS) {
    const raw = typed[f];
    if (raw === undefined) continue;
    const text = String(raw).trim();
    const n = /^\d{1,4}$/.test(text) ? Number(text) : NaN;
    const [lo, hi] = RANGES[f];
    if (!Number.isSafeInteger(n) || n < lo || n > hi) return { ok: false, problem: { field: f, kind: "range" } };
    if (n !== stored[f]) changes[f] = n;
  }
  const from = changes.callFromHour ?? stored.callFromHour;
  const to = changes.callToHour ?? stored.callToHour;
  if (from >= to) return { ok: false, problem: { field: changes.callFromHour !== undefined ? "callFromHour" : "callToHour", kind: "hours" } };
  return { ok: true, changes };
}

/** The key of the words of a decision reason (`lf.reason.<word>`), or null when the API gave none. */
export const reasonKey = (r: DecisionReason | null): string | null => (r ? `lf.reason.${r}` : null);

/** The one line of why: "fit 82 · 1 of the first 10 calls — needs your OK" (the fit and the decision in words). The Prospects list and Today's Needs-you rows draw it. */
export function reasonLine(p: { fitScore: number | null; decisionReason: DecisionReason | null }, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const key = reasonKey(p.decisionReason);
  return [p.fitScore !== null ? t("lf.fit", { n: p.fitScore }) : null, key ? t(key) : null].filter(Boolean).join(" · ");
}

/** "Found {new} · {call_ready} call-ready · {needs_owner} need you · {skipped} skipped": the numbers of a done search (an absent key is 0). */
export const resultNumbers = (s: Pick<Search, "counts">): { new: number; call_ready: number; needs_owner: number; skipped: number } => ({ new: s.counts?.new ?? 0, call_ready: s.counts?.call_ready ?? 0, needs_owner: s.counts?.needs_owner ?? 0, skipped: s.counts?.skipped ?? 0 });

/** Rupees from paise for a plan card ("₹0", "₹12.50"): never more than two decimals. */
export function rupees(paise: number): string {
  const r = paise / 100;
  return `₹${Number.isInteger(r) ? r.toLocaleString("en-IN") : r.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The owner's words for a search, as the box takes them: 2 to 300 characters after trimming (the API's limit). */
export const searchTextProblem = (text: string): "empty" | "too_long" | null => (text.trim().length < 2 ? "empty" : text.trim().length > 300 ? "too_long" : null);

/**
 * The helpers' status may still call the Lead Finder "not built" (`not_available`) where its own API says it is available: there it is a member of the team (idle until it works).
 * Anywhere else nothing changes (a school, a switched-off one, one that cannot be told: the Lead Finder stays unnamed).
 */
export function withFinder<A extends { agent: string; state: string }>(team: readonly A[] | null, available: boolean): A[] | null {
  if (team === null) return null;
  if (!available) return [...team];
  return team.map((a) => (a.agent === "lead_finder" && a.state === "not_available" ? { ...a, state: "idle" } : a));
}
