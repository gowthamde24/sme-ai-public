import { notFound, redirect } from "next/navigation";
import type { ReactElement } from "react";

import { ApiDownV2 } from "@/components/v2/app/parts";
import { appDict } from "@/i18n/app";
import { partsWords } from "@/i18n/app-words";
import type { Lang } from "@/i18n/lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";
import { hasModule } from "@/lib/packs/has";
import { readPackCached } from "@/lib/packs/read";
import type { WorkspacePack } from "@/lib/packs/types";

type Tenant = Awaited<ReturnType<typeof fetchTenant>>;
export type EduContext = { accessToken: string; tenantId: string; tenant: Tenant; pack: WorkspacePack | null };

/**
 * What every page of the education screens starts with (job CS): the person must be signed in and a member who may read students (Owner, Admin, Sales; a Viewer gets the plain "not found" page, like a stranger: the API and the database
 * refuse a Viewer any child), the workspace must be one they can see, and the business type must have the module the screen needs (`programmes`, and `fees` for money). The module guard of the workspace's template says the same
 * for the menu's pages; this is the second lock. A workspace that cannot be read gives the "could not load" page.
 */
export async function eduContext(tenantIdRaw: string, needs: "programmes" | "fees" = "programmes"): Promise<{ ok: true; ctx: EduContext } | { ok: false; page: ReactElement }> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantIdRaw)) notFound();
  let tenant: Tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantIdRaw);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return { ok: false, page: <ApiDownV2 words={await partsWords()} /> };
  }
  if (tenant.role === "viewer") notFound();
  const pack = await readPackCached(user.accessToken, tenantIdRaw).catch(() => null);
  if (!hasModule(pack, needs)) notFound();
  return { ok: true, ctx: { accessToken: user.accessToken, tenantId: tenantIdRaw, tenant, pack } };
}

/** The words of the education screens in the person's language: every `edu.*`, `fee.*` and `due.*` string, the refusals, the campaign words an announcement needs and the few words they reuse. Resolved on the server and handed down as props. */
export function eduWords(lang: Lang): Record<string, string> {
  const dict = appDict(lang) as Record<string, string>;
  const keep = (k: string) =>
    k.startsWith("edu.") || k.startsWith("fee.") || k.startsWith("due.") || k.startsWith("today.err.") || k.startsWith("today.lang.") || k.startsWith("camp.") || k.startsWith("dta.") || k.startsWith("rep.") ||
    ["today.act.working", "today.act.cancel", "frame.notyet", "mat.products.more", "mat.err.moduleoff", "mat.pdf.print", "mat.pdf.hint", "mat.s.inwords", "nav.item.fees", "nav.item.students", "nav.item.programmes", "nav.item.admissions", "nav.item.announcements", "nav.item.campaigns"].includes(k);
  return Object.fromEntries(Object.entries(dict).filter(([k]) => keep(k)));
}

export { ApiAuthError };

/**
 * Why an education step was refused, as ONE sentence of OUR wording chosen by the API's closed status and code. Nothing from the server's text is shown. `mfa` = the second factor is missing (the screen points at the Security page).
 * A rejected session is thrown again so the caller can send the person to sign in.
 */
export type EduRefusal = { key: string; mfa?: boolean };
const BY_CODE: Record<string, EduRefusal> = {
  mfa_required: { key: "today.err.mfa", mfa: true },
  forbidden: { key: "today.err.role" },
  module_off: { key: "mat.err.moduleoff" },
  admission_no_used: { key: "edu.err.admissionno" },
  admission_stage: { key: "edu.err.stage" },
  fee_plan_in_use: { key: "edu.err.planinuse" },
  fee_plan_exists: { key: "edu.err.planexists" },
  student_not_active: { key: "edu.err.notactive" },
  validation_error: { key: "edu.err.invalid" },
  invalid_reference: { key: "edu.err.invalid" },
  education_unavailable: { key: "edu.err.unavailable" },
  reports_unavailable: { key: "edu.err.unavailable" },
};
export function eduRefusalOf(error: unknown): EduRefusal {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    const known = BY_CODE[error.code];
    if (known) return known;
    if (error.status === 403) return { key: "today.err.role" };
    if (error.status === 404 || error.status === 409) return { key: "today.err.state" };
    if (error.status === 422) return { key: "edu.err.invalid" };
    if (error.status === 503) return { key: "edu.err.unavailable" };
  }
  return { key: "today.err.generic" };
}
