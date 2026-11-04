import { CATEGORY_HINTS, COUNT_KEYS, PROVIDERS, SEARCH_STATES, type LeadFinderCard, type Search, type SearchCounts } from "@/lib/lead-finder/types";

import { bool, int, iso, oneOf, optInt, optIso, optStr, rec, str, uuid, word } from "./shape";

/**
 * The reader of a Lead Finder search (`SearchOut`, docs/contracts/lead-finder.md sections 1 and 2) and of the chat's card around it (section 1b). Kept apart from lib/api/lead-finder.ts (the routes) because the browser reads the
 * spoken chat's card itself (the voice socket's `lead_finder` message, lib/browser-voice/protocol.ts): ONE reader for the plan card, the result card and the chat's card, without the routes in the browser's bundle.
 */
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

/** `{search: SearchOut, can_approve}` (the turn's event carries `type: "lead_finder"` beside them; a history message carries the two alone). */
export function parseChatCard(json: unknown): LeadFinderCard {
  const x = rec(json, "lead_finder");
  return { search: parseSearch(x.search), canApprove: bool(x.can_approve, "can_approve") };
}

/** The same, for a reader that must not fail because of the card (the answer's words stand without it): null when it is not the contract's shape. A card that cannot be read is never drawn. */
export function readChatCard(json: unknown): LeadFinderCard | null {
  try {
    return parseChatCard(json);
  } catch {
    return null;
  }
}
