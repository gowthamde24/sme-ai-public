import { redirect } from "next/navigation";

import type { Reply } from "@/components/v2/app/cc/kit";
import { appT, type AppT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { failureOf } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";
import { politeSentence } from "@/lib/lead-finder/types";
import { readEntitlements } from "@/lib/plan/tier-source";

/** The checks every change of the Prospects tab starts with, shared by its two action files (not a "use server" file: these are not actions). */
export type Role = "owner" | "admin" | "sales" | "viewer";
export const STAFF: readonly Role[] = ["owner", "admin", "sales"];
export const DECIDERS: readonly Role[] = ["owner", "admin"];
export type Refused = Extract<Reply<never>, { ok: false }>;

export async function who(tenantId: string, allowed: readonly Role[]): Promise<{ token: string; t: AppT } | Refused> {
  const user = await requireUser();
  const t = appT(await getLang());
  if (!isCanonicalUuid(tenantId)) return { ok: false, kind: "invalid", error: t("apierr.invalid") };
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (!(allowed as readonly string[]).includes(tenant.role)) return { ok: false, kind: "forbidden", error: t("apierr.forbidden") };
    // a Lead Desk plan (owner decision 4 Nov) has no Lead Finder: nothing of it runs from here, whatever the API would say (it refuses too: 403 not_in_plan)
    if (!(await readEntitlements(user.accessToken, tenantId)).features.leadFinder) return { ok: false, kind: "forbidden", error: t("tier.upsell.title") };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return failureOf(error, t);
  }
  return { token: user.accessToken, t };
}

/** A refusal in our words; the Lead Finder's own codes have sentences of their own. `not_a_search` shows the API's fixed sentence in English (it gives an example of what to say), else ours with the same example. */
export function refusal(error: unknown, t: AppT, lang: string): Refused {
  const f = failureOf(error, t);
  const api = error instanceof ApiRequestError ? error : null;
  if (f.code === "not_a_search") return { ...f, error: lang === "en" && api && api.message.length > 0 && api.message.length <= 300 ? api.message : t("lf.err.not_a_search") };
  if (f.code === "search_cap_reached") return { ...f, error: t("lf.err.cap") };
  if (f.code === "lead_finder_off" || f.code === "lead_finder_not_available") return { ...f, error: t("lf.err.off") };
  if (f.code === "not_in_plan") return { ...f, error: t("tier.upsell.title") };
  // a search for people ("parents in Anantapur", C1 #319, any business type): the API's polite sentence as it is; ours only when it gave none
  if (f.code === "individuals_not_allowed") return { ...f, error: politeSentence(api?.message) ?? t("lf.err.individuals") };
  if (f.code === "nothing_to_quote") return { ...f, error: t("lf.qd.err.nothing") };
  if (f.code === "quote_draft_exists") return { ...f, error: t("lf.qd.err.exists") };
  if (f.code === "not_qualified") return { ...f, error: t("lf.qd.err.not_qualified") };
  return f;
}
export const invalid = (t: AppT, key: Parameters<AppT>[0] = "apierr.invalid"): Refused => ({ ok: false, kind: "invalid", error: t(key) });
