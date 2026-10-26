import { notFound, redirect } from "next/navigation";
import type { ReactElement } from "react";

import { ApiDownV2 } from "@/components/v2/app/parts";
import { partsWords } from "@/i18n/app-words";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";
import { leadsScreens } from "@/lib/screens/flag";

type Tenant = Awaited<ReturnType<typeof fetchTenant>>;
export type LeadDeskContext = { accessToken: string; tenantId: string; tenant: Tenant; role: Tenant["role"] };

/**
 * What the import page and the lead sources page start with (night 4, Lead Desk): the person must be signed in and a member of the workspace, LEADS_SCREENS must be on (a page behind a flag answers `notFound()` itself
 * when it is off), and the role must be one of `roles` (anyone else gets the plain "not found" page, like a stranger; the API is the real gate). A workspace that cannot be read gives the "could not load" page.
 */
export async function leadDeskContext(tenantIdRaw: string, roles: readonly string[]): Promise<{ ok: true; ctx: LeadDeskContext } | { ok: false; page: ReactElement }> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantIdRaw) || leadsScreens() === "off") notFound();
  let tenant: Tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantIdRaw);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return { ok: false, page: <ApiDownV2 words={await partsWords()} /> };
  }
  if (!roles.includes(tenant.role)) notFound();
  return { ok: true, ctx: { accessToken: user.accessToken, tenantId: tenantIdRaw, tenant, role: tenant.role } };
}
