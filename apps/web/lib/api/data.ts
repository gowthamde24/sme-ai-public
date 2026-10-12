import { apiRequest, apiUploadRequest, publicApiBase } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, counts, int, iso, isRec, list, optInt, optIso, optStr, oneOf, rec, str, word, type Rec } from "./shape";

/**
 * Settings > Data (job CC, screen 1): the spreadsheet import, the accounting export and the calendar feed (ADR 0073; the contract is in job BI's report). Server side only, with the signed-in person's own token.
 * The import's file is the raw request body; the API holds it in memory for the request and never stores it. Cell values of the file (sample rows, labels) are the person's own data and are drawn as text only.
 */
export type ImportKind = "customers" | "stock";
export const IMPORT_KINDS: readonly ImportKind[] = ["customers", "stock"];
/** The API refuses a larger file (a CSV over 1 MB is refused too); the screen checks first. */
export const MAX_IMPORT_BYTES = 2_000_000;
export const MAX_CSV_BYTES = 1_000_000;

export type Confidence = "exact" | "partial" | "weak" | "none";
export interface InspectColumn {
  index: number;
  header: string;
  suggested_field: string | null;
  confidence: Confidence;
}
export interface ImportField {
  field: string;
  label: string;
  required: boolean;
}
export interface Inspected {
  kind: ImportKind;
  file_kind: string;
  rows: number;
  columns: InspectColumn[];
  suggested_mapping: Record<string, number>;
  fields: ImportField[];
  sample: string[][];
  cut_cells: number;
}
export interface PreviewRow {
  line: number;
  status: string;
  reason: string | null;
  label: string;
  city: string | null;
  note: string | null;
  old_status: string | null;
  new_status: string | null;
}
export interface Issue {
  line: number;
  code: string;
  field: string | null;
}
export interface Previewed {
  job_id: string;
  counts: Record<string, number>;
  rows: PreviewRow[];
  issues: Issue[];
  mapping: Record<string, number>;
}
export interface ImportJob {
  id: string;
  kind: ImportKind;
  status: "previewed" | "completed" | "failed";
  counts: Record<string, number>;
  created_at: string | null;
  completed_at: string | null;
}
export interface Confirmed {
  job: ImportJob;
  replay: boolean;
  result: { counts: Record<string, number>; rows: PreviewRow[]; issues: Issue[] } | null;
}

function mapping(v: unknown, what: string): Record<string, number> {
  const r = rec(v, what);
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(r)) out[word(k, what)] = int(n, what, 0, 1000);
  return out;
}

export function parseInspected(json: unknown): Inspected {
  const r = rec(json, "inspect");
  return {
    kind: oneOf(r.kind, IMPORT_KINDS, "kind"),
    file_kind: word(r.file_kind, "file_kind"),
    rows: int(r.rows, "rows", 0, 100_000),
    columns: list(r.columns, "columns", 200).map((c) => {
      const x = rec(c, "column");
      return { index: int(x.index, "index", 0, 1000), header: str(x.header, "header", 300), suggested_field: x.suggested_field === null ? null : word(x.suggested_field, "suggested_field"), confidence: oneOf(x.confidence, ["exact", "partial", "weak", "none"] as const, "confidence") };
    }),
    suggested_mapping: mapping(r.suggested_mapping, "suggested_mapping"),
    fields: list(r.fields, "fields", 50).map((f) => {
      const x = rec(f, "field");
      return { field: word(x.field, "field"), label: str(x.label, "label", 120), required: bool(x.required, "required") };
    }),
    sample: list(r.sample, "sample", 10).map((row) => list(row, "sample row", 50).map((c) => (typeof c === "string" ? c.slice(0, 300) : ""))),
    cut_cells: int(r.cut_cells, "cut_cells", 0, 1_000_000),
  };
}

function previewRow(v: unknown): PreviewRow {
  const x = rec(v, "row");
  return {
    line: int(x.line, "line", 0, 1_000_000),
    status: word(x.status, "status"),
    reason: x.reason === null || x.reason === undefined ? null : word(x.reason, "reason", 120),
    label: str(x.label ?? "", "label", 300),
    city: optStr(x.city, "city", 200),
    note: x.note === null || x.note === undefined ? null : word(x.note, "note", 120),
    old_status: x.old_status === null || x.old_status === undefined ? null : word(x.old_status, "old_status"),
    new_status: x.new_status === null || x.new_status === undefined ? null : word(x.new_status, "new_status"),
  };
}
function issue(v: unknown): Issue {
  const x = rec(v, "issue");
  return { line: int(x.line, "line", 0, 1_000_000), code: word(x.code, "code", 80), field: x.field === null || x.field === undefined ? null : word(x.field, "field") };
}
export function parseJob(json: unknown): ImportJob {
  const x = rec(json, "job");
  return {
    id: str(x.id, "id", 40),
    kind: oneOf(x.kind, IMPORT_KINDS, "kind"),
    status: oneOf(x.status, ["previewed", "completed", "failed"] as const, "status"),
    counts: isRec(x.counts) ? counts(x.counts, "counts") : {},
    created_at: optIso(x.created_at, "created_at"),
    completed_at: optIso(x.completed_at, "completed_at"),
  };
}
export function parsePreviewed(json: unknown): Previewed {
  const r = rec(json, "preview");
  const job = rec(r.job, "job");
  return { job_id: str(job.id ?? job.job_id, "job id", 40), counts: counts(r.counts, "counts"), rows: list(r.rows, "rows", 600).map(previewRow), issues: list(r.issues, "issues", 300).map(issue), mapping: mapping(r.mapping, "mapping") };
}
export function parseConfirmed(json: unknown): Confirmed {
  const r = rec(json, "confirm");
  let result: Confirmed["result"] = null;
  if (r.result !== null && r.result !== undefined) {
    const x = rec(r.result, "result");
    result = { counts: counts(x.counts, "counts"), rows: list(x.rows, "rows", 600).map(previewRow), issues: list(x.issues, "issues", 300).map(issue) };
  }
  return { job: parseJob(r.job), replay: bool(r.replay, "replay"), result };
}
export function parseJobs(json: unknown): ImportJob[] {
  return list(rec(json, "jobs").jobs, "jobs", 100).map(parseJob);
}

