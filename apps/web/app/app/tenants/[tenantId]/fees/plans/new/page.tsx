import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { FeePlanForm } from "@/components/v2/app/education/FeePlanForm";
import { academicYearOf } from "@/components/v2/app/education/fee-plan-logic";
import { todayInIndia } from "@/components/v2/app/visits/dates";
import { pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getFeePlan, getInstitutionProfile, listProgrammes } from "@/lib/api/education";
import { escalate } from "@/lib/api/failure";
import { clock } from "@/lib/clock";

import { eduContext, eduWords } from "../../../education-kit";
import { saveFeePlanAction } from "../../actions";

export const metadata = { title: "New fee plan · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** /app/tenants/[tenantId]/fees/plans/new: make a fee plan (job CS; Owner and Admin). `?from=` copies another plan's lines. The page makes the plan's id, so pressing Save twice is a retry. */
export default async function NewFeePlanRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/fees/plans/new">) {
  const { tenantId } = await params;
  const raw = await searchParams;
  const got = await eduContext(tenantId, "fees");
  if (!got.ok) return got.page;
  const { accessToken, tenant } = got.ctx;
  const base = `/app/tenants/${tenantId}`;
  if (tenant.role !== "owner" && tenant.role !== "admin") redirect(`${base}/fees/plans`);
  const lang = await getLang();
  const from = pick(raw.from);
  let programmes: Awaited<ReturnType<typeof listProgrammes>> = [];
  let profile;
  let source = null;
  try {
    [programmes, profile] = await Promise.all([listProgrammes(accessToken, tenantId), getInstitutionProfile(accessToken, tenantId)]);
    if (from && isCanonicalUuid(from)) source = await getFeePlan(accessToken, tenantId, from).catch((e) => { if (e instanceof ApiAuthError) throw e; return null; });
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const year = academicYearOf(todayInIndia(clock()), profile.year_start_month ?? 6);
  return (
    <main className={pageMain} lang={lang}>
      <h1 className="mb-4 font-display text-[26px] font-semibold leading-[1.15] md:text-4xl">{eduWords(lang)["edu.plan.add"]}</h1>
      <FeePlanForm base={base} planId={randomUUID()} plan={source} copy={source !== null} programmes={programmes} defaultYear={year} words={eduWords(lang)} actions={{ save: saveFeePlanAction.bind(null, tenantId) }} />
    </main>
  );
}
