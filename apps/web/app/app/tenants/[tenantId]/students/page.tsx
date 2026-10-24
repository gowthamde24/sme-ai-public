import { redirect } from "next/navigation";

import { StudentsView } from "@/components/v2/app/education/StudentsView";
import { pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { listProgrammes, listStudents } from "@/lib/api/education";
import { escalate } from "@/lib/api/failure";

import { eduContext, eduWords } from "../education-kit";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Students · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const MAX_CURSOR = 400;

/** /app/tenants/[tenantId]/students: the students of the school, the minimum record (job CS; module `programmes`). Owner, Admin and Sales read; a Viewer gets "not found". `?programme=` and `?status=` filter; `?after=` pages. */
export default async function StudentsRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/students">) {
  const { tenantId } = await params;
  const raw = await searchParams;
  const got = await eduContext(tenantId);
  if (!got.ok) return got.page;
  const { accessToken, tenant } = got.ctx;
  const lang = await getLang();
  const base = `/app/tenants/${tenantId}`;
  const programmeRaw = pick(raw.programme);
  const programme = programmeRaw && isCanonicalUuid(programmeRaw) ? programmeRaw : null;
  const statusRaw = pick(raw.status);
  const status = statusRaw === "active" || statusRaw === "left" ? statusRaw : null;
  const afterRaw = pick(raw.after);
  const after = afterRaw && afterRaw.length <= MAX_CURSOR ? afterRaw : null;
  let page: Awaited<ReturnType<typeof listStudents>> | null = null;
  let programmes: Awaited<ReturnType<typeof listProgrammes>> = [];
  try {
    [page, programmes] = await Promise.all([listStudents(accessToken, tenantId, { ...(programme ? { programmeId: programme } : {}), ...(status ? { status } : {}), after }), listProgrammes(accessToken, tenantId, { includeInactive: true })]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
  }
  const keep = [programme ? `programme=${programme}` : null, status ? `status=${status}` : null].filter(Boolean).join("&");
  return (
    <main className={pageMain} lang={lang}>
      <StudentsView
        base={base}
        words={eduWords(lang)}
        role={tenant.role}
        students={page?.items ?? null}
        programmes={programmes}
        programme={programme}
        status={status}
        more={page?.next_cursor ? `${base}/students?${keep ? `${keep}&` : ""}after=${encodeURIComponent(page.next_cursor)}` : null}
        saved={pick(raw.saved) === "1"}
        imported={pick(raw.imported) === "1"}
      />
    </main>
  );
}
