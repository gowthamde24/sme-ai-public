import { notFound, redirect } from "next/navigation";

import { NewJob } from "@/components/v2/app/jobs/NewJob";
import { SampleChip } from "@/components/v2/app/jobs/SampleChip";
import { PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { listSuggestions, planJob } from "@/lib/api/jobs";
import { requireUser } from "@/lib/auth/session";
import { JOB_KINDS, type JobKind } from "@/lib/jobs/types";
import type { JobPlan } from "@/lib/jobs/plan";
import { readPackCached } from "@/lib/packs/read";
import { jobsScreens } from "@/lib/screens/flag";

import { changeSearchAction, planJobAction, startPlanAction, startSuggestionAction, testPlanAction } from "./actions";

export const metadata = { title: `Start a job · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/jobs/new (JOBS, owner decision 19 Nov): say or type what the assistant should do, see the PLAN (nothing has started), and Start; and the suggested jobs for this kind of business, one tap each. Not there (404) while JOBS is off.
 * Owner and Admin start jobs; the others get one plain sentence. `?look=<kind>` (from the empty Jobs page) opens the plan card of a suggested job.
 */
export default async function NewJobRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/jobs/new">) {
  if (jobsScreens() === "off") notFound();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  const { look } = await searchParams;
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
  const base = `/app/tenants/${tenantId}`;
  const top = <PageTop title={words["jobs.new.title"] ?? "Add a team member"} sub={words["jobs.new.sub"]} />;
  if (role !== "owner" && role !== "admin") {
    return (
      <main className={pageMain} lang={lang}>
        {top}
        <p data-part="only-owner" className="m-0 mt-4 rounded-2xl border border-line bg-surface p-5 text-muted">
          {words["jobs.new.only"]}
        </p>
      </main>
    );
  }
  const pack = await readPackCached(user.accessToken, tenantId).catch(() => null);
  const suggested = await listSuggestions(user.accessToken, tenantId, pack?.modules ?? null);
  const wanted = typeof look === "string" && (JOB_KINDS as readonly string[]).includes(look) ? (look as JobKind) : null;
  let initialPlan: JobPlan | null = null;
  if (wanted) {
    try {
      initialPlan = await planJob(user.accessToken, tenantId, { kind: wanted }, lang);
    } catch {
      initialPlan = null;
    }
  }
  return (
    <main className={pageMain} lang={lang}>
      {top}
      {suggested?.sample ? (
        <p data-part="sample-suggestions" className="m-0 mt-3">
          <SampleChip words={words} note />
        </p>
      ) : null}
      <div className="mt-5">
        <NewJob
          words={words}
          base={base}
          suggestions={suggested?.items ?? []}
          heading={suggested?.heading ?? null}
          initialPlan={initialPlan}
          actions={{
            plan: planJobAction.bind(null, tenantId),
            start: startPlanAction.bind(null, tenantId),
            startSuggestion: startSuggestionAction.bind(null, tenantId),
            test: testPlanAction.bind(null, tenantId),
            search: changeSearchAction.bind(null, tenantId),
          }}
        />
      </div>
    </main>
  );
}
