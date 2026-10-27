"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { parseBatchInput, parseRuleInput } from "@/lib/outreach/input";
import { approve, controlBatch, controlRule, excludeContacts, makeBatch, markActed, outreachMode, saveRule, type Ctx } from "@/lib/outreach/source";
import type { BatchAnswer, Done, Rule } from "@/lib/outreach/types";

/**
 * The changes of the speed-to-lead screens (night 4, part A3): a batch plan, leaving people out of it, ONE approval for everybody, pause, resume, cancel; a standing rule per lead source; a hand-off marked done. Each checks who is
 * asking (the role in this workspace; the API checks it again and asks the second factor for an approval), refuses while the flag is off, and answers in the closed words of `Refusal`. Nothing here sends or calls: that is the worker's, behind the outbox.
 */
type Role = "owner" | "admin" | "sales" | "viewer";
const STAFF: readonly Role[] = ["owner", "admin", "sales"];
const DECIDERS: readonly Role[] = ["owner", "admin"];
const OWNER: readonly Role[] = ["owner"];

async function who(tenantId: string, allowed: readonly Role[]): Promise<Ctx | null> {
  const user = await requireUser();
  if (outreachMode() === "off" || !isCanonicalUuid(tenantId)) return null;
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    return (allowed as readonly string[]).includes(tenant.role) ? { token: user.accessToken, tenantId, userId: user.id } : null;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}
const refuse = <T>(): Done<T> => ({ ok: false, error: "not_available" });
const touch = (tenantId: string) => revalidatePath(`/app/tenants/${tenantId}/outreach`);

/** Make the plan of a batch (a draft: nothing is called or sent until it is approved). The client chooses `batchId`, so a retry is the same plan. */
export async function planBatchAction(tenantId: string, input: unknown): Promise<Done<BatchAnswer>> {
  const ctx = await who(tenantId, STAFF);
  if (!ctx) return refuse();
  const parsed = parseBatchInput(input);
  if (!parsed) return { ok: false, error: "invalid" };
  const out = await makeBatch(ctx, parsed);
  if (out.ok) touch(tenantId);
  return out;
}

export async function excludeAction(tenantId: string, batchId: string, contactId: string, excluded: boolean): Promise<Done<BatchAnswer>> {
  const ctx = await who(tenantId, DECIDERS);
  if (!ctx || !isCanonicalUuid(batchId) || !isCanonicalUuid(contactId) || typeof excluded !== "boolean") return refuse();
  const out = await excludeContacts(ctx, batchId, [contactId], excluded);
  if (out.ok) touch(tenantId);
  return out;
}

/** The ONE approval: the Owner, with the second factor; `planSha256` binds it to exactly the plan that was shown. */
export async function approveBatchAction(tenantId: string, batchId: string, planSha256: string): Promise<Done<BatchAnswer>> {
  const ctx = await who(tenantId, OWNER);
  if (!ctx || !isCanonicalUuid(batchId) || typeof planSha256 !== "string" || planSha256.length < 8 || planSha256.length > 128) return refuse();
  const out = await approve(ctx, batchId, planSha256);
  if (out.ok) touch(tenantId);
  return out;
}

export async function batchControlAction(tenantId: string, batchId: string, action: "pause" | "resume" | "cancel"): Promise<Done<BatchAnswer>> {
  const ctx = await who(tenantId, action === "cancel" ? OWNER : DECIDERS);
  if (!ctx || !isCanonicalUuid(batchId) || !["pause", "resume", "cancel"].includes(action)) return refuse();
  const out = await controlBatch(ctx, batchId, action);
  if (out.ok) touch(tenantId);
  return out;
}

/** A standing rule per lead source ("call new leads within 2 minutes in calling hours"): approved ONCE by the Owner, then nobody clicks per lead. */
export async function saveRuleAction(tenantId: string, input: unknown): Promise<Done<Rule>> {
  const ctx = await who(tenantId, OWNER);
  if (!ctx) return refuse();
  const parsed = parseRuleInput(input);
  if (!parsed) return { ok: false, error: "invalid" };
  const out = await saveRule(ctx, parsed);
  if (out.ok) touch(tenantId);
  return out;
}

export async function ruleControlAction(tenantId: string, ruleId: string, action: "pause" | "resume"): Promise<Done<Rule>> {
  const ctx = await who(tenantId, DECIDERS);
  if (!ctx || !isCanonicalUuid(ruleId) || !["pause", "resume"].includes(action)) return refuse();
  const out = await controlRule(ctx, ruleId, action);
  if (out.ok) touch(tenantId);
  return out;
}

export async function handoffActedAction(tenantId: string, handoffId: string): Promise<Done<true>> {
  const ctx = await who(tenantId, STAFF);
  if (!ctx || typeof handoffId !== "string" || handoffId.length > 64) return refuse();
  const out = await markActed(ctx, handoffId);
  if (out.ok) {
    revalidatePath(`/app/tenants/${tenantId}/outreach`);
    revalidatePath(`/app/tenants/${tenantId}/lead-desk`);
  }
  return out;
}
