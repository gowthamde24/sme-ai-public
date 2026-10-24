import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { AdmissionForm } from "@/components/v2/app/education/AdmissionForm";
import { pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { listContactNames } from "@/lib/api/contact-names";
import { listProgrammes } from "@/lib/api/education";
import { escalate } from "@/lib/api/failure";

import { eduContext, eduWords } from "../../education-kit";
import { saveAdmissionAction } from "../actions";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `New enquiry · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/admissions/new: start an admission enquiry (job CS; Owner, Admin and Sales). The page makes the enquiry's id, so pressing Save twice is a retry. No child is stored. */
export default async function NewAdmissionRoute({ params }: PageProps<"/app/tenants/[tenantId]/admissions/new">) {
  const { tenantId } = await params;
  const got = await eduContext(tenantId);
  if (!got.ok) return got.page;
  const { accessToken } = got.ctx;
  const lang = await getLang();
  let programmes: Awaited<ReturnType<typeof listProgrammes>> = [];
  let guardians: Awaited<ReturnType<typeof listContactNames>> = [];
  try {
    [programmes, guardians] = await Promise.all([listProgrammes(accessToken, tenantId), listContactNames(accessToken, tenantId)]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  return (
    <main className={pageMain} lang={lang}>
      <h1 className="mb-4 font-display text-[26px] font-semibold leading-[1.15] md:text-4xl">{eduWords(lang)["edu.adm.add"]}</h1>
      <AdmissionForm base={`/app/tenants/${tenantId}`} admissionId={randomUUID()} programmes={programmes} guardians={guardians} words={eduWords(lang)} actions={{ save: saveAdmissionAction.bind(null, tenantId) }} />
    </main>
  );
}
