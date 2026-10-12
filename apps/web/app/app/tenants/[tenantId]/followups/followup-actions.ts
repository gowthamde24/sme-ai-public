"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { OUT_OF_DATE } from "@/lib/api/followup-text";
import {
  DIRECTIONS,
  DRAFT_CHANNELS,
  TOUCH_CHANNELS,
  approveDraft,
  approveQuestionDraft,
  createDraft,
  createPolicyVersion,
  discardDraft,
  discardQuestionDraft,
  recordSent,
  recordTouch,
  syncQuestionDrafts,
  type Direction,
  type DraftChannel,
  type TouchChannel,
} from "@/lib/api/followups";
import { requireUser } from "@/lib/auth/session";

import { errorState, policyFromForm, touchTime } from "./followup-logic";
import { serverT } from "@/i18n/server-t";
import { makeT, type Say } from "@/components/v2/app/words";

/** The outcome of a follow-up form: our own short sentence (never text from the API), and `stale` when the page must be read again. */
export type FollowupActionState = { ok?: boolean; error?: string; message?: string; stale?: boolean } | undefined;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
const trimmed = (formData: FormData, name: string) => field(formData, name).trim();

/** Every failure becomes ONE sentence of OUR wording, chosen by the API's closed code and reason. */
function failure(error: unknown, t: Say = makeT()): { ok: false; error: string; stale: boolean } {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) return { ok: false, ...errorState(error.status, error.code, error.reason, t) };
  return { ok: false, error: t("fu.could_not_save_try_again"), stale: false };
}

const leadPage = (tenantId: string, leadId: string) => `/app/tenants/${tenantId}/leads/${leadId}/followup`;

