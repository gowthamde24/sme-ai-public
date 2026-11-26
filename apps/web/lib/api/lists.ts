import { BILLING_PERIODS, BUILTIN_LISTS, COLUMN_ROLES, EDIT_IN, COLUMN_TYPES, LIST_KINDS, REFUSALS, type Cell, type Column, type Fail, type ListKind, type Refusal, type Row, type RowPage, type SellList } from "@/lib/lists/types";

import { ApiAuthError, ApiContractError, ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, int, oneOf, optStr, readRows, rec, str } from "./shape";

/**
 * The lists' routes (C1; contract docs/contracts/sell-lists.md; API flag WHAT_YOU_SELL_LISTS, 404 while off). SERVER ONLY, with the person's own token. Every refusal is a closed word.
 *   GET/POST ""   GET/PUT /{id}   POST /{id}/remove   PUT /{id}/columns (the whole ordered set)   GET /{id}/rows   PUT /{id}/rows/{row_id}   POST /{id}/rows/{row_id}/remove
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/lists`;
};
const listPath = (tenantId: string, id: string): string => {
  if (!isCanonicalUuid(id)) throw new ApiContractError("list id");
  return `${base(tenantId)}/${id}`;
};

export function parseColumn(row: unknown): Column {
  const x = rec(row, "column");
  const choices = x.choices === undefined || x.choices === null ? [] : readRows(x.choices, "choices", (c) => str(c, "choice", 60), 20);
  return {
    key: typeof x.key === "string" ? x.key : null,
    label: str(x.label, "label", 40),
    type: oneOf(x.type, COLUMN_TYPES, "type"),
    choices,
    role: x.role === null || x.role === undefined ? null : oneOf(x.role, COLUMN_ROLES, "role"),
    billingPeriod: x.billing_period === null || x.billing_period === undefined ? null : oneOf(x.billing_period, BILLING_PERIODS, "billing_period"),
    quoteDefault: x.quote_default === true,
  };
}
/** The columns are read STRICTLY: a column the web cannot read must not be left out, because saving the set sends back what was read and would delete it. */
function strictColumns(v: unknown): Column[] {
  if (!Array.isArray(v) || v.length > 12) return bad("columns");
  return v.map(parseColumn);
}
export function parseList(row: unknown): SellList {
  const x = rec(row, "list");
  return { id: str(x.id, "id", 64), name: str(x.name, "name", 60), kind: oneOf(x.kind, LIST_KINDS, "kind"), isMain: bool(x.is_main, "is_main"), rowCount: int(x.row_count, "row_count", 0, 100000), columns: strictColumns(x.columns), builtin: (BUILTIN_LISTS as readonly unknown[]).includes(x.builtin) ? (x.builtin as (typeof BUILTIN_LISTS)[number]) : null, editIn: (EDIT_IN as readonly unknown[]).includes(x.edit_in) ? (x.edit_in as (typeof EDIT_IN)[number]) : null };
}
export function parseLists(json: unknown): SellList[] {
  return readRows(rec(json, "lists").lists, "lists", parseList, 20);
}
const parseCell = (v: unknown): Cell => (v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) ? v : null);
export function parseRow(row: unknown): Row {
  const x = rec(row, "row");
  const cells: Record<string, Cell> = {};
  if (typeof x.cells === "object" && x.cells !== null && !Array.isArray(x.cells)) for (const [k, v] of Object.entries(x.cells)) cells[k] = parseCell(v);
  return { id: str(x.id, "id", 64), name: str(x.name, "name", 120), cells, active: x.active !== false };
}
export function parseRows(json: unknown): RowPage {
  const x = rec(json, "rows");
  return { items: readRows(x.items, "items", parseRow, 100), nextCursor: optStr(x.next_cursor, "next_cursor", 200) };
}

/** A refusal of the API as a closed word (and the fields it names); anything else is "unavailable" and a lost session goes on to sign-in. */
export function refusalOf(error: unknown): Fail {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    const word = error.reason ?? error.code;
    const found = (REFUSALS as readonly string[]).includes(word) ? (word as Refusal) : error.status === 403 ? "forbidden" : error.status === 404 ? "not_found" : error.status === 422 ? "validation_error" : "unavailable";
    return { ok: false, error: found, ...(error.extra?.fields ? { fields: error.extra.fields } : {}) };
  }
  return { ok: false, error: "unavailable" };
}

