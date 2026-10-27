import { SOURCE_TAGS } from "@/lib/lead-desk/imports/types";
import { SOURCE_KINDS, type LiveSource, type PullResult, type Secret, type SourceCreateBody, type SourceWithSecret, type Unparsed } from "@/lib/lead-desk/sources/types";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bool, int, iso, list, oneOf, optInt, optIso, optStr, rec, str, uuid } from "./shape";

/**
 * The live lead sources from C1's API (night 4; contract-lead-sources.md, section 2): `GET|POST lead-sources`, `.../{id}/rotate|pause|resume`, `POST lead-sources/indiamart/pull`, `GET lead-sources/unparsed` and
 * `POST .../unparsed/{id}/discard`. The SECRET (the address, the e-mail address, the form snippet, Meta's callback and verify token) is in the answer of a create and of a rotate only: it is parsed here into the value
 * that action returns and NOWHERE else. Nothing here logs a body, and a failed parse names the field, never the value. SERVER ONLY, the person's own token.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/lead-sources`;
};
const idPath = (tenantId: string, id: string): string => {
  if (!isCanonicalUuid(id)) throw new ApiContractError("id");
  return `${base(tenantId)}/${id}`;
};
const post = (path: string, token: string, body: unknown = {}): Promise<unknown> => apiRequest(path, token, { method: "POST", body: JSON.stringify(body) });

export function parseSource(json: unknown): LiveSource {
  const r = rec(json, "lead source");
  return {
    id: uuid(r.id, "source id"),
    kind: oneOf(r.kind, SOURCE_KINDS, "source kind"),
    tag: oneOf(r.tag, SOURCE_TAGS, "source tag"),
    label: str(r.label, "source label", 200),
    status: oneOf(r.status, ["active", "paused"] as const, "source status"),
    created_at: iso(r.created_at, "created_at"),
    last_received_at: optIso(r.last_received_at, "last_received_at"),
    received_count: int(r.received_count, "received_count"),
    token_hint: optStr(r.token_hint, "token_hint", 40),
    cost_per_lead_paise: optInt(r.cost_per_lead_paise, "cost_per_lead_paise"),
    consent_confirmed: bool(r.consent_confirmed, "consent_confirmed"),
    available: bool(r.available, "available"),
  };
}
export function parseSources(json: unknown): LiveSource[] {
  return list(rec(json, "lead sources").items, "lead sources", 200).map(parseSource);
}

export function parseSecret(json: unknown): Secret | null {
  if (json === null || json === undefined) return null;
  const r = rec(json, "secret");
  if (r.shown_once !== true) throw new ApiContractError("Unexpected secret in an API response.");
  return { shown_once: true, url: optStr(r.url, "secret url", 2000), email_address: optStr(r.email_address, "secret email", 500), snippet_html: optStr(r.snippet_html, "secret snippet", 20_000), meta_callback_url: optStr(r.meta_callback_url, "secret callback", 2000), meta_verify_token: optStr(r.meta_verify_token, "secret verify token", 500) };
}
export function parseSourceWithSecret(json: unknown): SourceWithSecret {
  const r = rec(json, "lead source");
  return { ...parseSource(json), secret: parseSecret(r.secret) };
}

export function parseUnparsed(json: unknown): Unparsed[] {
  return list(rec(json, "unparsed mail").items, "unparsed mail", 200).map((v) => {
    const r = rec(v, "unparsed item");
    return { id: uuid(r.id, "unparsed id"), source_id: uuid(r.source_id, "unparsed source"), received_at: iso(r.received_at, "received_at"), subject: optStr(r.subject, "subject", 600), preview: str(r.preview, "preview", 600) };
  });
}
export function parsePull(json: unknown): PullResult {
  const r = rec(json, "pull");
  return { fetched: int(r.fetched, "fetched"), created: int(r.created, "created"), merged: int(r.merged, "merged"), invalid: int(r.invalid, "invalid"), existing: int(r.existing, "existing"), window_start: iso(r.window_start, "window_start"), window_end: iso(r.window_end, "window_end") };
}

export async function listSources(token: string, tenantId: string): Promise<LiveSource[]> {
  return parseSources(await apiRequest(base(tenantId), token));
}
export async function createSource(token: string, tenantId: string, body: SourceCreateBody): Promise<SourceWithSecret> {
  return parseSourceWithSecret(await post(base(tenantId), token, body));
}
export async function rotateSource(token: string, tenantId: string, id: string): Promise<SourceWithSecret> {
  return parseSourceWithSecret(await post(`${idPath(tenantId, id)}/rotate`, token));
}
export async function setSourceStatus(token: string, tenantId: string, id: string, what: "pause" | "resume"): Promise<LiveSource> {
  return parseSource(await post(`${idPath(tenantId, id)}/${what}`, token));
}
export async function pullIndiaMart(token: string, tenantId: string): Promise<PullResult> {
  return parsePull(await post(`${base(tenantId)}/indiamart/pull`, token));
}
export async function listUnparsed(token: string, tenantId: string): Promise<Unparsed[]> {
  return parseUnparsed(await apiRequest(`${base(tenantId)}/unparsed`, token));
}
export async function discardUnparsed(token: string, tenantId: string, id: string): Promise<void> {
  if (!isCanonicalUuid(id)) throw new ApiContractError("id");
  await post(`${base(tenantId)}/unparsed/${id}/discard`, token);
}
