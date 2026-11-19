"use server";

import { randomUUID } from "node:crypto";

import type { Reply } from "@/components/v2/app/cc/kit";
import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { getCatalogueItem, putQuantity } from "@/lib/api/catalogue";
import { isCanonicalUuid } from "@/lib/api/crm";
import { productOf, readUnderstood } from "@/lib/api/what-you-sell";
import { readPackCached } from "@/lib/packs/read";
import { buildEntry, productSaveInput } from "@/lib/sell/forms";
import { understand } from "@/lib/sell/say";
import { liveSource } from "@/lib/sell/style";
import { SELL_STYLES, type SellEntry, type SellForm, type SellStyle } from "@/lib/sell/types";
import { jobsScreens } from "@/lib/screens/flag";

import { saveItemAction } from "../catalogue/catalogue-actions";
import { DECIDERS, invalid } from "../retailers/finder-guard";
import { jobsWho } from "../jobs/guard";

/**
 * What you sell, the changes (Owner and Admin; Sales and Viewer read). Three actions:
 *  - `saveEntryAction`: add or change one entry. JOBS=mock only checks it and sends it back (nothing is stored; the list lives in the page). For PRODUCTS of a real workspace it is the OLD CATALOGUE FORM's save, the same payload through the same
 *    `saveItemAction` (a new saree is not shown until it has a photo; the exact price only the Owner's), then the count through the stock call. The other styles have no API yet: a real workspace is told so.
 *  - `understandAction`: a sentence to the sheet's choices (closed words and numbers, lib/sell/say.ts). Nothing is saved.
 *  - `readSheetAction`: what the assistant "understood" from photos or a sheet (JOBS=mock only; a real workspace goes to the existing path).
 */
const isStyle = (v: unknown): v is SellStyle => typeof v === "string" && (SELL_STYLES as readonly string[]).includes(v);

export type Saved = { entry: SellEntry; photosPath: string | null; note: "count" | null };

export async function saveEntryAction(tenantId: string, style: SellStyle, id: string | null, form: SellForm[SellStyle]): Promise<Reply<Saved>> {
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (!isStyle(style) || typeof form !== "object" || form === null || (id !== null && !isCanonicalUuid(id))) return invalid(ctx.t);
  const entryId = id ?? randomUUID();
  const mode = jobsScreens();
  let owner = false;
  try {
    owner = (await fetchTenant(ctx.token, tenantId)).role === "owner";
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
  }
  if (mode === "mock") {
    const built = buildEntry(style, entryId, form, null, owner);
    if (!built.ok) return { ok: false, kind: "invalid", error: ctx.t(`jobs.sell.err.${built.code}` as Parameters<typeof ctx.t>[0]), fields: [built.field] };
    return { ok: true, data: { entry: built.entry, photosPath: null, note: null } };
  }
  const modules = (await readPackCached(ctx.token, tenantId).catch(() => null))?.modules ?? null;
  if (style !== "products" || liveSource(style, modules) !== "catalogue") return { ok: false, kind: "unavailable", error: ctx.t("jobs.sell.err.not_ready") };
  // the old form's own save: the item as it is (what the sheet does not ask is kept), then the choices over it
  let prior = null;
  if (id !== null) {
    try {
      prior = productOf(await getCatalogueItem(ctx.token, tenantId, id));
    } catch {
      return { ok: false, kind: "not_found", error: ctx.t("apierr.not_found") };
    }
  }
  const f = form as SellForm["products"];
  const built = buildEntry("products", entryId, f, prior, owner);
  if (!built.ok || built.entry.style !== "products") return { ok: false, kind: "invalid", error: built.ok ? ctx.t("apierr.invalid") : ctx.t(`jobs.sell.err.${built.code}` as Parameters<typeof ctx.t>[0]), ...(built.ok ? {} : { fields: [built.field] }) };
  const saved = await saveItemAction(tenantId, entryId, productSaveInput(built.entry, owner, f.price));
  if (!saved.ok) return { ok: false, kind: saved.mfa ? "mfa" : "invalid", error: saved.error, ...(saved.mfa ? { mfa: true } : {}) };
  let note: Saved["note"] = null;
  if (built.entry.stock.count !== null) {
    try {
      await putQuantity(ctx.token, tenantId, entryId, built.entry.stock.count);
    } catch {
      note = "count";
    }
  }
  const entry = { ...productOf(saved.item, built.entry.stock.count), stock: built.entry.stock };
  return { ok: true, data: { entry, photosPath: saved.item.photos.length === 0 ? `/catalogue/${entryId}` : null, note } };
}

export async function understandAction(tenantId: string, style: SellStyle, text: string): Promise<Reply<{ form: SellForm[SellStyle] }>> {
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (!isStyle(style) || typeof text !== "string" || text.trim().length < 3 || text.length > 600) return invalid(ctx.t);
  return { ok: true, data: { form: understand(style, text) } };
}

export async function readSheetAction(tenantId: string, style: SellStyle, from: "photos" | "sheet"): Promise<Reply<{ entries: SellEntry[] }>> {
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (!isStyle(style) || (from !== "photos" && from !== "sheet")) return invalid(ctx.t);
  const entries = await readUnderstood(style, from);
  if (!entries) return { ok: false, kind: "unavailable", error: ctx.t("jobs.sell.err.not_ready") };
  return { ok: true, data: { entries } };
}
