"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ItemOutcome, LeadSearchOutcome, Refused, SaveInput, SendInput, SendOutcome } from "@/components/v2/app/catalogue/catalogue-types";
import { indiaClock } from "@/components/v2/app/today/time";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { COLOURS, FABRICS, MAX_BORDER, MAX_COLOURS, MAX_NAME, MAX_OCCASIONS, MAX_PRICE_PAISE, MIN_PRICE_PAISE, OCCASIONS, PRICE_BANDS, STOCK_STATUSES, ZARIS, putCatalogueItem, removeCataloguePhoto, reorderCataloguePhotos, type ItemInput } from "@/lib/api/catalogue";
import { isCanonicalUuid } from "@/lib/api/crm";
import { listCustomFields, putCatalogueCustom } from "@/lib/api/custom-fields";
import { normaliseValues } from "@/lib/packs/field-values";
import { searchLeads } from "@/lib/api/lead-search";
import { OUTBOX_LANGUAGES, submitOutboxMessage, type OutboxLanguage, type OutboxMessage } from "@/lib/api/outbox";
import { requireUser } from "@/lib/auth/session";

import { BLOCK_REASONS, WHY_REASONS } from "./catalogue-actions-words";
import { refusalOf, type Context } from "./catalogue-refusals";

const MAX_CAPTION = 1000;
const MIN_CAPTION = 2;
const MAX_SEND_PHOTOS = 4;

async function context() {
  const user = await requireUser();
  const lang = await getLang();
  return { user, t: appT(lang) };
}
type Ctx = Awaited<ReturnType<typeof context>>;

const subset = <T extends string>(list: readonly T[], all: readonly T[], min: number, max: number) => Array.isArray(list) && list.length >= min && list.length <= max && new Set(list).size === list.length && list.every((x) => (all as readonly string[]).includes(x));

/** A refusal as OUR sentence. A rejected session goes to sign-in. */
function refused(error: unknown, t: Ctx["t"], ctx: Context = "save"): Refused {
  try {
    const r = refusalOf(error, ctx);
    return { ok: false, error: t(r.key as "today.err.generic"), ...(r.mfa ? { mfa: true } : {}), ...(r.stale ? { stale: true } : {}) };
  } catch (e) {
    if (e instanceof ApiAuthError) redirect("/login");
    throw e;
  }
}

const refresh = (tenantId: string, itemId?: string) => {
  revalidatePath(`/app/tenants/${tenantId}/catalogue`);
  if (itemId) revalidatePath(`/app/tenants/${tenantId}/catalogue/${itemId}`);
};

/** Create or change a saree (Owner, Admin). The id is the page's, so a second press is a retry. The exact price rides along only when the Owner's form sends it (Owner with the second factor; the API refuses anyone else). */
export async function saveItemAction(tenantId: string, itemId: string, input: SaveInput): Promise<ItemOutcome> {
  const { user, t } = await context();
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const border = input?.border === null || input?.border === undefined ? null : typeof input.border === "string" ? input.border.trim() : "";
  const ok =
    isCanonicalUuid(tenantId) && isCanonicalUuid(itemId) && name.length >= 1 && name.length <= MAX_NAME && (FABRICS as readonly string[]).includes(input.fabric) &&
    subset(input.colours, COLOURS, 1, MAX_COLOURS) && (ZARIS as readonly string[]).includes(input.zari) && (border === null || (border.length >= 1 && border.length <= MAX_BORDER)) &&
    subset(input.occasions, OCCASIONS, 0, MAX_OCCASIONS) && (PRICE_BANDS as readonly string[]).includes(input.priceBand) && (STOCK_STATUSES as readonly string[]).includes(input.stockStatus) && typeof input.active === "boolean";
  if (!ok) return { ok: false, error: t("catalogue.err.invalid") };
  let price: ItemInput["price"];
  if (input.price !== undefined) {
    if ("clear" in input.price) {
      if (input.price.clear !== true) return { ok: false, error: t("catalogue.err.invalid") };
      price = { clear: true };
    } else {
      const paise = Math.round(Number(input.price.rupees) * 100);
      if (!Number.isFinite(paise) || paise < MIN_PRICE_PAISE || paise > MAX_PRICE_PAISE) return { ok: false, error: t("catalogue.err.price") };
      price = { paise };
    }
  }
  try {
    const { item } = await putCatalogueItem(user.accessToken, tenantId, itemId, { name, fabric: input.fabric, colours: input.colours, zari: input.zari, border: border === "" ? null : border, occasions: input.occasions, priceBand: input.priceBand, stockStatus: input.stockStatus, active: input.active, ...(price ? { price } : {}) });
    refresh(tenantId, itemId);
    return { ok: true, item };
  } catch (error) {
    return refused(error, t, price ? "price" : "save");
  }
}

/** Take a photo off its saree. The last photo of a saree that is shown cannot go. */
export async function removePhotoAction(tenantId: string, photoId: string): Promise<ItemOutcome> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(photoId)) return { ok: false, error: t("today.err.state"), stale: true };
  try {
    const item = await removeCataloguePhoto(user.accessToken, tenantId, photoId);
    refresh(tenantId, item.id);
    return { ok: true, item };
  } catch (error) {
    return refused(error, t, "remove");
  }
}

/** Put the saree's photos in a new order; the first is the cover. Every live photo exactly once. */
export async function reorderPhotosAction(tenantId: string, itemId: string, photoIds: string[]): Promise<ItemOutcome> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(itemId) || !Array.isArray(photoIds) || photoIds.length < 1 || photoIds.length > 8 || !photoIds.every(isCanonicalUuid) || new Set(photoIds).size !== photoIds.length) return { ok: false, error: t("catalogue.err.invalid") };
  try {
    const item = await reorderCataloguePhotos(user.accessToken, tenantId, itemId, photoIds);
    refresh(tenantId, itemId);
    return { ok: true, item };
  } catch (error) {
    return refused(error, t);
  }
}

