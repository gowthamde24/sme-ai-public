"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { createList, getRows, putColumns, putRow, refusalOf, removeList, removeRow, renameList, type ColumnInput } from "@/lib/api/lists";
import { requireUser } from "@/lib/auth/session";
import { whatYouSellLists } from "@/lib/screens/flag";
import { isKind, MAX_COLUMNS, NAME_MAX, ROW_NAME_MAX, parseRupees, type Cell, type Done, type ListKind, type Row, type RowPage, type SellList } from "@/lib/lists/types";

/**
 * The moves of the lists (flag WHAT_YOU_SELL_LISTS). Owner and Admin change lists, columns and items; a rupee cell is the Owner's alone (the API refuses an Admin with 403 and the screen shows prices read-only for one). Every input is checked again here
 * (the browser is not trusted) and every answer is a closed word the screen draws in plain language (`ls.err.*`), never the API's own text.
 */
async function who(tenantId: string): Promise<{ token: string; role: string } | null> {
  if (!whatYouSellLists() || !isCanonicalUuid(tenantId)) return null;
  const user = await requireUser();
  try {
    return { token: user.accessToken, role: (await fetchTenant(user.accessToken, tenantId)).role };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}
const canWrite = (role: string): boolean => role === "owner" || role === "admin";
const no = (error: "forbidden" | "validation_error" | "not_found"): { ok: false; error: typeof error } => ({ ok: false, error });
const wrap = async <T>(tenantId: string, run: () => Promise<T>): Promise<Done<T>> => {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    return refusalOf(error);
  }
};
const clean = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim().length >= 1 && v.trim().length <= max ? v.trim() : null);

export async function createListAction(tenantId: string, input: { id: unknown; name: unknown; kind: unknown }): Promise<Done<SellList>> {
  const me = await who(tenantId);
  if (!me || !canWrite(me.role)) return no("forbidden");
  const name = clean(input.name, NAME_MAX);
  if (!name || !isKind(input.kind) || typeof input.id !== "string" || !isCanonicalUuid(input.id)) return no("validation_error");
  const out = await wrap(tenantId, () => createList(me.token, tenantId, { id: input.id as string, name, kind: input.kind as ListKind }));
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/what-you-sell`);
  return out;
}
export async function renameListAction(tenantId: string, listId: string, name: unknown): Promise<Done<SellList>> {
  const me = await who(tenantId);
  if (!me || !canWrite(me.role)) return no("forbidden");
  const n = clean(name, NAME_MAX);
  if (!n) return no("validation_error");
  const out = await wrap(tenantId, () => renameList(me.token, tenantId, listId, { name: n }));
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/what-you-sell`);
  return out;
}
export async function removeListAction(tenantId: string, listId: string): Promise<Done<true>> {
  const me = await who(tenantId);
  if (!me || !canWrite(me.role)) return no("forbidden");
  const out = await wrap(tenantId, async () => {
    await removeList(me.token, tenantId, listId);
    return true as const;
  });
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/what-you-sell`);
  return out;
}
export async function saveColumnsAction(tenantId: string, listId: string, columns: readonly ColumnInput[], confirm: boolean): Promise<Done<SellList>> {
  const me = await who(tenantId);
  if (!me || !canWrite(me.role)) return no("forbidden");
  if (!Array.isArray(columns) || columns.length < 1 || columns.length > MAX_COLUMNS || columns.some((c) => !clean(c.label, 40) || typeof c.type !== "string")) return no("validation_error");
  const out = await wrap(tenantId, () => putColumns(me.token, tenantId, listId, columns.map((c) => ({ ...c, label: clean(c.label, 40) as string })), confirm === true));
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/what-you-sell`);
  return out;
}
export async function loadRowsAction(tenantId: string, listId: string, q: string, cursor: string | null): Promise<Done<RowPage>> {
  const me = await who(tenantId);
  if (!me) return no("forbidden");
  return wrap(tenantId, () => getRows(me.token, tenantId, listId, { q: typeof q === "string" ? q : "", cursor: typeof cursor === "string" ? cursor : null }));
}
/** One item: its name and its cells. A rupee cell arrives as the text the person typed and goes on as whole paise; an Admin's rupee cells are left out (the Owner's alone). */
export async function saveRowAction(tenantId: string, listId: string, rowId: string, input: { name: unknown; cells: Record<string, unknown>; active: unknown }, rupeeKeys: readonly string[]): Promise<Done<Row>> {
  const me = await who(tenantId);
  if (!me || !canWrite(me.role)) return no("forbidden");
  const name = clean(input.name, ROW_NAME_MAX);
  if (!name || typeof input.cells !== "object" || input.cells === null) return no("validation_error");
  const cells = new Map<string, Cell>();   // a Map, not an object: a column key from the browser can never become a property name
  for (const [k, v] of Object.entries(input.cells)) {
    if (rupeeKeys.includes(k)) {
      if (me.role !== "owner") continue;
      if (v === "" || v === null) cells.set(k, null);
      else {
        const paise = typeof v === "number" ? v : typeof v === "string" ? parseRupees(v) : null;
        if (paise === null) return { ok: false, error: "not_a_price", fields: [k] };
        cells.set(k, paise);
      }
    } else cells.set(k, v === "" ? null : typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null ? v : null);
  }
  const out = await wrap(tenantId, () => putRow(me.token, tenantId, listId, rowId, { name, cells: Object.fromEntries(cells), active: input.active !== false }));
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/what-you-sell`);
  return out;
}
export async function removeRowAction(tenantId: string, listId: string, rowId: string): Promise<Done<true>> {
  const me = await who(tenantId);
  if (!me || !canWrite(me.role)) return no("forbidden");
  return wrap(tenantId, async () => {
    await removeRow(me.token, tenantId, listId, rowId);
    return true as const;
  });
}
