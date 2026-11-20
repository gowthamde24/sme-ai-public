"use server";

import { revalidatePath } from "next/cache";

import type { Reply } from "@/components/v2/app/cc/kit";
import { getLang } from "@/i18n/get-lang";
import { ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { failureOf } from "@/lib/api/failure";
import { patchJob } from "@/lib/api/jobs";
import { submitOwnMessage, writeOwnMessage } from "@/lib/api/template-builder";
import { parseTotpCode } from "@/lib/auth/otp";
import { freshSecondStep } from "@/lib/auth/session";
import { jobsScreens } from "@/lib/screens/flag";
import { canSend } from "@/lib/templates/meta-checks";
import { DRAFT_TEXT_MAX, DRAFT_TEXT_MIN, readMessage, readSubmit, type DraftAnswer, type OwnMessage } from "@/lib/templates/types";

import { DECIDERS, invalid } from "../../retailers/finder-guard";
import { jobsWho } from "../../jobs/guard";
import { jobsRefusal } from "../../jobs/refusal";

/**
 * The own WhatsApp messages (JOBS, owner 19 Nov): Owner and Admin only. Writing a draft sends nothing anywhere. Sending to WhatsApp needs the person's two-step code, typed fresh and checked first (the same way Security checks a code before removing an authenticator:
 * `challengeAndVerify` on the person's own authenticator); a person with no authenticator is told to set one up, never let through. The text is checked again here (the checks of lib/templates/meta-checks.ts): a message that breaks one is not asked for.
 * With JOBS=mock the code only has to be six digits, nothing is verified, sent or saved.
 */
export async function writeOwnMessageAction(tenantId: string, text: string, previous: unknown): Promise<Reply<DraftAnswer>> {
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (typeof text !== "string" || text.trim().length < DRAFT_TEXT_MIN || text.length > DRAFT_TEXT_MAX * 2) return invalid(ctx.t);
  const before = previous === null || previous === undefined ? null : readMessage(previous);
  if (previous !== null && previous !== undefined && before === null) return invalid(ctx.t);
  try {
    return { ok: true, data: await writeOwnMessage(ctx.token, tenantId, { text, previous: before }) };
  } catch (error) {
    return failureOf(error, ctx.t);
  }
}

export async function submitOwnMessageAction(tenantId: string, input: unknown, code: string): Promise<Reply<OwnMessage>> {
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  const submit = readSubmit(input);
  const digits = parseTotpCode(typeof code === "string" ? code.replace(/\s/g, "") : "");
  if (!submit || !canSend(submit.message) || !digits) return invalid(ctx.t);
  let token = ctx.token;
  if (jobsScreens() !== "mock") {
    const step = await freshSecondStep(digits);
    if (!step.ok) return step.reason === "no_factor" ? { ok: false, kind: "mfa", mfa: true, error: ctx.t("jobs.tb.s5.no_factor") } : { ok: false, kind: "invalid", code: "bad_code", error: ctx.t("jobs.tb.s5.bad_code") };
    token = step.token; // the session now holds the fresh level: the API gets the token that carries it
  }
  try {
    const data = await submitOwnMessage(token, tenantId, submit);
    revalidatePath(`/app/tenants/${tenantId}/chats/templates`);
    return { ok: true, data };
  } catch (error) {
    // the API asks the second factor itself: a refusal says so in our words and links to Security
    if (error instanceof ApiRequestError && error.code === "mfa_required") return { ok: false, kind: "mfa", mfa: true, error: ctx.t("jobs.tb.s5.no_factor") };
    // `422 checks_failed`: the API ran the same rules and disagrees with ours. The owner changes the message and tries again; we log it (the code only, never the owner's words) so the two sets of rules can be brought together.
    if (error instanceof ApiRequestError && error.code === "checks_failed") {
      console.error("own message: our checks and the API's checks disagree (checks_failed); the owner was asked to change the message");
      return { ok: false, kind: "invalid", code: "checks_failed", error: ctx.t("jobs.tb.s5.checks_failed") };
    }
    return failureOf(error, ctx.t);
  }
}

/**
 * "Use it in a job": `PATCH /jobs/{id} {message_id: uuid | null}` (contract 1.1 part 1, A8). Only an APPROVED own message of a kind the job sends (offers, followups, store visits) is accepted; the API says no with `422 setting_invalid` (`fields: ["message_id"]`),
 * which is a plain "That did not work. Nothing was changed". `null` = back to the job's default approved message. Owner and Admin; with JOBS=mock nothing is stored.
 */
export async function useOwnMessageAction(tenantId: string, jobId: string, messageId: string | null): Promise<Reply<{ jobId: string; messageId: string | null }>> {
  const ctx = await jobsWho(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (typeof jobId !== "string" || !isCanonicalUuid(jobId) || (messageId !== null && !(typeof messageId === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(messageId)))) return invalid(ctx.t);
  try {
    await patchJob(ctx.token, tenantId, jobId, { messageId });
    revalidatePath(`/app/tenants/${tenantId}/jobs/${jobId}`);
    return { ok: true, data: { jobId, messageId } };
  } catch (error) {
    return jobsRefusal(error, ctx.t, await getLang());
  }
}
