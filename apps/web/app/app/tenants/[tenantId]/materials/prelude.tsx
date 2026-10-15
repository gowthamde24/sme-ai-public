import { notFound, redirect } from "next/navigation";
import type { ReactElement } from "react";

import { ApiDownV2 } from "@/components/v2/app/parts";
import { partsWords } from "@/i18n/app-words";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";
import { hasModule } from "@/lib/packs/has";
import { readPackCached } from "@/lib/packs/read";

type Tenant = Awaited<ReturnType<typeof fetchTenant>>;
export type MaterialsContext = { accessToken: string; tenantId: string; tenant: Tenant };

/**
 * What every page of the building-materials product screens starts with (job CO): the person must be signed in, the workspace must be one they can see, and the business type must have the module `materials`; anything else
 * is the same plain "not found" page. A workspace that cannot be read at all gives the "could not load" page. These screens live on their own routes (not inside the saree catalogue's) so a saree workspace never downloads
 * them: the route-JS budget counts what a page loads on a first visit.
 */
export async function materialsContext(tenantIdRaw: string): Promise<{ ok: true; ctx: MaterialsContext } | { ok: false; page: ReactElement }> {
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
  if (!hasModule(await readPackCached(user.accessToken, tenantIdRaw).catch(() => null), "materials")) notFound();
  return { ok: true, ctx: { accessToken: user.accessToken, tenantId: tenantIdRaw, tenant } };
}
