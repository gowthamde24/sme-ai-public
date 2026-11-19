import { getLang } from "@/i18n/get-lang";
import { fetchTenant } from "@/lib/api/client";
import { readNewJobSheet } from "@/lib/api/job-templates";
import { readJobsToday } from "@/lib/api/jobs";
import type { SheetLoad } from "@/lib/jobs/templates";

/**
 * The ideas of the New job sheet and what the previews are filled with (the shop's name, the main assistant's name, the person's language). NOT an action (it takes a token): only the server's own pages and `loadNewJobSheetAction` call it.
 * null = the API has no ideas yet.
 */
export async function readSheetLoad(token: string, tenantId: string): Promise<SheetLoad | null> {
  const [data, tenant, today, lang] = await Promise.all([readNewJobSheet(token, tenantId), fetchTenant(token, tenantId), readJobsToday(token, tenantId).catch(() => null), getLang()]);
  return data ? { data, lang, business: tenant.name, assistant: today?.assistantName ?? null } : null;
}
