"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { CampaignFormInput } from "@/components/v2/app/campaigns/CampaignForm";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import {
  KINDS, LANGUAGES, MAX_PAISE, MAX_ROWS, OUTCOMES, addRecipients, addRecipientsFromLedger, approveCampaign, clearRecipients, connectCall, putCampaign, recordOutcome, removeRecipient, setCampaignState,
  type LedgerFilter, type Outcome, type RecipientRow,
} from "@/lib/api/campaigns";
import { requireUser } from "@/lib/auth/session";

import { campaignRefusalOf } from "./campaign-refusals";

type Failed = { ok: false; error: string; mfa?: boolean; changed?: boolean };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (v: unknown): v is string => typeof v === "string" && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

async function context() {
  const user = await requireUser();
  return { user, t: appT(await getLang()) };
}
function failed(error: unknown, t: Awaited<ReturnType<typeof context>>["t"]): Failed {
  try {
    const r = campaignRefusalOf(error);
    return { ok: false, error: t(r.key as "today.err.generic"), ...(r.mfa ? { mfa: true } : {}), ...(r.changed ? { changed: true } : {}) };
  } catch (e) {
    if (e instanceof ApiAuthError) redirect("/login");
    throw e;
  }
}
const refresh = (tenantId: string, campaignId?: string) => {
  revalidatePath(`/app/tenants/${tenantId}/campaigns`);
  if (campaignId) revalidatePath(`/app/tenants/${tenantId}/campaigns/${campaignId}`);
};

/** Make or change a campaign (Owner, Admin, Sales). The id is the page's, so a second press is a retry. Changing an approved campaign sends it back to draft: the answer says so. */
export async function saveCampaignAction(tenantId: string, campaignId: string, input: CampaignFormInput): Promise<{ ok: true; campaignId: string; backToDraft: boolean } | Failed> {
  const { user, t } = await context();
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const text = typeof input?.messageText === "string" ? input.messageText.trim() : "";
  const steps = Array.isArray(input?.steps) ? input.steps : [];
  const ok =
    isCanonicalUuid(tenantId) && isCanonicalUuid(campaignId) && name.length >= 1 && name.length <= 100 && (KINDS as readonly string[]).includes(input.kind) && (LANGUAGES as readonly string[]).includes(input.language) &&
    text.length >= 8 && text.length <= 600 && steps.length >= 1 && steps.length <= 5 && steps.every((s) => Number.isInteger(s?.offset_days) && s.offset_days >= -60 && s.offset_days <= 180 && CLOCK.test(s.time)) &&
    (input.callAfterStep === null || (Number.isInteger(input.callAfterStep) && input.callAfterStep >= 1 && input.callAfterStep <= steps.length)) && Number.isInteger(input.callWaitHours) && input.callWaitHours >= 1 && input.callWaitHours <= 168 &&
    (input.waTemplateId === null || isCanonicalUuid(input.waTemplateId));
  if (!ok) return { ok: false, error: t("camp.err.invalid") };
  try {
    const out = await putCampaign(user.accessToken, tenantId, campaignId, { ...input, name, messageText: text });
    refresh(tenantId, out.campaign.id);
    return { ok: true, campaignId: out.campaign.id, backToDraft: out.back_to_draft };
  } catch (error) {
    return failed(error, t);
  }
}

type Added = { ok: true; added: number; skipped: { row: number; reason: string }[]; recipients: number } | Failed;

/** Add everyone with money open on claims due in a range (the amount and date come from the ledger, checked again before each message). */
export async function addFromLedgerAction(tenantId: string, campaignId: string, filter: LedgerFilter): Promise<Added> {
  const { user, t } = await context();
  const ok =
    isCanonicalUuid(tenantId) && isCanonicalUuid(campaignId) && validDay(filter?.due_from) && validDay(filter?.due_to) && filter.due_from <= filter.due_to && (filter.party === undefined || filter.party === "company" || filter.party === "contact") &&
    (filter.min_open_paise === undefined || (Number.isInteger(filter.min_open_paise) && filter.min_open_paise >= 0 && filter.min_open_paise <= MAX_PAISE));
  if (!ok) return { ok: false, error: t("camp.err.invalid") };
  try {
    const out = await addRecipientsFromLedger(user.accessToken, tenantId, campaignId, { due_from: filter.due_from, due_to: filter.due_to, ...(filter.party ? { party: filter.party } : {}), ...(filter.min_open_paise ? { min_open_paise: filter.min_open_paise } : {}) });
    refresh(tenantId, campaignId);
    return { ok: true, ...out };
  } catch (error) {
    return failed(error, t);
  }
}

