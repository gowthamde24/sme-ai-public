import { notFound, redirect } from "next/navigation";
import type { ReactElement } from "react";

import { ApiDownV2 } from "@/components/v2/app/parts";
import { partsWords } from "@/i18n/app-words";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";
import { readPackCached } from "@/lib/packs/read";
import type { WorkspacePack } from "@/lib/packs/types";

type Tenant = Awaited<ReturnType<typeof fetchTenant>>;
export type LeadContext = { accessToken: string; userId: string; tenantId: string; tenant: Tenant; pack: WorkspacePack | null };
type Role = Tenant["role"];

/**
 * What every page of Lead Desk starts with (night 4): signed in, a member of this workspace, one of the roles the page allows (the others get the plain "not found" page, like a stranger), and the feature's flag ON (else the page is not
 * there: 404). A workspace that cannot be read gives the "could not load" page. The API and the database stay the real gate.
 */
export async function leadContext(tenantIdRaw: string, opts: { roles: readonly Role[]; on: boolean }): Promise<{ ok: true; ctx: LeadContext } | { ok: false; page: ReactElement }> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantIdRaw) || !opts.on) notFound();
  let tenant: Tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantIdRaw);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return { ok: false, page: <ApiDownV2 words={await partsWords()} /> };
  }
  if (!opts.roles.includes(tenant.role)) notFound();
  const pack = await readPackCached(user.accessToken, tenantIdRaw).catch(() => null);
  return { ok: true, ctx: { accessToken: user.accessToken, userId: user.id, tenantId: tenantIdRaw, tenant, pack } };
}
