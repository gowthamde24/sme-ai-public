import { redirect } from "next/navigation";

import { FeesDashboard } from "@/components/v2/app/education/FeesDashboard";
import { pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { getLateFeesPreview, listFeePlans } from "@/lib/api/education";
import { escalate } from "@/lib/api/failure";
import { runReport } from "@/lib/api/reports";

import { eduContext, eduWords } from "../education-kit";
import { postLateFeesAction } from "./actions";

export const metadata = { title: "Fees · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/** Each part is read on its own: a part that cannot be read is "could not load" in its place, never a guess. A rejected session still goes to sign-in. */
async function part<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    return null;
  }
}

/** /app/tenants/[tenantId]/fees: the collection screen of a school (job CS; module `fees`): what has fallen due, what is collected and what is pending, by class and section, today and day by day; the late fees waiting to be posted. */
export default async function FeesRoute({ params }: PageProps<"/app/tenants/[tenantId]/fees">) {
  const { tenantId } = await params;
  const got = await eduContext(tenantId, "fees");
  if (!got.ok) return got.page;
  const { accessToken, tenant } = got.ctx;
  const lang = await getLang();
  const [collection, today, plans, late] = await Promise.all([
    part(() => runReport(accessToken, tenantId, "education.collection")),
    part(() => runReport(accessToken, tenantId, "education.today")),
    part(() => listFeePlans(accessToken, tenantId, { includeInactive: true })),
    part(() => getLateFeesPreview(accessToken, tenantId)),
  ]);
  return (
    <main className={pageMain} lang={lang}>
      <FeesDashboard base={`/app/tenants/${tenantId}`} words={eduWords(lang)} role={tenant.role} collection={collection} today={today} plans={plans === null ? null : plans.length} lateFees={late} postLateFees={postLateFeesAction.bind(null, tenantId)} />
    </main>
  );
}
