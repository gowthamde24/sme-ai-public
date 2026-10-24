import { notFound, redirect } from "next/navigation";

import { StudentForm } from "@/components/v2/app/education/StudentForm";
import { pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getStudent, listProgrammes } from "@/lib/api/education";
import { escalate } from "@/lib/api/failure";

import { eduContext, eduWords } from "../../../education-kit";
import { saveStudentAction } from "../../actions";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Change a student · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/students/[studentId]/edit: change a student's placement, label or admission number (job CS; Owner and Admin). The guardian and the kind never change. An erased student cannot be changed. */
export default async function EditStudentRoute({ params }: PageProps<"/app/tenants/[tenantId]/students/[studentId]/edit">) {
  const { tenantId, studentId } = await params;
  if (!isCanonicalUuid(studentId)) notFound();
  const got = await eduContext(tenantId);
  if (!got.ok) return got.page;
  const { accessToken, tenant } = got.ctx;
  const base = `/app/tenants/${tenantId}`;
  if (tenant.role !== "owner" && tenant.role !== "admin") redirect(`${base}/students/${studentId}`);
  const lang = await getLang();
  let student;
  let programmes: Awaited<ReturnType<typeof listProgrammes>> = [];
  try {
    [student, programmes] = await Promise.all([getStudent(accessToken, tenantId, studentId), listProgrammes(accessToken, tenantId, { includeInactive: true })]);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  if (student.erased) redirect(`${base}/students/${studentId}`);
  return (
    <main className={pageMain} lang={lang}>
      <h1 className="mb-4 font-display text-[26px] font-semibold leading-[1.15] md:text-4xl">{eduWords(lang)["edu.sf.save.edit"]}</h1>
      <StudentForm base={base} studentId={studentId} student={student} guardians={[]} guardianFixed={null} programmes={programmes} words={eduWords(lang)} actions={{ save: saveStudentAction.bind(null, tenantId) }} />
    </main>
  );
}
