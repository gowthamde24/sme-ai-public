import { redirect } from "next/navigation";

import { ProgrammesView } from "@/components/v2/app/education/ProgrammesView";
import { pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { getInstitutionProfile, listProgrammes } from "@/lib/api/education";
import { escalate } from "@/lib/api/failure";

import { eduContext, eduWords } from "../education-kit";
import { saveGroupAction, saveProfileAction, saveProgrammeAction } from "./actions";

export const metadata = { title: "Programmes · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/programmes: the institution and its programmes, classes and sections (job CS; module `programmes`). Owner and Admin write; Sales read; a Viewer gets "not found". */
export default async function ProgrammesRoute({ params }: PageProps<"/app/tenants/[tenantId]/programmes">) {
  const { tenantId } = await params;
  const got = await eduContext(tenantId);
  if (!got.ok) return got.page;
  const { accessToken, tenant } = got.ctx;
  const lang = await getLang();
  let data;
  try {
    data = await Promise.all([getInstitutionProfile(accessToken, tenantId), listProgrammes(accessToken, tenantId, { includeInactive: true })]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  return (
    <main className={pageMain} lang={lang}>
      <ProgrammesView
        profile={data[0]}
        programmes={data[1]}
        role={tenant.role}
        words={eduWords(lang)}
        base={`/app/tenants/${tenantId}`}
        actions={{ saveProfile: saveProfileAction.bind(null, tenantId), saveProgramme: saveProgrammeAction.bind(null, tenantId), saveGroup: saveGroupAction.bind(null, tenantId) }}
      />
    </main>
  );
}
