import Link from "next/link";

import { BatchForm } from "@/components/v2/app/outreach/BatchForm";
import { PageTop } from "@/components/v2/app/parts";
import { backLink, pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { assistantLangOf } from "@/lib/outreach/language";
import { isSourceTag, type Goal } from "@/lib/outreach/types";
import { goalNames, languageNames, sourceNames } from "@/lib/outreach/words";
import { outreachScreens } from "@/lib/screens/flag";

import { leadContext } from "../../lead-context";
import { planBatchAction } from "../../outreach-actions";

export const metadata = { title: `Make a plan · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * /app/tenants/[tenantId]/outreach/new?source=<tag>&goal=<goal> (night 4, part A3): the form that makes the PLAN of a batch for the leads of one source (an upload that was just imported, a portal). It sends nothing: the plan card on the next
 * page is approved once by the Owner. The source and the goal come from the address (checked against the closed lists; anything else is the safe default).
 */
export default async function NewPlanPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/outreach/new">) {
  const { tenantId } = await params;
  const query = await searchParams;
  const got = await leadContext(tenantId, { roles: ["owner", "admin", "sales"], on: outreachScreens() !== "off" });
  if (!got.ok) return got.page;
  const lang = await getLang();
  const words = wordsFor(lang, ["ol.", "pc.", "ld.goal.", "ld.source."]);
  const wantedSource = pick(query.source);
  const source = isSourceTag(wantedSource) ? wantedSource : "excel_upload";
  const wantedGoal = pick(query.goal);
  const goal: Goal = (["site_visit", "counselling", "appointment", "qualify", "test_drive", "site_measurement", "quote", "trial", "callback", "general"] as const).find((g) => g === wantedGoal) ?? "general";
  const sn = sourceNames(words);
  const base = `/app/tenants/${tenantId}`;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={words["ol.new.title"] ?? "Make a plan"} sub={words["ol.new.sub"] ?? ""} />
      <p className="mt-3">
        <Link href={`${base}/outreach`} className={backLink}>
          {words["ol.back"]}
        </Link>
      </p>
      <div className="mt-6 max-w-3xl">
        <BatchForm words={words} source={source} sourceLabel={sn[source]} defaultName={`${sn[source]}, ${today}`} defaultGoal={goal} defaultLanguage={assistantLangOf(lang)} languageNames={languageNames()} goalNames={goalNames(words)} plan={planBatchAction.bind(null, tenantId)} backHref={`${base}/outreach`} today={today} />
      </div>
    </main>
  );
}
