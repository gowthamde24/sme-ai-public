import { ALL_SETTINGS } from "@/lib/jobs/redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cache } from "react";

import { JobPage } from "@/components/v2/app/jobs/detail/JobPage";
import { SampleChip } from "@/components/v2/app/jobs/SampleChip";
import type { JobPageActions, WhoExtra } from "@/components/v2/app/jobs/detail/types";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { readWhoTarget, readWhoVoices } from "@/lib/api/job-who";
import { getJob } from "@/lib/api/jobs";
import { requireUser } from "@/lib/auth/session";
import { agoOf } from "@/lib/jobs/detail";
import { jobNameKey } from "@/lib/jobs/types";
import { jobsScreens, voicePickerScreens } from "@/lib/screens/flag";

import { setJobEnabledAction } from "../actions";
import { addJobFaqAction, removeJobFaqAction, renameJobAction, setJobFindsOutAction, setJobSettingAction, setJobSpeaksAction, testJobAction } from "./actions";

export const dynamic = "force-dynamic";
const clock = (): number => Date.now();

/** The page and its title ask for the same job: one request. */
const load = cache(async (tenantId: string, jobId: string) => {
  const user = await requireUser();
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    notFound();
  }
  const detail = await getJob(user.accessToken, tenantId, jobId);
  return { role, detail, token: user.accessToken };
});

/** The tab's title is the job's name (the one the owner gave it, else the plain name). */
export async function generateMetadata({ params }: PageProps<"/app/tenants/[tenantId]/jobs/[jobId]">): Promise<Metadata> {
  if (jobsScreens() === "off") return { title: `AI Team · ${BRAND_NAME}` };
  const { tenantId, jobId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(jobId)) return { title: `AI Team · ${BRAND_NAME}` };
  const { detail } = await load(tenantId, jobId);
  const name = detail ? (detail.job.customName ?? wordsFor(await getLang(), ["jobs.kind."])[jobNameKey(detail.job.kind)] ?? "AI Team") : "AI Team";
  return { title: `${name} · ${BRAND_NAME}` };
}

/** /app/tenants/[tenantId]/jobs/[jobId] (JOBS, owner decision 19 Nov): ONE job's page. Not there (404) while JOBS is off. Everyone who may open the workspace reads it; Owner and Admin change it. */
export default async function JobRoute({ params }: PageProps<"/app/tenants/[tenantId]/jobs/[jobId]">) {
  if (jobsScreens() === "off") notFound();
  const { tenantId, jobId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(jobId)) notFound();
  const { role, detail, token } = await load(tenantId, jobId);
  if (!detail) notFound();
  const lang = await getLang();
  const words = wordsFor(lang, ["jobs."]);
  const base = `/app/tenants/${tenantId}`;
  const decides = role === "owner" || role === "admin";
  const actions: JobPageActions | null = decides
    ? {
        setEnabled: setJobEnabledAction.bind(null, tenantId, jobId),
        rename: renameJobAction.bind(null, tenantId, jobId),
        setSetting: setJobSettingAction.bind(null, tenantId, jobId),
        setFindsOut: setJobFindsOutAction.bind(null, tenantId, jobId),
        addFaq: addJobFaqAction.bind(null, tenantId, jobId),
        removeFaq: removeJobFaqAction.bind(null, tenantId, jobId),
        test: testJobAction.bind(null, tenantId, jobId),
        setSpeaks: setJobSpeaksAction.bind(null, tenantId, jobId),
      }
    : null;
  // Who talks: the play buttons use the voice-pick route (the recorded sample of one catalogue voice) when it is on; the command offers the visits job (a read of the jobs list)
  const whoExtra: WhoExtra | null =
    decides && detail.who
      ? { sampleEndpoint: voicePickerScreens() === "off" ? null : `${base}/voice-pick`, target: await readWhoTarget(token, tenantId, detail), changeJob: setJobSpeaksAction.bind(null, tenantId), voices: await readWhoVoices(token, tenantId) }
      : null;
  const name = detail.job.customName ?? words[jobNameKey(detail.job.kind)] ?? "";
  return (
    <main className={pageMain} lang={lang}>
      <nav aria-label={words["jobs.page.title"]} className="mb-4 flex items-center gap-1.5 text-sm text-muted">
        <Link href={`${base}/jobs`} prefetch={false} className="inline-flex min-h-11 items-center text-muted no-underline">
          {words["jobs.page.title"] ?? "Your AI team"}
        </Link>
        <ChevronRight aria-hidden="true" className="size-4" />
        <span aria-current="page" className="font-semibold text-ink">
          {name}
        </span>
        {detail.job.sample ? <SampleChip words={words} note className="ml-2" /> : null}
      </nav>
      <JobPage detail={detail} words={words} base={base} lang={lang} ago={agoOf(detail.job.lastRunAt, clock())} actions={actions} allSettingsHref={ALL_SETTINGS[detail.job.kind] ? `${base}${ALL_SETTINGS[detail.job.kind]}` : null} whoExtra={whoExtra} />
    </main>
  );
}
