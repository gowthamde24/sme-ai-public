import { notFound, redirect } from "next/navigation";

import { StudentDetail } from "@/components/v2/app/education/StudentDetail";
import { todayInIndia } from "@/components/v2/app/visits/dates";
import { pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getGuardianFees, getStudent } from "@/lib/api/education";
import { escalate } from "@/lib/api/failure";
import { clock } from "@/lib/clock";
import { hasModule } from "@/lib/packs/has";

import { eduContext, eduWords } from "../../education-kit";
import { eraseStudentAction, studentStatusAction } from "../actions";

export const metadata = { title: "Student · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/students/[studentId]: one student (job CS). With the module `fees` it also shows what the guardian owes across their children. */
export default async function StudentRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/students/[studentId]">) {
  const { tenantId, studentId } = await params;
  const raw = await searchParams;
  if (!isCanonicalUuid(studentId)) notFound();
  const got = await eduContext(tenantId);
  if (!got.ok) return got.page;
  const { accessToken, tenant, pack } = got.ctx;
  const lang = await getLang();
  let student;
  let guardianFees = null;
  try {
    student = await getStudent(accessToken, tenantId, studentId);
    if (hasModule(pack, "fees") && !student.erased) guardianFees = await getGuardianFees(accessToken, tenantId, student.contact_id).catch((e) => { if (e instanceof ApiAuthError) throw e; return null; });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const saved = (Array.isArray(raw.saved) ? raw.saved[0] : raw.saved) === "1";
  return (
    <main className={pageMain} lang={lang}>
      <StudentDetail
        student={student}
        base={`/app/tenants/${tenantId}`}
        role={tenant.role}
        words={eduWords(lang)}
        guardianFees={guardianFees}
        today={todayInIndia(clock())}
        saved={saved}
        actions={{ setStatus: studentStatusAction.bind(null, tenantId, studentId), erase: eraseStudentAction.bind(null, tenantId, studentId) }}
      />
    </main>
  );
}
