"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { createQuotePolicyVersion } from "@/lib/api/quote-policies";
import { formatDate } from "@/lib/api/quotes";
import { requireUser } from "@/lib/auth/session";

import { todayInIndia } from "../followups/page-parts";
import { EMPTY_VALUES, FIELD_NAMES, OUT_OF_DATE, policyFromForm, publishRefusal, publishedSentence, type PolicyValues } from "./quote-policy-logic";

/**
 * What the form shows after a press: `ok` with ONE sentence of our wording that names the version and its start date, or a refusal sentence of our wording (with `reason: "mfa"` when the screen should
 * point at the second-factor page). Never text from the API, never anything the person typed.
 */
export type QuotePolicyState = { ok?: boolean; error?: string; reason?: "mfa"; message?: string } | undefined;

const NOT_AVAILABLE = "This workspace is not available.";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * An Owner or Admin publishes a new quote policy version. The server reads ONLY the eight typed fields and the page's id, whatever else the request carries; the shipping is fixed at zero when the
 * request body is built (lib/api/quote-policies.ts), never read from the form. Each number is converted exactly and checked here again, before any request; the API and the database then decide every rule once more (the role,
 * the second factor, the limits, the start date). The id comes from the page, so an identical retry replays.
 */
export async function publishQuotePolicyAction(tenantId: string, _prev: QuotePolicyState, formData: FormData): Promise<QuotePolicyState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: NOT_AVAILABLE };
  const id = text(formData, "policy_id").trim();
  if (!isCanonicalUuid(id)) return { ok: false, error: OUT_OF_DATE };
  const values = { ...EMPTY_VALUES } as PolicyValues;
  for (const name of FIELD_NAMES) values[name] = text(formData, name);
  const policy = policyFromForm(values, id, todayInIndia(new Date()));
  if (!policy.ok) return { ok: false, error: policy.error };
  let done;
  try {
    done = await createQuotePolicyVersion(user.accessToken, tenantId, policy.input);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError) return { ok: false, ...publishRefusal(error.status, error.code) };
    return { ok: false, ...publishRefusal(500, "") };
  }
  revalidatePath(`/app/tenants/${tenantId}/quote-policy`);
  return { ok: true, message: publishedSentence(done.version_no, done.effective_from, done.replayed, formatDate) };
}
