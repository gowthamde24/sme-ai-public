"use server";

import { randomUUID } from "node:crypto";

import type { Reply } from "@/components/v2/app/cc/kit";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { FABRICS, getCatalogueItem, putQuantity } from "@/lib/api/catalogue";
import { isCanonicalUuid } from "@/lib/api/crm";
import { failureOf } from "@/lib/api/failure";
import { productOf, putSellEntry, readProductDrafts, readSellDrafts, readUnderstood, removeSellEntry, type ProductsReading, type SellReading } from "@/lib/api/what-you-sell";
import { readPackCached } from "@/lib/packs/read";
import { buildEntry, productSaveInput } from "@/lib/sell/forms";
import { understand } from "@/lib/sell/say";
import { liveSource } from "@/lib/sell/style";
import { SEAT_STATES, SELL_STYLES, type CourseEntry, type SellEntry, type SellForm, type SellStyle } from "@/lib/sell/types";
import { jobsScreens } from "@/lib/screens/flag";

import { saveItemAction } from "../catalogue/catalogue-actions";
import { DECIDERS, invalid } from "../retailers/finder-guard";
import { jobsWho } from "../jobs/guard";

/**
 * What you sell, the changes (Owner and Admin; Sales and Viewer read). The actions (every one starts with the shared JOBS guard: with JOBS off it answers "invalid" before anything is read or sent):
 *  - `saveEntryAction`: add or change one entry. JOBS=mock only checks it and sends it back (nothing is stored; the list lives in the page). For PRODUCTS of a real workspace it is the OLD CATALOGUE FORM's save, the same payload through the same
 *    `saveItemAction` (a new saree is not shown until it has a photo; the exact price only the Owner's), then the count through the stock call. The other four styles are `PUT /what-you-sell/{style}/{id}` (C1 contract 1.1 part 1): the sheet mints the id of a
 *    NEW entry once per opening, so a retry is the same id again; a price, fee or rate change may answer 403 `mfa_required` (the sheet shows the Security link); ONLY a 404 means "not there yet".
 *  - `removeEntryAction`: `POST /what-you-sell/{style}/{id}/remove` (never for products: the old catalogue page keeps that).
 *  - `understandAction`: a sentence to the sheet's choices by CLOSED words and numbers (lib/sell/say.ts): JOBS=mock, and products.
 *  - `readAction`: the reading call (`POST /what-you-sell/{style}/read`): the owner's words ("talk") or a file dropped first ("photo", "sheet") to up to 20 drafts and plain notes. Nothing is saved.
 *  - `readSheetAction`: what the assistant "understood" from photos or a sheet (JOBS=mock only; a real workspace uses `readAction` with the uploaded file).
 */
const isStyle = (v: unknown): v is SellStyle => typeof v === "string" && (SELL_STYLES as readonly string[]).includes(v);

export type Saved = { entry: SellEntry; photosPath: string | null; note: "count" | null };
/** What the sheet knows of the entry it is changing and the form cannot say: a course's seats are the owner's own count ("2 seats left"), kept unless the total changed. `freshId` is the id the sheet minted for a NEW entry (the same one on a retry). */
export type SaveExtra = { freshId?: string; /** a NEW saree made from a price list: the fabric read from its name (the sheet's form has no fabric) */ fabric?: string; course?: { seats: { state: string; count: number | null }; total: number | null } };

function priorCourse(extra: SaveExtra | undefined): CourseEntry | null {
  const c = extra?.course;
  if (!c || typeof c !== "object" || !(SEAT_STATES as readonly string[]).includes(c.seats?.state)) return null;
  const count = c.seats.count;
  if (count !== null && !(typeof count === "number" && Number.isSafeInteger(count) && count >= 1 && count <= 100_000)) return null;
  const total = c.total;
  if (total !== null && !(typeof total === "number" && Number.isSafeInteger(total) && total >= 1 && total <= 100_000)) return null;
  return { style: "courses", id: "prior", name: "", batch: "", startsOn: null, feePaise: null, seats: { state: c.seats.state as CourseEntry["seats"]["state"], count: c.seats.state === "left" ? count : null }, total };
}

