import { redirect } from "next/navigation";

import { AdmissionsBoard } from "@/components/v2/app/education/AdmissionsBoard";
import { pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { SOURCES, listAdmissions, listProgrammes, type Source } from "@/lib/api/education";
import { escalate } from "@/lib/api/failure";

import { eduContext, eduWords } from "../education-kit";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Admissions · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** /app/tenants/[tenantId]/admissions: the admissions board (job CS; module `programmes`): enquiry, campus visit, application, admitted, lost. `?programme=` and `?source=` filter. Owner, Admin and Sales. */
export default async function AdmissionsRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/admissions">) {
  const { tenantId } = await params;
  const raw = await searchParams;
  const got = await eduContext(tenantId);
  if (!got.ok) return got.page;
  const { accessToken, tenant } = got.ctx;
  const lang = await getLang();
  const programmeRaw = pick(raw.programme);
  const programme = programmeRaw && isCanonicalUuid(programmeRaw) ? programmeRaw : null;
  const sourceRaw = pick(raw.source);
  const source = sourceRaw && (SOURCES as readonly string[]).includes(sourceRaw) ? (sourceRaw as Source) : null;
  let page: Awaited<ReturnType<typeof listAdmissions>> | null = null;
  let programmes: Awaited<ReturnType<typeof listProgrammes>> = [];
  try {
    [page, programmes] = await Promise.all([listAdmissions(accessToken, tenantId, { ...(programme ? { programmeId: programme } : {}), ...(source ? { source } : {}) }), listProgrammes(accessToken, tenantId, { includeInactive: true })]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
  }
  return (
    <main className={pageMain} lang={lang}>
      <AdmissionsBoard base={`/app/tenants/${tenantId}`} words={eduWords(lang)} role={tenant.role} admissions={page?.items ?? null} programmes={programmes} programme={programme} source={source} more={page?.next_cursor != null} saved={pick(raw.saved) === "1"} />
    </main>
  );
}
