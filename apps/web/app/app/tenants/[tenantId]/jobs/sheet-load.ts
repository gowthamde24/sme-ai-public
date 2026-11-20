import { getLang } from "@/i18n/get-lang";
import { fetchTenant } from "@/lib/api/client";
import { readNewJobSheet } from "@/lib/api/job-templates";
import { readJobsToday } from "@/lib/api/jobs";
import { getProfile } from "@/lib/api/profile";
import { businessLanguage } from "@/lib/assistant/business-language";
import type { NewJobSheetData, SheetLoad } from "@/lib/jobs/templates";

/** Does any template of the answer have a recorded sample voice? (Only then is the business's language needed: the player picks the person's language, then the business's, then Telugu, then English.) */
const hasSample = (data: NewJobSheetData): boolean => [data.own, ...data.others.map((o) => o.jobs)].some((p) => p.templates.some((t) => t.sampleAudio !== null));

/**
 * The ideas of the New job sheet and what the previews are filled with (the shop's name, the main assistant's name, the person's language). NOT an action (it takes a token): only the server's own pages and `loadNewJobSheetAction` call it.
 * null = the API has no ideas yet.
 */
export async function readSheetLoad(token: string, tenantId: string): Promise<SheetLoad | null> {
  const [data, tenant, today, lang] = await Promise.all([readNewJobSheet(token, tenantId), fetchTenant(token, tenantId), readJobsToday(token, tenantId).catch(() => null), getLang()]);
  if (!data) return null;
  const businessLang = hasSample(data) ? businessLanguage((await getProfile(token, tenantId).catch(() => null))?.languages ?? []) : null;
  return { data, lang, business: tenant.name, assistant: today?.assistantName ?? null, businessLang };
}
