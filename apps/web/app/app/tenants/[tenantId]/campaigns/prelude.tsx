import { notFound, redirect } from "next/navigation";
import type { ReactElement } from "react";

import { ApiDownV2 } from "@/components/v2/app/parts";
import { partsWords } from "@/i18n/app-words";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";
import type { WorkspacePack } from "@/lib/packs/types";
import { readPackCached } from "@/lib/packs/read";

type Tenant = Awaited<ReturnType<typeof fetchTenant>>;
export type CampaignContext = { accessToken: string; tenantId: string; tenant: Tenant; pack: WorkspacePack | null };

/**
 * What every page of the campaign screens starts with (job CQ): the person must be signed in and a member who can read campaigns (Owner, Admin, Sales; a Viewer gets the plain "not found" page, like a stranger), and the
 * workspace must be one they can see. The business type's module `campaigns` is checked by the workspace's template (the module guard), and again by the API. A workspace that cannot be read gives the "could not load" page.
 */
export async function campaignContext(tenantIdRaw: string): Promise<{ ok: true; ctx: CampaignContext } | { ok: false; page: ReactElement }> {
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
  return { ok: true, ctx: { accessToken: user.accessToken, tenantId: tenantIdRaw, tenant, pack } };
}
