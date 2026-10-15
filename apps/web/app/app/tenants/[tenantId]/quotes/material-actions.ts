"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { CalcOut, OrderCreatedOut } from "@contracts";

import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { REJECT_CODES, approveMaterialQuote, draftMaterialQuote, getMaterialQuoteText, orderFromMaterialQuote, previewMaterialQuote, rejectMaterialQuote, type RejectCode } from "@/lib/api/materials";
import { requireUser } from "@/lib/auth/session";

import { materialRefusalOf } from "./material-refusals";

export type Refused = { ok: false; error: string; mfa?: boolean; stale?: boolean; owner?: boolean };
export type PickInput = { line_no: number; item_id: string };

async function context() {
  const user = await requireUser();
  const lang = await getLang();
  return { user, t: appT(lang), lang };
}
type Ctx = Awaited<ReturnType<typeof context>>;

function refused(error: unknown, t: Ctx["t"]): Refused {
  try {
    const r = materialRefusalOf(error);
    return { ok: false, error: t(r.key as "today.err.generic"), ...(r.mfa ? { mfa: true } : {}), ...(r.stale ? { stale: true } : {}), ...(r.owner ? { owner: true } : {}) };
  } catch (e) {
    if (e instanceof ApiAuthError) redirect("/login");
    throw e;
  }
}

const picksOk = (picks: unknown): picks is PickInput[] =>
  Array.isArray(picks) && picks.length >= 1 && picks.length <= 5 && picks.every((p) => p && Number.isInteger(p.line_no) && p.line_no >= 1 && p.line_no <= 5 && isCanonicalUuid(p.item_id)) && new Set(picks.map((p) => p.line_no)).size === picks.length;

const refresh = (tenantId: string, quoteId?: string) => {
  revalidatePath(`/app/tenants/${tenantId}/quotes`);
  if (quoteId) revalidatePath(`/app/tenants/${tenantId}/quotes/${quoteId}`);
};

/** The figures the database would use, run through the calculator. Nothing is stored. Owner, Admin, Sales. */
export async function previewMaterialQuoteAction(tenantId: string, requirementId: string, picks: PickInput[], siteId: string | null): Promise<{ ok: true; result: CalcOut; databaseAgrees: boolean; validUntil: string } | Refused> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(requirementId) || !picksOk(picks) || (siteId !== null && !isCanonicalUuid(siteId))) return { ok: false, error: t("mat.err.invalid") };
  try {
    const out = await previewMaterialQuote(user.accessToken, tenantId, requirementId, picks, siteId);
    return { ok: true, result: out.result, databaseAgrees: out.database_agrees, validUntil: out.valid_until };
  } catch (error) {
    return refused(error, t);
  }
}

/** Keep the previewed quote as a draft. The id is the page's, so a second press is a retry. A draft is not sent and not approved: it waits for the Owner or an Admin. */
export async function draftMaterialQuoteAction(tenantId: string, requirementId: string, quoteId: string, picks: PickInput[], siteId: string | null): Promise<{ ok: true; quoteId: string } | Refused> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(requirementId) || !isCanonicalUuid(quoteId) || !picksOk(picks) || (siteId !== null && !isCanonicalUuid(siteId))) return { ok: false, error: t("mat.err.invalid") };
  try {
    const { quote } = await draftMaterialQuote(user.accessToken, tenantId, requirementId, quoteId, picks, siteId);
    refresh(tenantId, quote.id);
    return { ok: true, quoteId: quote.id };
  } catch (error) {
    return refused(error, t);
  }
}

/** Approve a draft: Owner or Admin with the second factor; a quote with a flag is the Owner's alone (the API decides). Approving sends nothing to the customer. */
export async function approveMaterialQuoteAction(tenantId: string, quoteId: string): Promise<{ ok: true } | Refused> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(quoteId)) return { ok: false, error: t("mat.err.invalid") };
  try {
    await approveMaterialQuote(user.accessToken, tenantId, quoteId);
    refresh(tenantId, quoteId);
    return { ok: true };
  } catch (error) {
    return refused(error, t);
  }
}

/** Turn a draft down with a reason from a closed list. Owner, Admin, Sales. */
export async function rejectMaterialQuoteAction(tenantId: string, quoteId: string, code: string): Promise<{ ok: true } | Refused> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(quoteId) || !(REJECT_CODES as readonly string[]).includes(code)) return { ok: false, error: t("mat.err.invalid") };
  try {
    await rejectMaterialQuote(user.accessToken, tenantId, quoteId, code as RejectCode);
    refresh(tenantId, quoteId);
    return { ok: true };
  } catch (error) {
    return refused(error, t);
  }
}

/** Make an order from an approved quote. The id is the page's, so a second press is a retry. The answer carries a credit warning when the customer would go over the credit limit: a warning, never a block. */
export async function orderFromMaterialQuoteAction(tenantId: string, quoteId: string, orderId: string): Promise<{ ok: true; order: OrderCreatedOut } | Refused> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(quoteId) || !isCanonicalUuid(orderId)) return { ok: false, error: t("mat.err.invalid") };
  try {
    const order = await orderFromMaterialQuote(user.accessToken, tenantId, quoteId, orderId);
    refresh(tenantId, quoteId);
    revalidatePath(`/app/tenants/${tenantId}/orders`);
    return { ok: true, order };
  } catch (error) {
    return refused(error, t);
  }
}

/** The WhatsApp message of a quote in one language (a copy for the owner to send; every language but English is a draft until a person has read it). */
export async function materialQuoteTextAction(tenantId: string, quoteId: string, language: string): Promise<{ ok: true; text: string; reviewed: boolean } | Refused> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(quoteId) || !["en", "te", "hi", "kn", "ta"].includes(language)) return { ok: false, error: t("mat.err.invalid") };
  try {
    const out = await getMaterialQuoteText(user.accessToken, tenantId, quoteId, language as "en");
    return { ok: true, text: out.text, reviewed: out.language_review === "reviewed" };
  } catch (error) {
    return refused(error, t);
  }
}
