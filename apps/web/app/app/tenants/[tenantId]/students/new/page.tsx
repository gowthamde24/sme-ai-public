import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { StudentForm, type GuardianChoice } from "@/components/v2/app/education/StudentForm";
import { pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { listContactNames } from "@/lib/api/contact-names";
import { fetchContact, isCanonicalUuid } from "@/lib/api/crm";
import { listProgrammes } from "@/lib/api/education";
import { escalate } from "@/lib/api/failure";

import { eduContext, eduWords } from "../../education-kit";
import { saveStudentAction } from "../actions";

export const metadata = { title: "Add a student · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * /app/tenants/[tenantId]/students/new: add a student (job CS; Owner and Admin, anyone else goes to the list). The page makes the student's id, so pressing Save twice is a retry. `?contact=` fixes the guardian (a brother or sister
 * of a student, from that student's page); without it the guardian is chosen from the contacts the school already has: a new guardian arrives with an admission enquiry or the students file.
 */
export default async function NewStudentRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/students/new">) {
  const { tenantId } = await params;
  const raw = await searchParams;
  const got = await eduContext(tenantId);
  if (!got.ok) return got.page;
  const { accessToken, tenant } = got.ctx;
  const base = `/app/tenants/${tenantId}`;
  if (tenant.role !== "owner" && tenant.role !== "admin") redirect(`${base}/students`);
  const lang = await getLang();
  const contactRaw = pick(raw.contact);
  let guardians: GuardianChoice[] = [];
  let fixed: GuardianChoice | null = null;
  let programmes: Awaited<ReturnType<typeof listProgrammes>> = [];
  try {
    programmes = await listProgrammes(accessToken, tenantId);
    if (contactRaw && isCanonicalUuid(contactRaw)) {
      const c = await fetchContact(accessToken, tenantId, contactRaw);
      if (c) fixed = { id: c.id, name: c.full_name };
    }
    if (!fixed) {
      guardians = await listContactNames(accessToken, tenantId);
    }
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  return (
    <main className={pageMain} lang={lang}>
      <h1 className="mb-4 font-display text-[26px] font-semibold leading-[1.15] md:text-4xl">{eduWords(lang)["edu.stu.add"]}</h1>
      <StudentForm base={base} studentId={randomUUID()} student={null} guardians={guardians} guardianFixed={fixed} programmes={programmes} words={eduWords(lang)} actions={{ save: saveStudentAction.bind(null, tenantId) }} />
    </main>
  );
}
