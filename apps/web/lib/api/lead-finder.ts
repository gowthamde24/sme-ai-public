import {
  ACTIONS,
  CALL_LANGUAGES,
  CAPTURED,
  CATEGORY_HINTS,
  COUNT_KEYS,
  DECISION_REASONS,
  END_REASONS,
  OUTCOMES,
  PERSONAS,
  PROSPECT_STATUSES,
  PROVIDERS,
  SEARCH_STATES,
  SETTINGS_FIELDS,
  WIRE,
  MAX_BULK,
  type ActionResult,
  type Availability,
  type CallLanguage,
  type FinderSettings,
  type Persona,
  type PracticeCall,
  type Prospect,
  type ProspectAction,
  type ProspectPage,
  type ProspectStats,
  type ProspectStatus,
  type Qualification,
  type QuoteLine,
  type Search,
  type SearchCounts,
  type SettingsField,
  type StockMatch,
} from "@/lib/lead-finder/types";

import { ApiAuthError, ApiContractError, ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, int, iso, list, nstr, oneOf, optInt, optIso, optStr, rec, str, uuid, word } from "./shape";

/**
 * The Lead Finder (job lead-finder part D; the contract is docs/contracts/lead-finder.md, ADR 0119): find new businesses (made-up ones in a demo, Google Maps in the Owner Test workspace only), the Researcher's decision per
 * business, the bulk buttons, and the qualifying call IN THE SIMULATOR (nothing is ever dialled). Every route is under /v1/tenants/{id}. SERVER ONLY, with the signed-in person's own token. Every answer is read with the checks
 * of lib/api/shape.ts: closed words, bounded numbers and strings; what is not the contract's shape is an ApiContractError, never drawn. A business type without the Lead Finder (a school) answers 403
 * `lead_finder_not_available`: `readAvailability` turns that into "not available", never an error screen.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("Unexpected workspace id.");
  return `/v1/tenants/${tenantId}`;
};
const id = (v: string, what: string): string => (isCanonicalUuid(v) ? v : bad(what));
const optUuid = (v: unknown, what: string): string | null => (v === null || v === undefined ? null : uuid(v, what));
const strings = (v: unknown, what: string, max = 20, each = 200): string[] => list(v ?? [], what, max).map((x) => str(x, what, each));
const optNum = (v: unknown, what: string, min: number, max: number): number | null => (v === null || v === undefined ? null : typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : bad(what));

/** Is this the refusal of a business type without the Lead Finder (a school)? */
export const notAvailable = (e: unknown): boolean => e instanceof ApiRequestError && e.status === 403 && e.code === "lead_finder_not_available";

// ---------------------------------------------------------------------------------------------------------------- 0. availability
export function parseAvailability(json: unknown): Availability {
  const x = rec(json, "availability");
  const available = bool(x.available, "available");
  return { available, source: x.source === null || x.source === undefined ? null : oneOf(x.source, PROVIDERS, "source"), reason: oneOf(x.reason, ["ok", "not_for_this_business", "switched_off"] as const, "reason") };
}
export async function getAvailability(token: string, tenantId: string): Promise<Availability> {
  return parseAvailability(await apiRequest(`${base(tenantId)}/lead-finder/availability`, token));
}
/**
 * Availability for a screen that only has to know whether to SHOW the Lead Finder: `null` when it cannot be told (a Viewer, whom the route refuses; an API without the route; a failure), which every caller treats as "hidden".
 * A school's 403 is "not available". Only a rejected session is thrown (the page sends the person to sign in).
 */
