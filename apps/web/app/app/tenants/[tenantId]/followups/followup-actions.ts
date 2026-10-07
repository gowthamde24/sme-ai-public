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

/** The outcome of a follow-up form: our own short sentence (never text from the API), and `stale` when the page must be read again. */
export type FollowupActionState = { ok?: boolean; error?: string; message?: string; stale?: boolean } | undefined;

const NOT_AVAILABLE = "This is not available.";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
const trimmed = (formData: FormData, name: string) => field(formData, name).trim();

/** Every failure becomes ONE sentence of OUR wording, chosen by the API's closed code and reason. */
function failure(error: unknown): { ok: false; error: string; stale: boolean } {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) return { ok: false, ...errorState(error.status, error.code, error.reason) };
  return { ok: false, error: "Could not save. Try again.", stale: false };
}

const leadPage = (tenantId: string, leadId: string) => `/app/tenants/${tenantId}/leads/${leadId}/followup`;

/** A person records "I sent it myself" (out) or "they replied" (in). Nothing is sent. An empty time means now; a future time is refused. */
export async function recordTouchAction(tenantId: string, leadId: string, _prev: FollowupActionState, formData: FormData): Promise<FollowupActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) return { ok: false, error: NOT_AVAILABLE };
  const id = trimmed(formData, "touch_id");
  const direction = trimmed(formData, "direction");
  const channel = trimmed(formData, "channel");
  if (!isCanonicalUuid(id)) return { ok: false, error: OUT_OF_DATE };
  if (!(DIRECTIONS as readonly string[]).includes(direction)) return { ok: false, error: "Choose what you are recording: that you sent something, or that they replied." };
  if (!(TOUCH_CHANNELS as readonly string[]).includes(channel)) return { ok: false, error: "Choose the channel." };
  const when = touchTime(trimmed(formData, "happened_at"), new Date());
  if (!when.ok) return { ok: false, error: when.error };
  try {
    await recordTouch(user.accessToken, tenantId, leadId, { id, direction: direction as Direction, channel: channel as TouchChannel, ...(when.value ? { occurredAt: when.value } : {}) });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(leadPage(tenantId, leadId));
  revalidatePath(`/app/tenants/${tenantId}/followups`);
  return { ok: true, message: direction === "out" ? "Recorded: you sent it yourself. Nothing was sent by this system." : "Recorded: they replied." };
}

/** Ask for a follow-up DRAFT (the channel only: no wording, no contact). The database makes the closed text; a person approves it and sends it themselves. */
export async function createDraftAction(tenantId: string, leadId: string, _prev: FollowupActionState, formData: FormData): Promise<FollowupActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) return { ok: false, error: NOT_AVAILABLE };
  const id = trimmed(formData, "draft_id");
  const channel = trimmed(formData, "channel");
  if (!isCanonicalUuid(id)) return { ok: false, error: OUT_OF_DATE };
  if (!(DRAFT_CHANNELS as readonly string[]).includes(channel)) return { ok: false, error: "Choose e-mail or WhatsApp." };
  let result;
  try {
    result = await createDraft(user.accessToken, tenantId, leadId, { id, channel: channel as DraftChannel });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(leadPage(tenantId, leadId));
  revalidatePath(`/app/tenants/${tenantId}/followups`);
  return { ok: true, message: `A draft for touch ${result.touch_number} was made. Read it, approve it, then send it yourself outside this system.` };
}

/** Approve the draft the person REVIEWED: the form carries the draft's fingerprint as it was shown. A draft whose state moved since is refused as stale and the page is read again. */
export async function approveDraftAction(tenantId: string, leadId: string, draftId: string, _prev: FollowupActionState, formData: FormData): Promise<FollowupActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId) || !isCanonicalUuid(draftId)) return { ok: false, error: NOT_AVAILABLE };
  const stateHash = trimmed(formData, "state_hash");
  if (!/^[0-9a-f]{64}$/.test(stateHash)) return { ok: false, error: OUT_OF_DATE, stale: true };
  try {
    await approveDraft(user.accessToken, tenantId, draftId, stateHash);
  } catch (error) {
    revalidatePath(leadPage(tenantId, leadId));
    return failure(error);
  }
  revalidatePath(leadPage(tenantId, leadId));
  revalidatePath(`/app/tenants/${tenantId}/followups`);
  return { ok: true, message: "Approved. Copy the text and send it yourself, then record that you sent it." };
}

