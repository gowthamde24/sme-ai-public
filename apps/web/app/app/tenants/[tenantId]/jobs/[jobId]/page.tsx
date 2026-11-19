import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cache } from "react";

import { JobPage } from "@/components/v2/app/jobs/detail/JobPage";
import type { JobPageActions } from "@/components/v2/app/jobs/detail/types";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getJob } from "@/lib/api/jobs";
import { requireUser } from "@/lib/auth/session";
import { agoOf } from "@/lib/jobs/detail";
import { jobNameKey } from "@/lib/jobs/types";
import { jobsScreens } from "@/lib/screens/flag";

import { setJobEnabledAction } from "../actions";
import { addJobFaqAction, removeJobFaqAction, renameJobAction, setJobFindsOutAction, setJobSettingAction, testJobAction } from "./actions";

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
  return { role, detail };
});

/** The tab's title is the job's name (the one the owner gave it, else the plain name). */
export async function generateMetadata({ params }: PageProps<"/app/tenants/[tenantId]/jobs/[jobId]">): Promise<Metadata> {
  if (jobsScreens() === "off") return { title: `Jobs · ${BRAND_NAME}` };
  const { tenantId, jobId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(jobId)) return { title: `Jobs · ${BRAND_NAME}` };
  const { detail } = await load(tenantId, jobId);
  const name = detail ? (detail.job.customName ?? wordsFor(await getLang(), ["jobs.kind."])[jobNameKey(detail.job.kind)] ?? "Jobs") : "Jobs";
  return { title: `${name} · ${BRAND_NAME}` };
}

/** /app/tenants/[tenantId]/jobs/[jobId] (JOBS, owner decision 19 Nov): ONE job's page. Not there (404) while JOBS is off. Everyone who may open the workspace reads it; Owner and Admin change it. */
export default async function JobRoute({ params }: PageProps<"/app/tenants/[tenantId]/jobs/[jobId]">) {
  if (jobsScreens() === "off") notFound();
  const { tenantId, jobId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(jobId)) notFound();
  const { role, detail } = await load(tenantId, jobId);
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
      }
    : null;
  const name = detail.job.customName ?? words[jobNameKey(detail.job.kind)] ?? "";
  return (
    <main className={pageMain} lang={lang}>
      <nav aria-label={words["jobs.page.title"]} className="mb-4 flex items-center gap-1.5 text-sm text-muted">
        <Link href={`${base}/jobs`} prefetch={false} className="inline-flex min-h-11 items-center text-muted no-underline">
          {words["jobs.page.title"] ?? "Jobs"}
        </Link>
        <ChevronRight aria-hidden="true" className="size-4" />
        <span aria-current="page" className="font-semibold text-ink">
          {name}
        </span>
      </nav>
      <JobPage detail={detail} words={words} base={base} lang={lang} ago={agoOf(detail.job.lastRunAt, clock())} actions={actions} />
    </main>
  );
}
