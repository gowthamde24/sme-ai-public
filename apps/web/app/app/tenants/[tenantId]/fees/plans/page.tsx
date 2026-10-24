import { redirect } from "next/navigation";

import { FeePlansView } from "@/components/v2/app/education/FeePlansView";
import { pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { listFeePlans, listProgrammes } from "@/lib/api/education";
import { escalate } from "@/lib/api/failure";

import { eduContext, eduWords } from "../../education-kit";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Fee plans · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/fees/plans: the fee plans of the school (job CS). Owner and Admin make plans; Sales read. */
export default async function FeePlansRoute({ params }: PageProps<"/app/tenants/[tenantId]/fees/plans">) {
  const { tenantId } = await params;
  const got = await eduContext(tenantId, "fees");
  if (!got.ok) return got.page;
  const { accessToken, tenant } = got.ctx;
  const lang = await getLang();
  let plans: Awaited<ReturnType<typeof listFeePlans>> | null = null;
  let programmes: Awaited<ReturnType<typeof listProgrammes>> = [];
  try {
    [plans, programmes] = await Promise.all([listFeePlans(accessToken, tenantId, { includeInactive: true }), listProgrammes(accessToken, tenantId, { includeInactive: true })]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
  }
  return (
    <main className={pageMain} lang={lang}>
      <FeePlansView base={`/app/tenants/${tenantId}`} words={eduWords(lang)} role={tenant.role} plans={plans} programmes={programmes} />
    </main>
  );
}