const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) bad("workspace id");
  return `/v1/tenants/${tenantId}`;
};
const kindOf = (k: string): ImportKind => oneOf(k, IMPORT_KINDS, "kind");

/** The raw file goes through unchanged; the API names the columns and suggests what each holds. Changes nothing. */
export async function inspectSpreadsheet(token: string, tenantId: string, kind: string, file: ArrayBuffer, contentType: string): Promise<Inspected> {
  return parseInspected(await apiUploadRequest(`${base(tenantId)}/imports/spreadsheet/inspect?kind=${kindOf(kind)}`, token, file, contentType));
}
export async function previewSpreadsheet(token: string, tenantId: string, kind: string, jobId: string, mappingChoice: Record<string, number> | null, file: ArrayBuffer, contentType: string): Promise<Previewed> {
  if (!isCanonicalUuid(jobId)) bad("job id");
  const q = new URLSearchParams({ kind: kindOf(kind), job_id: jobId });
  if (mappingChoice) q.set("mapping", JSON.stringify(mappingChoice));
  return parsePreviewed(await apiUploadRequest(`${base(tenantId)}/imports/spreadsheet/preview?${q.toString()}`, token, file, contentType));
}
/** Needs the second factor (403 mfa_required otherwise). The SAME file again; another file is a 409 import_file_changed. */
export async function confirmSpreadsheet(token: string, tenantId: string, jobId: string, file: ArrayBuffer, contentType: string): Promise<Confirmed> {
  if (!isCanonicalUuid(jobId)) bad("job id");
  return parseConfirmed(await apiUploadRequest(`${base(tenantId)}/imports/spreadsheet/${jobId}/confirm`, token, file, contentType));
}
export async function listImportJobs(token: string, tenantId: string): Promise<ImportJob[]> {
  return parseJobs(await apiRequest(`${base(tenantId)}/imports/spreadsheet/jobs?limit=10`, token));
}

// ----------------------------------------------------------------------------------------------------------------- the accounting export
export const EXPORT_FORMATS = ["tally_zip", "tally_masters_xml", "tally_vouchers_xml", "vyapar_xlsx", "csv", "xlsx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export function parseExportFormats(json: unknown): ExportFormat[] {
  const found = list(rec(json, "formats").formats, "formats", 20).map((f) => oneOf(rec(f, "format").format, EXPORT_FORMATS, "format"));
  return found;
}
export async function getExportFormats(token: string, tenantId: string): Promise<ExportFormat[]> {
  return parseExportFormats(await apiRequest(`${base(tenantId)}/exports/accounting/formats`, token));
}

// ----------------------------------------------------------------------------------------------------------------- the calendar feed
export interface CalendarFeed {
  active: boolean;
  created_at: string | null;
  last_used_at: string | null;
}
export function parseCalendarFeed(json: unknown): CalendarFeed {
  const r = rec(json, "calendar feed");
  return { active: bool(r.active, "active"), created_at: optIso(r.created_at, "created_at"), last_used_at: optIso(r.last_used_at, "last_used_at") };
}
export async function getCalendarFeed(token: string, tenantId: string): Promise<CalendarFeed> {
  return parseCalendarFeed(await apiRequest(`${base(tenantId)}/calendar-feed`, token));
}

export interface NewCalendarFeed {
  /** The whole https address a calendar app subscribes to. Shown once; the API keeps only a hash. */
  url: string;
  /** The same address as webcal://, for a phone. */
  webcal: string;
  created_at: string;
}
const FEED_PATH = /^\/v1\/calendar\/feed\/[A-Za-z0-9_-]{16,200}\.ics$/;
export function parseNewCalendarFeed(json: unknown, apiBase: string): NewCalendarFeed {
  const r = rec(json, "calendar feed");
  const path = str(r.path, "path", 400);
  if (!FEED_PATH.test(path)) bad("calendar feed path");
  const url = `${apiBase.replace(/\/+$/, "")}${path}`;
  return { url, webcal: url.replace(/^https?:\/\//, "webcal://"), created_at: iso(r.created_at, "created_at") };
}
/** Makes a new private address (and revokes the old one). The answer is the only time the address can be seen. */
export async function createCalendarFeed(token: string, tenantId: string): Promise<NewCalendarFeed> {
  return parseNewCalendarFeed(await apiRequest(`${base(tenantId)}/calendar-feed`, token, { method: "POST" }), publicApiBase());
}
export async function revokeCalendarFeed(token: string, tenantId: string): Promise<number> {
  return optInt(rec(await apiRequest(`${base(tenantId)}/calendar-feed/revoke`, token, { method: "POST" }), "revoke").revoked, "revoked") ?? 0;
}

export type { Rec };
