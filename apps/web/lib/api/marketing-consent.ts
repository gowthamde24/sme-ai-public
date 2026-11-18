import type { ConsentCountsOut, ConsentItemOut, ConsentListOut, ConsentOut } from "@contracts";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { int, oneOf, optIso, optStr, readRows, rec, uuid, word, bool, nstr } from "./shape";

/**
 * Marketing consent (campaigns S3, C1's docs/contracts/campaign-offers.md, 17 Nov): who said yes to offers. Server side only, with the signed-in user's own token. "Not asked" (`unknown`) means no offers, always. Owner, Admin and
 * Sales read the list and record a yes (with a short note: how it was given) or a no; the API refuses a yes for a customer who said STOP. Service messages are never touched. The list shows names, never numbers.
 */
export const STATES = ["unknown", "granted", "withdrawn"] as const;
export type MarketingState = (typeof STATES)[number];
export const NOTE_MIN = 2;
export const NOTE_MAX = 160;

const optWord = (v: unknown, what: string): string | null => (v === null || v === undefined ? null : word(v, what));

export function parseCounts(json: unknown): ConsentCountsOut {
  const r = rec(json, "marketing consent counts");
  return { granted: int(r.granted, "granted"), unknown: int(r.unknown, "unknown"), withdrawn: int(r.withdrawn, "withdrawn") };
}

export function parseItem(json: unknown): ConsentItemOut {
  const r = rec(json, "marketing consent row");
  return {
    contact_id: uuid(r.contact_id, "contact_id"),
    name: r.name === null || r.name === undefined ? null : nstr(r.name, "name", 200),
    phone: null, // the number is never read: the list is by name
    state: oneOf(r.state, STATES, "state"),
    at: optIso(r.at, "at"),
    via: optWord(r.via, "via"),
    by: optStr(r.by, "by", 200),
    note: optStr(r.note, "note", 400),
    stopped: bool(r.stopped, "stopped"),
  };
}

export function parseList(json: unknown): ConsentListOut {
  const r = rec(json, "marketing consent list");
  return { items: readRows(r.items, "marketing consent", parseItem, 100), counts: parseCounts(r.counts), next_cursor: optStr(r.next_cursor, "next_cursor", 400) };
}

export function parseOne(json: unknown): ConsentOut {
  const r = rec(json, "marketing consent");
  return { state: oneOf(r.state, STATES, "state"), at: optIso(r.at, "at"), via: optWord(r.via, "via"), by: optStr(r.by, "by", 200), note: optStr(r.note, "note", 400) };
}

const url = (tenantId: string, tail: string) => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/${tail}`;
};
const idOf = (id: string) => {
  if (!isCanonicalUuid(id)) throw new ApiContractError("id");
  return id;
};

/** The note as the API wants it: tidied, 2 to 160 characters (the API checks it again). */
export function tidyNote(raw: string): string | null {
  const n = raw.replace(/\s+/g, " ").trim();
  return n.length >= NOTE_MIN && n.length <= NOTE_MAX ? n : null;
}

export async function listMarketingConsent(accessToken: string, tenantId: string, opts: { q?: string; state?: MarketingState; after?: string | null; limit?: number } = {}): Promise<ConsentListOut> {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  const search = (opts.q ?? "").trim().slice(0, 60);
  if (search) q.set("q", search);
  if (opts.state) q.set("state", opts.state);
  if (opts.after) q.set("after", opts.after);
  return parseList(await apiRequest(url(tenantId, `marketing-consent?${q.toString()}`), accessToken));
}

export async function getMarketingConsent(accessToken: string, tenantId: string, contactId: string): Promise<ConsentOut> {
  return parseOne(await apiRequest(url(tenantId, `contacts/${idOf(contactId)}/marketing-consent`), accessToken));
}

/** Records that the customer said yes to offers. `note` says how (2 to 160 characters). A customer who said STOP is refused by the API. */
export async function recordMarketingYes(accessToken: string, tenantId: string, contactId: string, note: string): Promise<ConsentOut> {
  const tidy = tidyNote(note);
  if (tidy === null) throw new ApiContractError("note");
  return parseOne(await apiRequest(url(tenantId, `contacts/${idOf(contactId)}/marketing-consent`), accessToken, { method: "PUT", body: JSON.stringify({ note: tidy }) }));
}

/** Records that the customer no longer wants offers (always allowed). The note is optional. */
export async function withdrawMarketing(accessToken: string, tenantId: string, contactId: string, note?: string): Promise<ConsentOut> {
  const tidy = note === undefined ? null : tidyNote(note);
  return parseOne(await apiRequest(url(tenantId, `contacts/${idOf(contactId)}/marketing-consent/withdraw`), accessToken, { method: "POST", body: JSON.stringify(tidy === null ? {} : { note: tidy }) }));
}

/** Who recorded it, for a person to read: the API's `by` is the member's id when it has no name, and an id is never shown (owner review, 18 Nov). */
export function personName(by: string | null): string | null {
  return by && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(by.trim()) ? by : null;
}