export async function saveEntryAction(tenantId: string, style: SellStyle, id: string | null, form: SellForm[SellStyle], extra?: SaveExtra): Promise<Reply<Saved>> {
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (!isStyle(style) || typeof form !== "object" || form === null || (id !== null && !isCanonicalUuid(id))) return invalid(ctx.t);
  const fresh = typeof extra?.freshId === "string" && isCanonicalUuid(extra.freshId) ? extra.freshId : null;
  const entryId = id ?? fresh ?? randomUUID();
  const mode = jobsScreens();
  let owner = false;
  try {
    owner = (await fetchTenant(ctx.token, tenantId)).role === "owner";
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
  }
  const prior = style === "courses" ? priorCourse(extra) : null;
  if (mode === "mock") {
    const built = buildEntry(style, entryId, form, prior, owner);
    if (!built.ok) return { ok: false, kind: "invalid", error: ctx.t(`jobs.sell.err.${built.code}` as Parameters<typeof ctx.t>[0]), fields: [built.field] };
    return { ok: true, data: { entry: built.entry, photosPath: null, note: null } };
  }
  if (style !== "products") {
    const built = buildEntry(style, entryId, form, prior, owner);
    if (!built.ok) return { ok: false, kind: "invalid", error: ctx.t(`jobs.sell.err.${built.code}` as Parameters<typeof ctx.t>[0]), fields: [built.field] };
    try {
      return { ok: true, data: { entry: await putSellEntry(ctx.token, tenantId, built.entry), photosPath: null, note: null } };
    } catch (error) {
      // ONLY a 404 means "not there yet"; a refusal (403 mfa_required, 422, 5xx) is shown as it is
      if (error instanceof ApiRequestError && error.status === 404) return { ok: false, kind: "unavailable", error: ctx.t("jobs.sell.err.not_ready") };
      return failureOf(error, ctx.t);
    }
  }
  const modules = (await readPackCached(ctx.token, tenantId).catch(() => null))?.modules ?? null;
  if (liveSource(style, modules) !== "catalogue") return { ok: false, kind: "unavailable", error: ctx.t("jobs.sell.err.not_ready") };
  // the old form's own save: the item as it is (what the sheet does not ask is kept), then the choices over it
  let before = null;
  if (id !== null) {
    try {
      before = productOf(await getCatalogueItem(ctx.token, tenantId, id));
    } catch {
      return { ok: false, kind: "not_found", error: ctx.t("apierr.not_found") };
    }
  }
  const f = form as SellForm["products"];
  const built = buildEntry("products", entryId, f, before, owner);
  if (!built.ok || built.entry.style !== "products") return { ok: false, kind: "invalid", error: built.ok ? ctx.t("apierr.invalid") : ctx.t(`jobs.sell.err.${built.code}` as Parameters<typeof ctx.t>[0]), ...(built.ok ? {} : { fields: [built.field] }) };
  const fabric = id === null && typeof extra?.fabric === "string" ? FABRICS.find((x) => x === extra.fabric) : undefined;
  const entryToSave = fabric ? { ...built.entry, keep: { ...built.entry.keep, fabric } } : built.entry;
  const saved = await saveItemAction(tenantId, entryId, productSaveInput(entryToSave, owner, f.price));
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

/** `POST /what-you-sell/{style}/{id}/remove` (soft remove). Products are removed on the old catalogue page, never here. */
export async function removeEntryAction(tenantId: string, style: SellStyle, id: string): Promise<Reply<{ id: string }>> {
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (!isStyle(style) || style === "products" || !isCanonicalUuid(id)) return invalid(ctx.t);
  if (jobsScreens() === "mock") return { ok: true, data: { id } };
  try {
    await removeSellEntry(ctx.token, tenantId, style, id);
    return { ok: true, data: { id } };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return { ok: false, kind: "unavailable", error: ctx.t("jobs.sell.err.not_ready") };
    return failureOf(error, ctx.t);
  }
}

export async function understandAction(tenantId: string, style: SellStyle, text: string): Promise<Reply<{ form: SellForm[SellStyle] }>> {
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (!isStyle(style) || typeof text !== "string" || text.trim().length < 3 || text.length > 600) return invalid(ctx.t);
  return { ok: true, data: { form: understand(style, text) } };
}

/** What the sheet sends to the reading call (checked again here): the owner's words, or the id of a file it dropped first. */
export type ReadRequest = { kind: "talk"; text: string } | { kind: "photo" | "sheet"; fileId: string };

/** The reading call, for the four styles that are not products (the catalogue has its own photo page). The language of the answer is the one the owner's words are in: the language of the screen. */
export async function readAction(tenantId: string, style: SellStyle, request: ReadRequest): Promise<Reply<SellReading>> {
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (!isStyle(style) || style === "products" || typeof request !== "object" || request === null) return invalid(ctx.t);
  let input: Parameters<typeof readSellDrafts>[3];
  if (request.kind === "talk") {
    const text = typeof request.text === "string" ? request.text.trim() : "";
    if (text.length < 3 || text.length > 2000) return invalid(ctx.t);
    input = { kind: "talk", text };
  } else if ((request.kind === "photo" || request.kind === "sheet") && typeof request.fileId === "string" && isCanonicalUuid(request.fileId)) {
    input = { kind: request.kind, fileId: request.fileId };
  } else return invalid(ctx.t);
  // the made-up test mode has no model: it keeps the closed-word parser and the made-up readings
  if (jobsScreens() === "mock") return { ok: false, kind: "unavailable", error: ctx.t("jobs.sell.err.not_ready") };
  try {
    return { ok: true, data: await readSellDrafts(ctx.token, tenantId, style, input, await getLang()) };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return { ok: false, kind: "unavailable", error: ctx.t("jobs.sell.err.not_ready") };
    return failureOf(error, ctx.t);
  }
}

/** The products reading (a photo or a PDF of a price list; C1, 26 Nov 2026). Every refusal is a plain sentence of ours: not switched on, a scanned school sheet, a HEIC photo ("share it as JPG"), the day's reading limit. */
export async function readProductsAction(tenantId: string, fileId: string): Promise<Reply<ProductsReading>> {
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (typeof fileId !== "string" || !isCanonicalUuid(fileId)) return invalid(ctx.t);
  if (jobsScreens() === "mock") return { ok: false, kind: "unavailable", error: ctx.t("jobs.sell.imp.err.no_read") };
  try {
    return { ok: true, data: await readProductDrafts(ctx.token, tenantId, fileId) };
  } catch (error) {
    if (error instanceof ApiRequestError) {
      if (error.status === 404) return { ok: false, kind: "unavailable", error: ctx.t("jobs.sell.imp.err.no_read") };
      if (error.status === 422 && error.reason === "heic") return { ok: false, kind: "invalid", error: ctx.t("jobs.sell.imp.err.heic") };
      if (error.status === 422 && error.reason === "scanned_school") return { ok: false, kind: "invalid", error: ctx.t("jobs.sell.imp.err.scanned") };
      if (error.status === 429) return { ok: false, kind: "unavailable", error: ctx.t("jobs.sell.imp.err.ai_limit") };
    }
    return failureOf(error, ctx.t);
  }
}

export async function readSheetAction(tenantId: string, style: SellStyle, from: "photos" | "sheet"): Promise<Reply<{ entries: SellEntry[] }>> {
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (!isStyle(style) || (from !== "photos" && from !== "sheet")) return invalid(ctx.t);
  const entries = await readUnderstood(style, from);
  if (!entries) return { ok: false, kind: "unavailable", error: ctx.t("jobs.sell.err.not_ready") };
  return { ok: true, data: { entries } };
}