/** A person records "I sent it myself" (out) or "they replied" (in). Nothing is sent. An empty time means now; a future time is refused. */
export async function recordTouchAction(tenantId: string, leadId: string, _prev: FollowupActionState, formData: FormData): Promise<FollowupActionState> {
  const t = await serverT(["fu."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) return { ok: false, error: t("fu.not_available") };
  const id = trimmed(formData, "touch_id");
  const direction = trimmed(formData, "direction");
  const channel = trimmed(formData, "channel");
  if (!isCanonicalUuid(id)) return { ok: false, error: OUT_OF_DATE };
  if (!(DIRECTIONS as readonly string[]).includes(direction)) return { ok: false, error: t("fu.choose_what_you_are_recording_that") };
  if (!(TOUCH_CHANNELS as readonly string[]).includes(channel)) return { ok: false, error: t("fu.choose_the_channel") };
  const when = touchTime(trimmed(formData, "happened_at"), new Date(), t);
  if (!when.ok) return { ok: false, error: when.error };
  try {
    await recordTouch(user.accessToken, tenantId, leadId, { id, direction: direction as Direction, channel: channel as TouchChannel, ...(when.value ? { occurredAt: when.value } : {}) });
  } catch (error) {
    return failure(error, t);
  }
  revalidatePath(leadPage(tenantId, leadId));
  revalidatePath(`/app/tenants/${tenantId}/followups`);
  return { ok: true, message: direction === "out" ? t("fu.recorded_you_sent_it_yourself_nothing") : t("fu.recorded_they_replied") };
}

/** Ask for a follow-up DRAFT (the channel only: no wording, no contact). The database makes the closed text; a person approves it and sends it themselves. */
export async function createDraftAction(tenantId: string, leadId: string, _prev: FollowupActionState, formData: FormData): Promise<FollowupActionState> {
  const t = await serverT(["fu."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) return { ok: false, error: t("fu.not_available") };
  const id = trimmed(formData, "draft_id");
  const channel = trimmed(formData, "channel");
  if (!isCanonicalUuid(id)) return { ok: false, error: OUT_OF_DATE };
  if (!(DRAFT_CHANNELS as readonly string[]).includes(channel)) return { ok: false, error: t("fu.choose_e_mail_or_whatsapp") };
  let result;
  try {
    result = await createDraft(user.accessToken, tenantId, leadId, { id, channel: channel as DraftChannel });
  } catch (error) {
    return failure(error, t);
  }
  revalidatePath(leadPage(tenantId, leadId));
  revalidatePath(`/app/tenants/${tenantId}/followups`);
  return { ok: true, message: t("fu.draft_made", { n: result.touch_number }) };
}

/** Approve the draft the person REVIEWED: the form carries the draft's fingerprint as it was shown. A draft whose state moved since is refused as stale and the page is read again. */
export async function approveDraftAction(tenantId: string, leadId: string, draftId: string, _prev: FollowupActionState, formData: FormData): Promise<FollowupActionState> {
  const t = await serverT(["fu."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId) || !isCanonicalUuid(draftId)) return { ok: false, error: t("fu.not_available") };
  const stateHash = trimmed(formData, "state_hash");
  if (!/^[0-9a-f]{64}$/.test(stateHash)) return { ok: false, error: OUT_OF_DATE, stale: true };
  try {
    await approveDraft(user.accessToken, tenantId, draftId, stateHash);
  } catch (error) {
    revalidatePath(leadPage(tenantId, leadId));
    return failure(error, t);
  }
  revalidatePath(leadPage(tenantId, leadId));
  revalidatePath(`/app/tenants/${tenantId}/followups`);
  return { ok: true, message: t("fu.approved_copy_the_text_and_send") };
}

export async function discardDraftAction(tenantId: string, leadId: string, draftId: string): Promise<FollowupActionState> {
  const t = await serverT(["fu."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId) || !isCanonicalUuid(draftId)) return { ok: false, error: t("fu.not_available") };
  try {
    await discardDraft(user.accessToken, tenantId, draftId);
  } catch (error) {
    revalidatePath(leadPage(tenantId, leadId));
    return failure(error, t);
  }
  revalidatePath(leadPage(tenantId, leadId));
  revalidatePath(`/app/tenants/${tenantId}/followups`);
  return { ok: true, message: t("fu.discarded") };
}

/** "I sent it myself": a person's word about an APPROVED draft, recorded as an outbound touch. An empty time means now. */
export async function recordSentAction(tenantId: string, leadId: string, draftId: string, _prev: FollowupActionState, formData: FormData): Promise<FollowupActionState> {
  const t = await serverT(["fu."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId) || !isCanonicalUuid(draftId)) return { ok: false, error: t("fu.not_available") };
  const touchId = trimmed(formData, "touch_id");
  if (!isCanonicalUuid(touchId)) return { ok: false, error: OUT_OF_DATE };
  const when = touchTime(trimmed(formData, "happened_at"), new Date(), t);
  if (!when.ok) return { ok: false, error: when.error };
  try {
    await recordSent(user.accessToken, tenantId, draftId, { touchId, ...(when.value ? { occurredAt: when.value } : {}) });
  } catch (error) {
    revalidatePath(leadPage(tenantId, leadId));
    return failure(error, t);
  }
  revalidatePath(leadPage(tenantId, leadId));
  revalidatePath(`/app/tenants/${tenantId}/followups`);
  return { ok: true, message: t("fu.recorded_you_sent_it_yourself_nothing") };
}

/** The Owner (with the authenticator app) publishes a cadence policy version. */
export async function createPolicyAction(tenantId: string, _prev: FollowupActionState, formData: FormData): Promise<FollowupActionState> {
  const t = await serverT(["fu."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: t("fu.not_available") };
  const id = trimmed(formData, "policy_id");
  if (!isCanonicalUuid(id)) return { ok: false, error: OUT_OF_DATE };
  const values: Record<string, string> = {};
  for (const name of ["effective_from", "gap_days", "max_touches", "quiet_start", "quiet_end", "holidays", "min_gap_hours", "offset_minutes"]) values[name] = field(formData, name);
  const policy = policyFromForm(values, formData.getAll("weekday").filter((d): d is string => typeof d === "string"), id, t);
  if (!policy.ok) return { ok: false, error: policy.error };
  try {
    await createPolicyVersion(user.accessToken, tenantId, policy.input);
  } catch (error) {
    return failure(error, t);
  }
  revalidatePath(`/app/tenants/${tenantId}/followups/policy`);
  return { ok: true, message: t("fu.the_policy_is_published_it_applies") };
}

/** Store the clarifying questions the closed templates derive from the requirement now (nothing is sent: a person approves one, then copies it). */
export async function syncQuestionsAction(tenantId: string, requirementId: string): Promise<FollowupActionState> {
  const t = await serverT(["fu."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(requirementId)) return { ok: false, error: t("fu.not_available") };
  let changed;
  try {
    changed = (await syncQuestionDrafts(user.accessToken, tenantId, requirementId)).changed;
  } catch (error) {
    return failure(error, t);
  }
  revalidatePath(`/app/tenants/${tenantId}/requirements/${requirementId}/questions`);
  return { ok: true, message: changed === 0 ? t("fu.the_questions_are_up_to_date") : t("fu.the_questions_were_updated_from_the") };
}

export async function decideQuestionAction(tenantId: string, requirementId: string, draftId: string, decision: "approve" | "discard"): Promise<FollowupActionState> {
  const t = await serverT(["fu."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(requirementId) || !isCanonicalUuid(draftId)) return { ok: false, error: t("fu.not_available") };
  try {
    if (decision === "approve") await approveQuestionDraft(user.accessToken, tenantId, draftId);
    else await discardQuestionDraft(user.accessToken, tenantId, draftId);
  } catch (error) {
    revalidatePath(`/app/tenants/${tenantId}/requirements/${requirementId}/questions`);
    return failure(error, t);
  }
  revalidatePath(`/app/tenants/${tenantId}/requirements/${requirementId}/questions`);
  return { ok: true, message: decision === "approve" ? t("fu.approved_copy_it_and_ask_the") : t("fu.discarded") };
}