export async function discardDraftAction(tenantId: string, leadId: string, draftId: string): Promise<FollowupActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId) || !isCanonicalUuid(draftId)) return { ok: false, error: NOT_AVAILABLE };
  try {
    await discardDraft(user.accessToken, tenantId, draftId);
  } catch (error) {
    revalidatePath(leadPage(tenantId, leadId));
    return failure(error);
  }
  revalidatePath(leadPage(tenantId, leadId));
  revalidatePath(`/app/tenants/${tenantId}/followups`);
  return { ok: true, message: "Discarded." };
}

/** "I sent it myself": a person's word about an APPROVED draft, recorded as an outbound touch. An empty time means now. */
export async function recordSentAction(tenantId: string, leadId: string, draftId: string, _prev: FollowupActionState, formData: FormData): Promise<FollowupActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId) || !isCanonicalUuid(draftId)) return { ok: false, error: NOT_AVAILABLE };
  const touchId = trimmed(formData, "touch_id");
  if (!isCanonicalUuid(touchId)) return { ok: false, error: OUT_OF_DATE };
  const when = touchTime(trimmed(formData, "happened_at"), new Date());
  if (!when.ok) return { ok: false, error: when.error };
  try {
    await recordSent(user.accessToken, tenantId, draftId, { touchId, ...(when.value ? { occurredAt: when.value } : {}) });
  } catch (error) {
    revalidatePath(leadPage(tenantId, leadId));
    return failure(error);
  }
  revalidatePath(leadPage(tenantId, leadId));
  revalidatePath(`/app/tenants/${tenantId}/followups`);
  return { ok: true, message: "Recorded: you sent it yourself. Nothing was sent by this system." };
}

/** The Owner (with the authenticator app) publishes a cadence policy version. */
export async function createPolicyAction(tenantId: string, _prev: FollowupActionState, formData: FormData): Promise<FollowupActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: NOT_AVAILABLE };
  const id = trimmed(formData, "policy_id");
  if (!isCanonicalUuid(id)) return { ok: false, error: OUT_OF_DATE };
  const values: Record<string, string> = {};
  for (const name of ["effective_from", "gap_days", "max_touches", "quiet_start", "quiet_end", "holidays", "min_gap_hours", "offset_minutes"]) values[name] = field(formData, name);
  const policy = policyFromForm(values, formData.getAll("weekday").filter((d): d is string => typeof d === "string"), id);
  if (!policy.ok) return { ok: false, error: policy.error };
  try {
    await createPolicyVersion(user.accessToken, tenantId, policy.input);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/app/tenants/${tenantId}/followups/policy`);
  return { ok: true, message: "The policy is published. It applies from the day you chose." };
}

/** Store the clarifying questions the closed templates derive from the requirement now (nothing is sent: a person approves one, then copies it). */
export async function syncQuestionsAction(tenantId: string, requirementId: string): Promise<FollowupActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(requirementId)) return { ok: false, error: NOT_AVAILABLE };
  let changed;
  try {
    changed = (await syncQuestionDrafts(user.accessToken, tenantId, requirementId)).changed;
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/app/tenants/${tenantId}/requirements/${requirementId}/questions`);
  return { ok: true, message: changed === 0 ? "The questions are up to date." : "The questions were updated from the requirement." };
}

export async function decideQuestionAction(tenantId: string, requirementId: string, draftId: string, decision: "approve" | "discard"): Promise<FollowupActionState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(requirementId) || !isCanonicalUuid(draftId)) return { ok: false, error: NOT_AVAILABLE };
  try {
    if (decision === "approve") await approveQuestionDraft(user.accessToken, tenantId, draftId);
    else await discardQuestionDraft(user.accessToken, tenantId, draftId);
  } catch (error) {
    revalidatePath(`/app/tenants/${tenantId}/requirements/${requirementId}/questions`);
    return failure(error);
  }
  revalidatePath(`/app/tenants/${tenantId}/requirements/${requirementId}/questions`);
  return { ok: true, message: decision === "approve" ? "Approved. Copy it and ask the customer yourself." : "Discarded." };
}