/** Find a customer for "Send to a customer": by name or the end of a phone number. Only names, the city and the last four digits come back. */
export async function searchLeadsAction(tenantId: string, query: string): Promise<LeadSearchOutcome> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || typeof query !== "string") return { ok: false, error: t("catalogue.err.invalid") };
  if (query.trim().length < 2) return { ok: true, items: [] };
  try {
    const items = await searchLeads(user.accessToken, tenantId, query.trim().slice(0, 60));
    return { ok: true, items };
  } catch (error) {
    return refused(error, t, "search");
  }
}

/** Where a message stands, in a closed set the screen has a sentence for. Only a message the API says is "sent" is ever called sent. */
function standing(m: OutboxMessage, t: Ctx["t"], now: number): { state: "sent" | "queued" | "needs_approval" | "blocked"; text: string; why: string | null } {
  if (m.status === "sent") return { state: "sent", text: t("contact.state.sent"), why: null };
  if (m.status === "needs_approval") {
    const why = t(`catalogue.why.${(WHY_REASONS as readonly string[]).includes(m.reason) ? m.reason : "other"}` as "catalogue.why.other");
    return { state: "needs_approval", text: t("contact.state.needs"), why: t("catalogue.send.why", { why }) };
  }
  if (m.status === "queued") {
    const held = m.scheduled_for !== null && Date.parse(m.scheduled_for) > now;
    return { state: "queued", text: held ? t("contact.state.queued.time", { time: indiaClock(m.scheduled_for as string) }) : t("contact.state.queued"), why: null };
  }
  const key = m.status === "failed" ? "send_failed" : (BLOCK_REASONS as readonly string[]).includes(m.reason) ? m.reason : "other";
  return { state: "blocked", text: t("contact.state.blocked", { reason: t(`today.block.${key}` as "today.block.other") }), why: null };
}

/**
 * Send a saree's photos to a customer: ONE WhatsApp message with up to four of the saree's photos and the person's caption goes to the OUTBOX (`POST /outbox/messages`), where the shop's rules decide whether it goes now,
 * is held until the morning, waits for the owner or is blocked. Nothing is dispatched from here and no number is held. The same `messageId` is a retry. A rejected session goes to sign-in.
 */
export async function sendCatalogueAction(tenantId: string, input: SendInput): Promise<SendOutcome> {
  const { user, t } = await context();
  const text = typeof input?.text === "string" ? input.text.trim() : "";
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(input?.messageId) || !isCanonicalUuid(input?.itemId) || !isCanonicalUuid(input?.leadId)) return { ok: false, error: t("today.err.state"), stale: true };
  if (text.length < MIN_CAPTION || text.length > MAX_CAPTION) return { ok: false, error: t("contact.err.words") };
  const photos = input.photoIds;
  if (!Array.isArray(photos) || photos.length < 1 || photos.length > MAX_SEND_PHOTOS || !photos.every(isCanonicalUuid) || new Set(photos).size !== photos.length) return { ok: false, error: t("catalogue.err.send.photo") };
  if (!(OUTBOX_LANGUAGES as readonly string[]).includes(input.language)) return { ok: false, error: t("contact.err.invalid") };
  let message: OutboxMessage;
  try {
    ({ message } = await submitOutboxMessage(user.accessToken, tenantId, { messageId: input.messageId, leadId: input.leadId, text, language: input.language as OutboxLanguage, category: "info", photoIds: photos, keepRecord: input.keepRecord === true }));
  } catch (error) {
    return refused(error, t, "send");
  }
  const where = standing(message, t, Date.now());
  revalidatePath(`/app/tenants/${tenantId}`);
  revalidatePath(`/app/tenants/${tenantId}/outbox`);
  return { ok: true, state: where.state, text: where.text, why: where.why, recordText: input.keepRecord === true ? t("catalogue.record.on") : t("contact.record.off") };
}

/**
 * The extra fields of the business type for one catalogue item (job CL; Owner and Admin, like the item itself). The values are checked against the workspace's field definitions (a wrong one is a closed reason, nothing is
 * sent), then kept with `PUT .../catalogue/{id}/custom`. Our sentences only; never the API's text.
 */
export async function saveItemCustomAction(tenantId: string, itemId: string, values: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(itemId)) return { ok: false, error: t("catalogue.err.invalid") };
  let defs;
  try {
    defs = await listCustomFields(user.accessToken, tenantId, "catalogue_item");
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: t("fields.form.unsaved", { reason: t("fields.form.reason.unavailable") }) };
  }
  const { values: clean, issues } = normaliseValues(defs, "catalogue_item", values);
  const bad = Object.entries(issues)[0];
  if (bad) return { ok: false, error: `${defs.find((f) => f.code === bad[0])?.label.en ?? bad[0]} ${t(`fields.issue.${bad[1]}` as "fields.issue.required")}` };
  if (Object.keys(clean).length === 0) return { ok: true };
  try {
    await putCatalogueCustom(user.accessToken, tenantId, itemId, clean);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    const reason = error instanceof ApiRequestError && (error.status === 404 || error.status === 501 || error.code === "module_off") ? "unavailable" : error instanceof ApiRequestError && (error.status === 400 || error.status === 409 || error.status === 422) ? "invalid" : "failed";
    return { ok: false, error: t("fields.form.unsaved", { reason: t(`fields.form.reason.${reason}` as "fields.form.reason.failed") }) };
  }
}
