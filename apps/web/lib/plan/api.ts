import type { BillingOut, MeterOut, PlanOut, PlansOut } from "@contracts/billing";

import { ApiContractError, apiRequest } from "@/lib/api/client";

import type { PlanCtx, WorkspacePlan } from "./types";

/**
 * The plans and billing endpoints of OUR API (job DI, docs/contracts/plans-billing.md), for the signed-in person's own token. SERVER ONLY. Answers are checked, not trusted: a body that is not the contracted shape is an
 * ApiContractError (the card then says "Not available yet"), never drawn. Nothing here knows a card number: the trial starts with a `checkout_ref` the payment provider's checkout produced (only the fake provider exists).
 */
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const numOrNull = (v: unknown): boolean => v === null || isNum(v);
const strOrNull = (v: unknown): boolean => v === undefined || v === null || isStr(v);

function validPlan(p: unknown): p is PlanOut {
  return (
    isRecord(p) &&
    isStr(p.id) &&
    (p.kind === "trial" || p.kind === "main" || p.kind === "calls") &&
    isNum(p.sort) &&
    isRecord(p.name) &&
    isStr(p.name.en) &&
    numOrNull(p.price_paise_monthly) &&
    isRecord(p.allowances) &&
    numOrNull(p.allowances.call_minutes) &&
    isNum(p.allowances.whatsapp_messages) &&
    isRecord(p.limits) &&
    isNum(p.limits.users) &&
    isNum(p.limits.workspaces)
  );
}
export function parsePlans(json: unknown): PlansOut {
  if (!isRecord(json) || !isRecord(json.trial) || !isNum(json.trial.days) || !isNum(json.trial.grace_days_after_failed_payment) || !Array.isArray(json.plans) || !json.plans.every(validPlan)) throw new ApiContractError("Unexpected /v1/plans response.");
  return json as unknown as PlansOut;
}

const METER_STATES = ["ok", "notice", "stopped"];
function validMeter(m: unknown): m is MeterOut {
  return isRecord(m) && isNum(m.used) && numOrNull(m.allowance) && typeof m.included === "boolean" && isStr(m.state) && METER_STATES.includes(m.state);
}
const STATUSES = ["trialing", "active", "past_due", "cancelled"];
export function parseBilling(json: unknown): BillingOut {
  const ok =
    isRecord(json) &&
    validPlan(json.plan) &&
    (json.subscription === null ||
      (isRecord(json.subscription) &&
        isStr(json.subscription.status) &&
        STATUSES.includes(json.subscription.status) &&
        isStr(json.subscription.plan_id) &&
        strOrNull(json.subscription.trial_ends_at) &&
        strOrNull(json.subscription.current_period_end) &&
        strOrNull(json.subscription.grace_until) &&
        typeof json.subscription.cancel_at_period_end === "boolean")) &&
    isRecord(json.period) &&
    isStr(json.period.end) &&
    /^\d{4}-\d{2}-\d{2}$/.test(json.period.end) &&
    isRecord(json.usage) &&
    validMeter(json.usage.call_minutes) &&
    validMeter(json.usage.whatsapp_messages) &&
    typeof json.can_start_trial === "boolean";
  if (!ok) throw new ApiContractError("Unexpected billing response.");
  return json as unknown as BillingOut;
}

/** What a meter includes: nothing (the plan leaves it out), no ceiling (pay as you go) or a count. */
const includedOf = (m: MeterOut): number | null => (m.included ? m.allowance : 0);

/** The API's answer as the screens read it. A cancelled subscription that never paid (its trial was cancelled) is "cancelled inside the trial". */
export function toWorkspacePlan(b: BillingOut): WorkspacePlan {
  const sub = b.subscription;
  const cancelledInTrial = sub?.status === "cancelled" && !!sub.trial_ends_at && !sub.current_period_end;
  return {
    planId: sub ? sub.plan_id : null,
    state: sub ? sub.status : "none",
    trialEndsAt: sub && (sub.status === "trialing" || cancelledInTrial) ? (sub.trial_ends_at ?? null) : null,
    cancelledInTrial,
    cancelAtPeriodEnd: !!sub && sub.cancel_at_period_end && (sub.status === "active" || sub.status === "past_due"),
    graceUntil: sub?.grace_until ?? null,
    periodEndsAt: `${b.period.end}T12:00:00+05:30`,
    canStartTrial: b.can_start_trial,
    usage: { minutes: b.usage.call_minutes.used, messages: b.usage.whatsapp_messages.used },
    included: { minutes: includedOf(b.usage.call_minutes), messages: includedOf(b.usage.whatsapp_messages) },
    paymentMethod: sub?.payment_method_on_file ? "test_ok" : "none",
  };
}

const tenantPath = (c: PlanCtx): string => `/v1/tenants/${encodeURIComponent(c.tenantId)}/billing`;
export const getPlans = async (c: PlanCtx): Promise<PlansOut> => parsePlans(await apiRequest("/v1/plans", c.token));
export const getBilling = async (c: PlanCtx): Promise<BillingOut> => parseBilling(await apiRequest(tenantPath(c), c.token));
export const postTrial = async (c: PlanCtx, planId: string, checkoutRef: string): Promise<BillingOut> =>
  parseBilling(await apiRequest(`${tenantPath(c)}/trial`, c.token, { method: "POST", body: JSON.stringify({ plan_id: planId, checkout_ref: checkoutRef }) }));
export const postCancel = async (c: PlanCtx): Promise<BillingOut> => parseBilling(await apiRequest(`${tenantPath(c)}/cancel`, c.token, { method: "POST", body: JSON.stringify({}) }));

/** The test choices the picker offers, and the checkout_ref the fake provider of the API knows each one by. */
export const CHECKOUT_REF: Record<string, string> = { test_ok: "pm_fake_ok", test_fails: "pm_fake_declines_on_renewal", test_declined: "pm_fake_declined" };
