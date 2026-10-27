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
import { taskScreens } from "@/lib/screens/flag";

type Tenant = Awaited<ReturnType<typeof fetchTenant>>;
export type TaskContext = { accessToken: string; tenantId: string; tenant: Tenant; pack: WorkspacePack | null };

/**
 * What both pages of the Tasks screens start with (night 4, job DR part B): the part must be switched on (TASK_SCREENS; off = the plain "not found" page), the person must be signed in and a member of the workspace (every role reads,
 * a Viewer too; the buttons are the roles' own). The business type is read only to hide the templates that are not for it (a school has no payment reminder).
 */
export async function taskContext(tenantIdRaw: string): Promise<{ ok: true; ctx: TaskContext } | { ok: false; page: ReactElement }> {
  if (taskScreens() === "off") notFound();
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
  const pack = await readPackCached(user.accessToken, tenantIdRaw).catch(() => null);
  return { ok: true, ctx: { accessToken: user.accessToken, tenantId: tenantIdRaw, tenant, pack } };
}