/** Add a list of people, one per line (checked again here: the browser's reading is not trusted). A line that cannot be added is reported, never fatal. */
export async function importRecipientsAction(tenantId: string, campaignId: string, rows: RecipientRow[]): Promise<Added> {
  const { user, t } = await context();
  const good = (r: RecipientRow) =>
    validDay(r?.due_date) && ((typeof r.contact_id === "string" && isCanonicalUuid(r.contact_id)) !== (typeof r.phone === "string" && r.phone.length > 0 && r.phone.length <= 20)) &&
    (r.amount_paise === undefined || (Number.isInteger(r.amount_paise) && r.amount_paise >= 1 && r.amount_paise <= MAX_PAISE)) && (r.reference === undefined || (typeof r.reference === "string" && r.reference.length <= 60));
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(campaignId) || !Array.isArray(rows) || rows.length < 1 || rows.length > MAX_ROWS || !rows.every(good)) return { ok: false, error: t("camp.err.invalid") };
  try {
    const out = await addRecipients(user.accessToken, tenantId, campaignId, rows.map((r) => ({ ...(r.contact_id ? { contact_id: r.contact_id } : { phone: r.phone as string }), due_date: r.due_date, ...(r.amount_paise !== undefined ? { amount_paise: r.amount_paise } : {}), ...(r.reference ? { reference: r.reference } : {}) })));
    refresh(tenantId, campaignId);
    return { ok: true, ...out };
  } catch (error) {
    return failed(error, t);
  }
}

export async function clearRecipientsAction(tenantId: string, campaignId: string): Promise<{ ok: true; removed: number } | Failed> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(campaignId)) return { ok: false, error: t("camp.err.invalid") };
  try {
    const removed = await clearRecipients(user.accessToken, tenantId, campaignId);
    refresh(tenantId, campaignId);
    return { ok: true, removed };
  } catch (error) {
    return failed(error, t);
  }
}

export async function removeRecipientAction(tenantId: string, campaignId: string, recipientId: string): Promise<{ ok: true } | Failed> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(campaignId) || !isCanonicalUuid(recipientId)) return { ok: false, error: t("camp.err.invalid") };
  try {
    await removeRecipient(user.accessToken, tenantId, campaignId, recipientId);
    refresh(tenantId, campaignId);
    return { ok: true };
  } catch (error) {
    return failed(error, t);
  }
}

/** Approve the campaign (the Owner's alone, with the second factor), once, for the samples the Owner saw: the hash of them rides along, so a campaign that changed since is refused. Approving sends nothing by itself. */
export async function approveCampaignAction(tenantId: string, campaignId: string, samplesSha256: string): Promise<{ ok: true; planned: number; past: number; sendingOn: boolean } | Failed> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(campaignId) || typeof samplesSha256 !== "string" || !/^[0-9a-f]{64}$/.test(samplesSha256)) return { ok: false, error: t("camp.err.invalid") };
  try {
    const out = await approveCampaign(user.accessToken, tenantId, campaignId, samplesSha256);
    refresh(tenantId, campaignId);
    return { ok: true, planned: out.planned_steps, past: out.past_steps, sendingOn: out.sending_on };
  } catch (error) {
    return failed(error, t);
  }
}

export async function campaignStateAction(tenantId: string, campaignId: string, action: "pause" | "resume" | "cancel"): Promise<{ ok: true } | Failed> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(campaignId) || !["pause", "resume", "cancel"].includes(action)) return { ok: false, error: t("camp.err.invalid") };
  try {
    await setCampaignState(user.accessToken, tenantId, campaignId, action);
    refresh(tenantId, campaignId);
    return { ok: true };
  } catch (error) {
    return failed(error, t);
  }
}

export type OutcomeInput = { outcome: Outcome; promisedOn?: string | null; callAfter?: string | null };

/** Write down how a call went. The id of the item is the page's, so a second press is a retry (the API answers the same). */
export async function callOutcomeAction(tenantId: string, itemId: string, input: OutcomeInput): Promise<{ ok: true } | Failed> {
  const { user, t } = await context();
  const ok =
    isCanonicalUuid(tenantId) && isCanonicalUuid(itemId) && (OUTCOMES as readonly string[]).includes(input?.outcome) && (input.outcome === "promised" ? validDay(input.promisedOn) : !input.promisedOn) &&
    (input.outcome === "call_later" ? typeof input.callAfter === "string" && !Number.isNaN(Date.parse(input.callAfter)) : !input.callAfter);
  if (!ok) return { ok: false, error: t("camp.err.invalid") };
  try {
    await recordOutcome(user.accessToken, tenantId, itemId, input);
    revalidatePath(`/app/tenants/${tenantId}/call-list`);
    return { ok: true };
  } catch (error) {
    return failed(error, t);
  }
}

/** Ring the shop's own phone first, then the customer's (the bridge). Owner and Admin only; only 9 am to 9 pm India time. The number is never shown. */
export async function connectCallAction(tenantId: string, callRequestId: string): Promise<{ ok: true; replayed: boolean } | Failed> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(callRequestId)) return { ok: false, error: t("camp.err.invalid") };
  try {
    const out = await connectCall(user.accessToken, tenantId, callRequestId);
    return { ok: true, replayed: out.replayed };
  } catch (error) {
    return failed(error, t);
  }
}
