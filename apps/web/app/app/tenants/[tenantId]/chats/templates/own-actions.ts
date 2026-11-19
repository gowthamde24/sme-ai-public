"use server";

import { revalidatePath } from "next/cache";

import type { Reply } from "@/components/v2/app/cc/kit";
import { ApiRequestError } from "@/lib/api/client";
import { failureOf } from "@/lib/api/failure";
import { submitOwnMessage, writeOwnMessage } from "@/lib/api/template-builder";
import { parseTotpCode } from "@/lib/auth/otp";
import { freshSecondStep } from "@/lib/auth/session";
import { jobsScreens } from "@/lib/screens/flag";
import { canSend } from "@/lib/templates/meta-checks";
import { DRAFT_TEXT_MAX, DRAFT_TEXT_MIN, readMessage, readSubmit, type DraftAnswer, type OwnMessage } from "@/lib/templates/types";

import { DECIDERS, invalid } from "../../retailers/finder-guard";
import { jobsWho } from "../../jobs/guard";

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
    return failureOf(error, ctx.t);
  }
}