export async function readAvailability(token: string, tenantId: string): Promise<Availability | null> {
  try {
    return await getAvailability(token, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    if (notAvailable(error)) return { available: false, source: null, reason: "not_for_this_business" };
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------- 1-2. searches
function parseCounts(v: unknown): SearchCounts | null {
  if (v === null || v === undefined) return null;
  const r = rec(v, "counts");
  const out = {} as SearchCounts;
  for (const k of COUNT_KEYS) out[k] = r[k] === undefined || r[k] === null ? 0 : int(r[k], `counts.${k}`, 0, 100_000);
  return out;
}
export function parseSearch(json: unknown): Search {
  const x = rec(json, "search");
  return {
    id: uuid(x.id, "id"),
    state: oneOf(x.state, SEARCH_STATES, "state"),
    query: str(x.query, "query", 300),
    area: optStr(x.area, "area", 300),
    categoryHint: x.category_hint === null || x.category_hint === undefined ? null : oneOf(x.category_hint, CATEGORY_HINTS, "category_hint"),
    maxResults: int(x.max_results, "max_results", 1, 20),
    provider: oneOf(x.provider, PROVIDERS, "provider"),
    sku: word(x.sku, "sku", 80),
    estCostPaise: int(x.est_cost_paise, "est_cost_paise", 0, 100_000_000),
    costPaise: int(x.cost_paise, "cost_paise", 0, 100_000_000),
    costIsEstimate: x.cost_is_estimate === undefined ? true : bool(x.cost_is_estimate, "cost_is_estimate"),
    sourceLabel: str(x.source_label, "source_label", 300),
    found: int(x.found, "found", 0, 100_000),
    counts: parseCounts(x.counts),
    searchesLeftToday: optInt(x.searches_left_today, "searches_left_today", 0, 1000),
    attribution: optStr(x.attribution, "attribution", 60),
    createdAt: iso(x.created_at, "created_at"),
    approvedAt: optIso(x.approved_at, "approved_at"),
    finishedAt: optIso(x.finished_at, "finished_at"),
  };
}

export type PlanInput = { text: string; language: string } | { query: string; area: string; maxResults?: number };
const PLAN_LANGS = ["en", "te", "hi", "kn", "ta", "ml"] as const;
/** `POST /lead-finder/plan`: the owner's words (or the search itself) -> the PLAN CARD. Nothing is searched yet. 422 `not_a_search`, 409 `lead_finder_off`. */
export async function planSearch(token: string, tenantId: string, input: PlanInput): Promise<Search> {
  let body: Record<string, unknown>;
  if ("text" in input) {
    const text = input.text.trim();
    if (text.length < 2 || text.length > 300) bad("search words");
    body = { text, language: (PLAN_LANGS as readonly string[]).includes(input.language) ? input.language : "en" };
  } else {
    const query = input.query.trim();
    const area = input.area.trim();
    if (query.length < 2 || query.length > 120 || area.length < 2 || area.length > 120) bad("search");
    body = { query, area, ...(input.maxResults !== undefined ? { max_results: Math.min(20, Math.max(1, Math.trunc(input.maxResults))) } : {}) };
  }
  return parseSearch(await apiRequest(`${base(tenantId)}/lead-finder/plan`, token, { method: "POST", body: JSON.stringify(body) }));
}
/** The OK (Owner, Admin): the search runs there and then; the answer is the RESULT CARD (`done` or `failed`). The same OK again gives the same result. */
export async function approveSearch(token: string, tenantId: string, searchId: string): Promise<Search> {
  return parseSearch(await apiRequest(`${base(tenantId)}/lead-finder/searches/${id(searchId, "search id")}/approve`, token, { method: "POST", body: "{}" }));
}
export async function cancelSearch(token: string, tenantId: string, searchId: string): Promise<Search> {
  return parseSearch(await apiRequest(`${base(tenantId)}/lead-finder/searches/${id(searchId, "search id")}/cancel`, token, { method: "POST", body: "{}" }));
}
export async function listSearches(token: string, tenantId: string, limit = 20): Promise<Search[]> {
  const x = rec(await apiRequest(`${base(tenantId)}/lead-finder/searches?${new URLSearchParams({ limit: String(Math.min(100, Math.max(1, Math.trunc(limit)))) })}`, token), "searches");
  return list(x.items, "items", 100).map(parseSearch);
}
export async function getSearch(token: string, tenantId: string, searchId: string): Promise<Search> {
  return parseSearch(await apiRequest(`${base(tenantId)}/lead-finder/searches/${id(searchId, "search id")}`, token));
}

// ---------------------------------------------------------------------------------------------------------------- 3. prospects
function parseStock(v: unknown): StockMatch | null {
  if (v === null || v === undefined) return null;
  const r = rec(v, "stock_match");
  return { matched: strings(r.matched, "stock_match.matched", 10, 120), low: strings(r.low, "stock_match.low", 10, 120), enough: r.enough === undefined ? false : bool(r.enough, "stock_match.enough") };
}
function parseQuoteLine(v: unknown): QuoteLine {
  const r = rec(v, "quote_suggestion");
  return { item: nstr(r.item, "item", 120), unit: str(r.unit ?? "", "unit", 40), pricePaise: optInt(r.price_paise, "price_paise", 0, 10_000_000_000), moq: optInt(r.moq, "moq", 0, 1_000_000), quantitySaid: str(r.quantity_said ?? "", "quantity_said", 200) };
}
function parseQualification(v: unknown): Qualification | null {
  if (v === null || v === undefined) return null;
  const r = rec(v, "qualification");
  const captured: Qualification["captured"] = {};
  if (r.captured !== undefined && r.captured !== null) {
    const c = rec(r.captured, "captured");
    for (const k of CAPTURED) if (typeof c[k] === "string") captured[k] = str(c[k], `captured.${k}`, 200);
  }
  if (r.simulated !== undefined && r.simulated !== true) bad("simulated");
  return {
    summary: str(r.summary ?? "", "summary", 1000),
    captured,
    language: word(r.language ?? "en", "language", 8),
    whatsappOk: r.whatsapp_ok === undefined ? false : bool(r.whatsapp_ok, "whatsapp_ok"),
    callback: r.callback === undefined || r.callback === null ? false : bool(r.callback, "callback"),
    pitched: strings(r.pitched, "pitched", 20, 120),
    quoteSuggestion: list(r.quote_suggestion ?? [], "quote_suggestion", 20).map(parseQuoteLine),
    simulated: true,
  };
}
export function parseProspect(json: unknown): Prospect {
  const x = rec(json, "prospect");
  return {
    id: uuid(x.id, "id"),
    searchId: optUuid(x.search_id, "search_id"),
    name: nstr(x.name, "name", 200),
    category: optStr(x.category, "category", 120),
    area: optStr(x.area, "area", 200),
    phone: optStr(x.phone, "phone", 40),
    website: optStr(x.website, "website", 500),
    rating: optNum(x.rating, "rating", 0, 5),
    reviewCount: optInt(x.review_count, "review_count", 0, 100_000_000),
    source: oneOf(x.source, ["google_maps", "fixture"] as const, "source"),
    sourceLabel: str(x.source_label, "source_label", 300),
    attribution: optStr(x.attribution, "attribution", 60),
    status: oneOf(x.status, PROSPECT_STATUSES, "status"),
    decisionReason: x.decision_reason === null || x.decision_reason === undefined ? null : oneOf(x.decision_reason, DECISION_REASONS, "decision_reason"),
    fitScore: optInt(x.fit_score, "fit_score", 0, 100),
    fitReason: optStr(x.fit_reason, "fit_reason", 500),
    stockMatch: parseStock(x.stock_match),
    ownerApproved: bool(x.owner_approved, "owner_approved"),
    suppressed: bool(x.suppressed, "suppressed"),
    askAfter: optIso(x.ask_after, "ask_after"),
    lastContactedAt: optIso(x.last_contacted_at, "last_contacted_at"),
    leadId: optUuid(x.lead_id, "lead_id"),
    qualification: parseQualification(x.qualification),
    createdAt: iso(x.created_at, "created_at"),
    updatedAt: iso(x.updated_at, "updated_at"),
  };
}
export function parseProspectPage(json: unknown): ProspectPage {
  const x = rec(json, "prospects");
  return { items: list(x.items, "items", 200).map(parseProspect), nextCursor: x.next_cursor === null || x.next_cursor === undefined ? null : str(x.next_cursor, "next_cursor", 300) };
}
/** `GET /prospects`: best fit first; `status` narrows it; `cursor` is the last page's `next_cursor`. */
export async function listProspects(token: string, tenantId: string, q: { status?: ProspectStatus | null; searchId?: string | null; limit?: number; cursor?: string | null } = {}): Promise<ProspectPage> {
  const p = new URLSearchParams({ limit: String(Math.min(200, Math.max(1, Math.trunc(q.limit ?? 50)))) });
  if (q.status) p.set("status", oneOf(q.status, PROSPECT_STATUSES, "status filter"));
  if (q.searchId) p.set("search_id", id(q.searchId, "search id"));
  if (q.cursor) p.set("cursor", q.cursor.slice(0, 80));
  return parseProspectPage(await apiRequest(`${base(tenantId)}/prospects?${p}`, token));
}
export async function getProspect(token: string, tenantId: string, prospectId: string): Promise<Prospect> {
  return parseProspect(await apiRequest(`${base(tenantId)}/prospects/${id(prospectId, "prospect id")}`, token));
}
export function parseStats(json: unknown): ProspectStats {
  const x = rec(json, "stats");
  const by = rec(x.by_status ?? {}, "by_status");
  const byStatus: ProspectStats["byStatus"] = {};
  for (const s of PROSPECT_STATUSES) if (by[s] !== undefined) byStatus[s] = int(by[s], `by_status.${s}`, 0, 10_000_000);
  return { total: int(x.total, "total", 0, 10_000_000), byStatus };
}
export async function getProspectStats(token: string, tenantId: string, searchId?: string | null): Promise<ProspectStats> {
  const q = searchId ? `?${new URLSearchParams({ search_id: id(searchId, "search id") })}` : "";
  return parseStats(await apiRequest(`${base(tenantId)}/prospects/stats${q}`, token));
}

// ---------------------------------------------------------------------------------------------------------------- 4. bulk buttons
export function parseActionResults(json: unknown): ActionResult[] {
  const x = rec(json, "results");
  return list(x.results, "results", MAX_BULK).map((v) => {
    const r = rec(v, "result");
    return { id: uuid(r.id, "id"), ok: bool(r.ok, "ok"), status: r.status === null || r.status === undefined ? null : oneOf(r.status, PROSPECT_STATUSES, "status"), error: r.error === null || r.error === undefined ? null : oneOf(r.error, ["prospect_state", "not_found"] as const, "error") };
  });
}
/** `POST /prospects/actions`: one action for 1 to 50 businesses; the answer is one result per id (a suppressed one answers `prospect_state` to anything). */
export async function actOnProspects(token: string, tenantId: string, ids: readonly string[], action: ProspectAction): Promise<ActionResult[]> {
  if (ids.length < 1 || ids.length > MAX_BULK || !ids.every(isCanonicalUuid) || new Set(ids).size !== ids.length) bad("prospect ids");
  return parseActionResults(await apiRequest(`${base(tenantId)}/prospects/actions`, token, { method: "POST", body: JSON.stringify({ ids, action: oneOf(action, ACTIONS, "action") }) }));
}
/** `POST /prospects/redecide`: decide again the ones that waited for the calling hours or the day's cap (the screen calls it when it opens). */
export async function redecideProspects(token: string, tenantId: string): Promise<number> {
  return int(rec(await apiRequest(`${base(tenantId)}/prospects/redecide`, token, { method: "POST", body: "{}" }), "redecide").changed, "changed", 0, 1_000_000);
}

// ---------------------------------------------------------------------------------------------------------------- 5. the practice call (SIMULATED)
export function parsePracticeCall(json: unknown): PracticeCall {
  const x = rec(json, "simulated call");
  if (x.simulated !== true) bad("simulated");
  const evals: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(rec(x.evals ?? {}, "evals")).slice(0, 30)) evals[word(k, "eval")] = bool(v, "eval");
  return {
    simulated: true,
    callId: uuid(x.call_id, "call_id"),
    prospect: parseProspect(x.prospect),
    persona: oneOf(x.persona, PERSONAS, "persona"),
    language: oneOf(x.language, CALL_LANGUAGES, "language"),
    outcome: oneOf(x.outcome, OUTCOMES, "outcome"),
    endReason: oneOf(x.end_reason, END_REASONS, "end_reason"),
    summary: str(x.summary, "summary", 1000),
    whatsappOk: bool(x.whatsapp_ok, "whatsapp_ok"),
    pitched: strings(x.pitched, "pitched", 20, 120),
    quoteSuggestion: list(x.quote_suggestion ?? [], "quote_suggestion", 20).map(parseQuoteLine),
    transcript: list(x.transcript, "transcript", 200).map((v) => {
      const t = rec(v, "turn");
      return { who: oneOf(t.who, ["assistant", "business"] as const, "who"), text: str(t.text, "text", 1000), t: typeof t.t === "number" && Number.isFinite(t.t) && t.t >= 0 && t.t <= 3600 ? t.t : bad("t") };
    }),
    evals,
  };
}
/** `POST /prospects/{id}/simulated-call` (Owner, Admin; a `call_ready` business only): our assistant against a made-up retailer. Nothing is dialled. */
export async function practiceCall(token: string, tenantId: string, prospectId: string, persona: Persona, language: CallLanguage): Promise<PracticeCall> {
  const body = { persona: oneOf(persona, PERSONAS, "persona"), language: oneOf(language, CALL_LANGUAGES, "language") };
  return parsePracticeCall(await apiRequest(`${base(tenantId)}/prospects/${id(prospectId, "prospect id")}/simulated-call`, token, { method: "POST", body: JSON.stringify(body) }));
}

// ---------------------------------------------------------------------------------------------------------------- 6. settings
export function parseSettings(json: unknown): FinderSettings {
  const x = rec(json, "settings");
  return {
    fitBar: int(x.fit_bar, "fit_bar", 50, 100),
    dailyCallCap: int(x.daily_call_cap, "daily_call_cap", 0, 500),
    callFromHour: int(x.call_from_hour, "call_from_hour", 0, 23),
    callToHour: int(x.call_to_hour, "call_to_hour", 0, 24),
    searchesPerDay: int(x.searches_per_day, "searches_per_day", 1, 20),
    resultsPerSearch: int(x.results_per_search, "results_per_search", 1, 20),
    updatedAt: optIso(x.updated_at, "updated_at"),
  };
}
export async function getFinderSettings(token: string, tenantId: string): Promise<FinderSettings> {
  return parseSettings(await apiRequest(`${base(tenantId)}/lead-finder/settings`, token));
}
/** `PUT /lead-finder/settings` (Owner, Admin): any subset; out of range is the API's 422. */
export async function saveFinderSettings(token: string, tenantId: string, changes: Partial<Record<SettingsField, number>>): Promise<FinderSettings> {
  const body: Record<string, number> = {};
  for (const f of SETTINGS_FIELDS) if (changes[f] !== undefined) body[WIRE[f]] = int(changes[f], f, 0, 500);
  if (Object.keys(body).length === 0) bad("settings change");
  return parseSettings(await apiRequest(`${base(tenantId)}/lead-finder/settings`, token, { method: "PUT", body: JSON.stringify(body) }));
}

