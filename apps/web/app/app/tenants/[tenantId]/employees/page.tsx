import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { EmployeeList } from "@/components/v2/app/employees/EmployeeList";
import { PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getEmployees } from "@/lib/api/employees";
import { requireUser } from "@/lib/auth/session";
import { employeeScreens, jobsScreens } from "@/lib/screens/flag";

import { setEmployeeStatusAction } from "./actions";

export const metadata = { title: `AI Team · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/employees (EMPLOYEES, owner 26 Nov 2026): the AI Team, every AI employee as a card with Turn on or Pause, and "New AI employee". Not there (404) while EMPLOYEES is off. Everyone who may open the workspace reads it; Owner and Admin change it. */
export default async function EmployeesRoute({ params }: PageProps<"/app/tenants/[tenantId]/employees">) {
  if (employeeScreens() === "off" || jobsScreens() === "off") notFound();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  const user = await requireUser();
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    notFound();
  }
  const lang = await getLang();
  const words = wordsFor(lang, ["emp."]);
  const owns = role === "owner" || role === "admin";
  const base = `/app/tenants/${tenantId}`;
  const data = await getEmployees(user.accessToken, tenantId).catch((error) => {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  });
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={words["emp.title"] ?? "Your AI team"} sub={words["emp.sub"]} />
      <div className="mt-5">
        {data ? (
          <EmployeeList employees={data.employees} limit={data.limit} words={words} base={base} canAdd={owns} actions={owns ? { setStatus: setEmployeeStatusAction.bind(null, tenantId) } : null} />
        ) : (
          <section data-part="emp-na" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 md:p-6">
            <p className="m-0 text-ink">{words["emp.na"]}</p>
            <p className="m-0">
              <Link href={`${base}/jobs`} prefetch={false} className="font-semibold text-brand-text underline underline-offset-2">
                {words["emp.jobs_link"]}
              </Link>
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
