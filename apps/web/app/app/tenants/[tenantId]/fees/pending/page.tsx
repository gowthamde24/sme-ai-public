import { redirect } from "next/navigation";

import { PendingList } from "@/components/v2/app/education/PendingList";
import { pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { listPending, listProgrammes } from "@/lib/api/education";
import { escalate } from "@/lib/api/failure";

import { eduContext, eduWords } from "../../education-kit";

export const metadata = { title: "Fees pending · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const MAX_CURSOR = 400;

/** /app/tenants/[tenantId]/fees/pending: who has fees pending, the largest first (job CS). The word is "pending". `?programme=` filters; `?after=` pages. */
export default async function PendingRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/fees/pending">) {
  const { tenantId } = await params;
  const raw = await searchParams;
  const got = await eduContext(tenantId, "fees");
  if (!got.ok) return got.page;
  const { accessToken } = got.ctx;
  const lang = await getLang();
  const base = `/app/tenants/${tenantId}`;
  const programmeRaw = pick(raw.programme);
  const programme = programmeRaw && isCanonicalUuid(programmeRaw) ? programmeRaw : null;
  const afterRaw = pick(raw.after);
  const after = afterRaw && afterRaw.length <= MAX_CURSOR ? afterRaw : null;
  let page: Awaited<ReturnType<typeof listPending>> | null = null;
  let programmes: Awaited<ReturnType<typeof listProgrammes>> = [];
  try {
    [page, programmes] = await Promise.all([listPending(accessToken, tenantId, { ...(programme ? { programmeId: programme } : {}), after }), listProgrammes(accessToken, tenantId, { includeInactive: true })]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
  }
  return (
    <main className={pageMain} lang={lang}>
      <PendingList base={base} words={eduWords(lang)} rows={page?.items ?? null} programmes={programmes} programme={programme} more={page?.next_cursor ? `${base}/fees/pending?${programme ? `programme=${programme}&` : ""}after=${encodeURIComponent(page.next_cursor)}` : null} />
    </main>
  );
}