export const getLists = async (token: string, tenantId: string): Promise<SellList[]> => parseLists(await apiRequest(base(tenantId), token));
export const getList = async (token: string, tenantId: string, id: string): Promise<SellList> => parseList(await apiRequest(listPath(tenantId, id), token));
export async function createList(token: string, tenantId: string, input: { id: string; name: string; kind: ListKind }): Promise<SellList> {
  return parseList(await apiRequest(base(tenantId), token, { method: "POST", body: JSON.stringify(input) }));
}
export async function renameList(token: string, tenantId: string, id: string, input: { name: string; makeMain?: boolean }): Promise<SellList> {
  return parseList(await apiRequest(listPath(tenantId, id), token, { method: "PUT", body: JSON.stringify({ name: input.name, ...(input.makeMain ? { make_main: true } : {}) }) }));
}
export async function removeList(token: string, tenantId: string, id: string): Promise<void> {
  await apiRequest(`${listPath(tenantId, id)}/remove`, token, { method: "POST", body: "{}" });
}
export type ColumnInput = { key?: string; label: string; type: string; choices?: readonly string[]; role?: string | null; billingPeriod?: string | null; quoteDefault?: boolean };
export async function putColumns(token: string, tenantId: string, id: string, columns: readonly ColumnInput[], confirm: boolean): Promise<SellList> {
  const body = { columns: columns.map((c) => ({ ...(c.key ? { key: c.key } : {}), label: c.label, type: c.type, ...(c.type === "choice" ? { choices: c.choices ?? [] } : {}), ...(c.role ? { role: c.role } : {}), ...(c.role === "price" ? { billing_period: c.billingPeriod ?? "one_time", quote_default: c.quoteDefault === true } : {}) })), ...(confirm ? { confirm: true } : {}) };
  return parseList(await apiRequest(`${listPath(tenantId, id)}/columns`, token, { method: "PUT", body: JSON.stringify(body) }));
}
export async function getRows(token: string, tenantId: string, id: string, query: { q?: string; cursor?: string | null; limit?: number } = {}): Promise<RowPage> {
  const p = new URLSearchParams({ limit: String(Math.min(query.limit ?? 50, 50)) });
  if (query.q) p.set("q", query.q.slice(0, 80));
  if (query.cursor) p.set("cursor", query.cursor);
  return parseRows(await apiRequest(`${listPath(tenantId, id)}/rows?${p.toString()}`, token));
}
export async function putRow(token: string, tenantId: string, id: string, rowId: string, input: { name: string; cells: Readonly<Record<string, Cell>>; active: boolean }): Promise<Row> {
  if (!isCanonicalUuid(rowId)) throw new ApiContractError("row id");
  return parseRow(await apiRequest(`${listPath(tenantId, id)}/rows/${rowId}`, token, { method: "PUT", body: JSON.stringify(input) }));
}
export async function removeRow(token: string, tenantId: string, id: string, rowId: string): Promise<void> {
  if (!isCanonicalUuid(rowId)) throw new ApiContractError("row id");
  await apiRequest(`${listPath(tenantId, id)}/rows/${rowId}/remove`, token, { method: "POST", body: "{}" });
}

/**
 * `POST /lists/starters` (C1, 26 Nov 2026; Owner or Admin; idempotent): makes the textile shop's starter lists (Sarees, Dress materials, Blouses, Dupattas, Fabric by the metre, Stitching and alterations), each with a Category column. The answer is not used: the page reads the lists again.
 */
export async function createStarterLists(token: string, tenantId: string): Promise<void> {
  await apiRequest(`${base(tenantId)}/starters`, token, { method: "POST", body: "{}" });
}

/**
 * Import into a chosen list (slice 3 of the lists contract). `preview` reads a file the assistant's file route already holds (Excel, CSV, PDF, photo) into rows `{name, cells}` matched to the list's columns; nothing is saved. `commit` saves the owner's checked rows (all or nothing; a row whose name exists UPDATES that item; only the Owner may send a rupee amount).
 */
export type ImportPreview = { rows: { name: string; cells: Record<string, Cell> }[]; notes: { code: string; row: number | null; column: string | null }[]; unclear: boolean };
export function parseImportPreview(json: unknown): ImportPreview {
  const x = rec(json, "preview");
  const rows = readRows(x.rows, "rows", (r) => {
    const o = rec(r, "row");
    const cells: Record<string, Cell> = {};
    if (typeof o.cells === "object" && o.cells !== null && !Array.isArray(o.cells)) for (const [k, v] of Object.entries(o.cells)) cells[k] = parseCell(v);
    return { name: str(o.name, "name", 120), cells };
  }, 1000);
  const notes = Array.isArray(x.notes) ? x.notes.flatMap((n) => (typeof n === "object" && n !== null && typeof (n as { code?: unknown }).code === "string" ? [{ code: String((n as { code: string }).code).slice(0, 40), row: typeof (n as { row?: unknown }).row === "number" ? ((n as { row: number }).row) : null, column: typeof (n as { column?: unknown }).column === "string" ? ((n as { column: string }).column).slice(0, 60) : null }] : [])) : [];
  return { rows, notes, unclear: x.unclear === true };
}
export async function previewListImport(token: string, tenantId: string, id: string, fileId: string): Promise<ImportPreview> {
  if (!isCanonicalUuid(fileId)) throw new ApiContractError("file id");
  return parseImportPreview(await apiRequest(`${listPath(tenantId, id)}/import/preview`, token, { method: "POST", body: JSON.stringify({ file_id: fileId }) }));
}
export async function commitListImport(token: string, tenantId: string, id: string, rows: readonly { name: string; cells: Readonly<Record<string, Cell>> }[]): Promise<{ created: number; updated: number }> {
  const x = rec(await apiRequest(`${listPath(tenantId, id)}/import/commit`, token, { method: "POST", body: JSON.stringify({ rows: rows.slice(0, 1000) }) }), "commit");
  return { created: int(x.created, "created", 0, 100000), updated: int(x.updated, "updated", 0, 100000) };
}

