import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { JobsList, type JobsSheet } from "@/components/v2/app/jobs/JobsList";
import { TellAssistant } from "@/components/v2/app/jobs/tell/LazyTellAssistant";
import { SampleChip } from "@/components/v2/app/jobs/SampleChip";
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
import { jobsScreens, tellScreens } from "@/lib/screens/flag";

import { setJobEnabledAction } from "./actions";
import { changeSearchAction, planJobAction, startPlanAction, startSuggestionAction, testPlanAction } from "./new/actions";
import { loadNewJobSheetAction } from "./sheet-actions";
import { readSheetLoad } from "./sheet-load";
import { describeAction, turnOnAction } from "./tell-actions";

export const metadata = { title: `Jobs · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/jobs (JOBS, owner decision 19 Nov): every job the assistant runs for the shop, with a switch each, and "Start a job". Not there (404) while JOBS is off. Everyone who may open the workspace reads it; Owner and Admin switch. */
export default async function JobsRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/jobs">) {
  if (jobsScreens() === "off") notFound();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  const { filter, new: openNew, tell } = await searchParams;
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
  const owns = role === "owner" || role === "admin";
  const base = `/app/tenants/${tenantId}`;
  // "Tell your assistant what to do" (TELL_SCREENS; `?tell=1`): the job in your own words, a draft as plain fields, Turn it on. Owner and Admin; with the flag off the address is the plain Jobs page.
  if (tell === "1" && tellScreens() !== "off" && owns) {
    return (
      <main className={pageMain} lang={lang}>
        <Link href={`${base}/jobs`} prefetch={false} className="mb-2 inline-flex min-h-11 items-center text-[15px] font-semibold text-muted no-underline">
          {words["jobs.tell.back"]}
        </Link>
        <PageTop title={words["jobs.tell.title"] ?? "Tell your assistant what to do"} sub={words["jobs.tell.sub"]} />
        <div className="mt-5">
          <TellAssistant words={words} base={base} actions={{ describe: describeAction.bind(null, tenantId), turnOn: turnOnAction.bind(null, tenantId) }} />
        </div>
      </main>
    );
  }
  const jobs = await readJobs(user.accessToken, tenantId);
  // the empty page offers the business type's suggested jobs (Owner and Admin start them; the others see no empty-state offer)
  const suggestions = jobs && jobs.length === 0 && owns ? ((await listSuggestions(user.accessToken, tenantId, (await readPackCached(user.accessToken, tenantId).catch(() => null))?.modules ?? null))?.items ?? []) : [];
  // the New job sheet (Owner and Admin): its ideas are read here only when the page needs them at once (no jobs yet: three live cards; `?new=1`: the sheet is open); otherwise the sheet asks when it is opened
  const sheet: JobsSheet | null = owns
    ? {
        actions: { plan: planJobAction.bind(null, tenantId), start: startPlanAction.bind(null, tenantId), test: testPlanAction.bind(null, tenantId), search: changeSearchAction.bind(null, tenantId), load: loadNewJobSheetAction.bind(null, tenantId) },
        load: jobs && (jobs.length === 0 || openNew === "1") ? await readSheetLoad(user.accessToken, tenantId).catch((error) => (error instanceof ApiAuthError ? redirect("/login") : null)) : null,
        open: openNew === "1",
      }
    : null;
  const f: JobFilter = typeof filter === "string" && (JOB_FILTERS as readonly string[]).includes(filter) ? (filter as JobFilter) : "all";
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={words["jobs.page.title"] ?? "Jobs"} sub={words["jobs.page.sub"]} />
      {jobs?.some((j) => j.sample) ? (
        <p data-part="sample-jobs" className="m-0 mb-3">
          <SampleChip words={words} note />
        </p>
      ) : null}
      {jobs ? (
        <JobsList jobs={jobs} filter={f} words={words} base={base} actions={owns ? { setEnabled: setJobEnabledAction.bind(null, tenantId) } : null} suggestions={suggestions} suggestionActions={owns ? { start: startSuggestionAction.bind(null, tenantId) } : null} sheet={sheet ?? { actions: null, load: null, open: false }} tellHref={owns && tellScreens() !== "off" ? `${base}/jobs?tell=1` : null} />
      ) : (
        <section data-part="jobs-na" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 md:p-6">
          <p className="m-0 text-ink">{words["jobs.page.na"]}</p>
          <p className="m-0">
            <Link href={`${base}/ai-team`} prefetch={false} className="inline-flex min-h-11 items-center rounded-full border border-edge bg-surface px-5 text-[15px] font-semibold text-ink no-underline">
              {words["jobs.page.na_team"]}
            </Link>
          </p>
        </section>
      )}
    </main>
  );
}
