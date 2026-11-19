import { notFound, redirect } from "next/navigation";

import { JobsList } from "@/components/v2/app/jobs/JobsList";
import { PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { listSuggestions, readJobs } from "@/lib/api/jobs";
import { requireUser } from "@/lib/auth/session";
import { JOB_FILTERS, type JobFilter } from "@/lib/jobs/types";
import { readPackCached } from "@/lib/packs/read";
import { jobsScreens } from "@/lib/screens/flag";

import { setJobEnabledAction } from "./actions";
import { startSuggestionAction } from "./new/actions";

export const metadata = { title: `Jobs · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/jobs (JOBS, owner decision 19 Nov): every job the assistant runs for the shop, with a switch each, and "Start a job". Not there (404) while JOBS is off. Everyone who may open the workspace reads it; Owner and Admin switch. */
export default async function JobsRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/jobs">) {
  if (jobsScreens() === "off") notFound();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  const { filter } = await searchParams;
  const user = await requireUser();
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    notFound();
  }
  const lang = await getLang();
  const words = wordsFor(lang, ["jobs."]);
  const jobs = await readJobs(user.accessToken, tenantId);
  const owns = role === "owner" || role === "admin";
  // the empty page offers the business type's suggested jobs (Owner and Admin start them; the others see no empty-state offer)
  const suggestions = jobs && jobs.length === 0 && owns ? ((await listSuggestions(user.accessToken, tenantId, (await readPackCached(user.accessToken, tenantId).catch(() => null))?.modules ?? null))?.items ?? []) : [];
  const base = `/app/tenants/${tenantId}`;
  const f: JobFilter = typeof filter === "string" && (JOB_FILTERS as readonly string[]).includes(filter) ? (filter as JobFilter) : "all";
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={words["jobs.page.title"] ?? "Jobs"} sub={words["jobs.page.sub"]} />
      {jobs ? (
        <JobsList jobs={jobs} filter={f} words={words} base={base} actions={owns ? { setEnabled: setJobEnabledAction.bind(null, tenantId) } : null} suggestions={suggestions} suggestionActions={owns ? { start: startSuggestionAction.bind(null, tenantId) } : null} />
      ) : (
        <p className="m-0 text-muted">{words["jobs.page.na"]}</p>
      )}
    </main>
  );
}
