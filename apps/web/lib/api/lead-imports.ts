import { CONFIDENCES, FIELD_KEYS, READ_KINDS, type Column, type Counts, type Estimate, type FieldInfo, type ImportBody, type ImportItem, type ImportResult, type Mapping, type PreviewBody, type PreviewResult, type Problem, type ReadBody, type ReadResult, type SheetAccess, type SheetLink, type SheetLinkBody, type SheetMode } from "@/lib/lead-desk/imports/types";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, int, iso, list, oneOf, optInt, optIso, optStr, rec, str, uuid, word } from "./shape";

/**
 * Lead imports and Google Sheets kept in sync from C1's API (night 4; contract-lead-sources.md, sections 1 and the sheet links): `POST lead-imports/read|preview`, `POST lead-imports` (idempotent on `import_id`),
 * `GET lead-imports`, `GET|POST lead-sheet-links` and `.../{id}/sync|pause|resume`. A file travels as base64 inside the JSON (the API has no multipart). Every answer is checked: a body that is not the contract is an
 * ApiContractError, never drawn. SERVER ONLY, the person's own token. Nothing here logs a body.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}`;
};
const post = (path: string, token: string, body: unknown): Promise<unknown> => apiRequest(path, token, { method: "POST", body: JSON.stringify(body) });

function mappingOf(v: unknown, what: string): Mapping | null {
  if (v === null || v === undefined) return null;
  const out: Mapping = {};
  for (const [k, n] of Object.entries(rec(v, what))) {
    if (!(FIELD_KEYS as readonly string[]).includes(k)) bad(what);
    out[k as keyof Mapping] = int(n, what, 0, 9999);
  }
  return out;
}

function parseColumn(v: unknown): Column {
  const r = rec(v, "column");
  const field = r.field === null || r.field === undefined ? null : oneOf(r.field, FIELD_KEYS, "column field");
  return { index: int(r.index, "column index", 0, 9999), header: str(r.header, "column header", 600), samples: list(r.samples, "column samples", 20).map((s) => str(s, "column sample", 600)), field, confidence: oneOf(r.confidence, CONFIDENCES, "column confidence") };
}
function parseFieldInfo(v: unknown): FieldInfo {
  const r = rec(v, "field");
  return { field: oneOf(r.field, FIELD_KEYS, "field"), label: str(r.label, "field label", 200), required: bool(r.required, "field required") };
}

export function parseRead(json: unknown): ReadResult {
  const r = rec(json, "import read");
  return {
    kind: oneOf(r.kind, READ_KINDS, "kind"),
    rows: int(r.rows, "rows"),
    columns: list(r.columns, "columns", 200).map(parseColumn),
    fields: list(r.fields, "fields", 50).map(parseFieldInfo),
    mapping: mappingOf(r.mapping, "mapping"),
    mapped_by: oneOf(r.mapped_by, ["rules", "rules+ai", "none"] as const, "mapped_by"),
    needs_confirmation: bool(r.needs_confirmation, "needs_confirmation"),
    warnings: list(r.warnings, "warnings", 30).map((w) => word(w, "warning")),
  };
}

export function parseCounts(json: unknown): Counts {
  const r = rec(json, "counts");
  return { ready: int(r.ready, "ready"), duplicates_merged: int(r.duplicates_merged, "duplicates_merged"), duplicates_in_file: int(r.duplicates_in_file, "duplicates_in_file"), already_imported: int(r.already_imported, "already_imported"), invalid: int(r.invalid, "invalid"), dnd: int(r.dnd, "dnd"), no_consent: int(r.no_consent, "no_consent"), blocked: int(r.blocked, "blocked") };
}
function parseProblem(v: unknown): Problem {
  const r = rec(v, "problem");
  return { row: int(r.row, "problem row"), reason: word(r.reason, "problem reason") };
}
function parseEstimate(v: unknown): Estimate {
  const r = rec(v, "estimate");
  return { messages: int(r.messages, "messages"), call_minutes: int(r.call_minutes, "call_minutes"), cost_paise: optInt(r.cost_paise, "cost_paise"), basis: oneOf(r.basis, ["estimate"] as const, "basis") };
}

export function parsePreview(json: unknown): PreviewResult {
  const r = rec(json, "import preview");
  return { rows_read: int(r.rows_read, "rows_read"), source: word(r.source, "source"), counts: parseCounts(r.counts), estimate: parseEstimate(r.estimate), problems: list(r.problems, "problems", 100).map(parseProblem), dnd_lookup: oneOf(r.dnd_lookup, ["checked", "not_configured"] as const, "dnd_lookup") };
}

export function parseImportResult(json: unknown): ImportResult {
  const r = rec(json, "import");
  return { import_id: uuid(r.import_id, "import_id"), status: oneOf(r.status, ["done"] as const, "status"), source: word(r.source, "source"), consent_id: r.consent_id === null || r.consent_id === undefined ? null : uuid(r.consent_id, "consent_id"), counts: parseCounts(r.counts), problems: list(r.problems, "problems", 100).map(parseProblem), created_at: iso(r.created_at, "created_at") };
}

export function parseImportItem(json: unknown): ImportItem {
  const r = rec(json, "import item");
  return { import_id: uuid(r.import_id, "import_id"), kind: word(r.kind, "kind"), source: word(r.source, "source"), rows_read: int(r.rows_read, "rows_read"), counts: parseCounts(r.counts), problems: list(r.problems, "problems", 100).map(parseProblem), consent_id: r.consent_id === null || r.consent_id === undefined ? null : uuid(r.consent_id, "consent_id"), by: optStr(r.by, "by", 200), created_at: iso(r.created_at, "created_at") };
}
export function parseImportList(json: unknown): { items: ImportItem[]; next_cursor: string | null } {
  const r = rec(json, "import list");
  return { items: list(r.items, "imports", 200).map(parseImportItem), next_cursor: optStr(r.next_cursor, "next_cursor", 500) };
}

const LINK_STATUS = ["active", "paused", "needs_attention"] as const;
const LINK_ERRORS = ["sheet_not_public", "columns_changed", "unreachable", "too_large"] as const;
export function parseSheetLink(json: unknown): SheetLink {
  const r = rec(json, "sheet link");
  let last: Record<string, number> | null = null;
  if (r.last_result !== null && r.last_result !== undefined) {
    last = {};
    for (const [k, n] of Object.entries(rec(r.last_result, "last_result"))) if (typeof n === "number" && Number.isSafeInteger(n)) last[word(k, "last_result")] = n;
  }
  return {
    id: uuid(r.id, "link id"),
    status: oneOf(r.status, LINK_STATUS, "link status"),
    source: word(r.source, "link source"),
    last_synced_at: optIso(r.last_synced_at, "last_synced_at"),
    last_row_count: optInt(r.last_row_count, "last_row_count"),
    last_result: last,
    last_error: r.last_error === null || r.last_error === undefined ? null : oneOf(r.last_error, LINK_ERRORS, "last_error"),
    created_at: iso(r.created_at, "created_at"),
    next_sync_at: optIso(r.next_sync_at, "next_sync_at"),
  };
}
export function parseSheetLinks(json: unknown): SheetLink[] {
  return list(rec(json, "sheet links").items, "sheet links", 100).map(parseSheetLink);
}
export function parseSheetAccess(json: unknown): SheetAccess {
  const modes = list(rec(json, "sheet access").modes, "modes", 10).map((v): SheetMode => {
    const r = rec(v, "mode");
    return { mode: oneOf(r.mode, ["anyone_with_link", "published_csv", "service_account"] as const, "mode"), available: bool(r.available, "available"), service_account_email: optStr(r.service_account_email, "service_account_email", 320) };
  });
  return { modes };
}

export async function readLeads(token: string, tenantId: string, body: ReadBody): Promise<ReadResult> {
  return parseRead(await post(`${base(tenantId)}/lead-imports/read`, token, body));
}
export async function previewLeads(token: string, tenantId: string, body: PreviewBody): Promise<PreviewResult> {
  return parsePreview(await post(`${base(tenantId)}/lead-imports/preview`, token, body));
}
export async function importLeads(token: string, tenantId: string, body: ImportBody): Promise<ImportResult> {
  return parseImportResult(await post(`${base(tenantId)}/lead-imports`, token, body));
}
export async function listLeadImports(token: string, tenantId: string, limit = 10): Promise<ImportItem[]> {
  return parseImportList(await apiRequest(`${base(tenantId)}/lead-imports?limit=${Math.max(1, Math.min(100, Math.trunc(limit)))}`, token)).items;
}
export async function getSheetAccess(token: string, tenantId: string): Promise<SheetAccess> {
  return parseSheetAccess(await apiRequest(`${base(tenantId)}/lead-sheet-links/access`, token));
}
export async function listSheetLinks(token: string, tenantId: string): Promise<SheetLink[]> {
  return parseSheetLinks(await apiRequest(`${base(tenantId)}/lead-sheet-links`, token));
}
export async function createSheetLink(token: string, tenantId: string, body: SheetLinkBody): Promise<SheetLink> {
  return parseSheetLink(await post(`${base(tenantId)}/lead-sheet-links`, token, body));
}
/** `sync` answers 202 `{status:"queued", link}`; pause and resume answer the link itself. */
export async function actOnSheetLink(token: string, tenantId: string, linkId: string, what: "sync" | "pause" | "resume"): Promise<SheetLink> {
  if (!isCanonicalUuid(linkId)) throw new ApiContractError("id");
  const json = await post(`${base(tenantId)}/lead-sheet-links/${linkId}/${what}`, token, {});
  return parseSheetLink(what === "sync" ? rec(json, "sync").link : json);
}
