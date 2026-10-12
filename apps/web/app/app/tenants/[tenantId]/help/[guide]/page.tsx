import { notFound, redirect } from "next/navigation";

import { isGuideId } from "@/components/v2/app/help/guides";
import { HelpGuide } from "@/components/v2/app/help/HelpScreens";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { appT } from "@/i18n/app";
import { partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "Help · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/help/[guide]: one guide (job BT). An unknown guide is the same not-found page as an unknown workspace. */
export default async function HelpGuidePage({ params }: PageProps<"/app/tenants/[tenantId]/help/[guide]">) {
  const user = await requireUser();
  const { tenantId, guide } = await params;
  if (!isCanonicalUuid(tenantId) || !isGuideId(guide)) notFound();
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  return (
    <main className={pageMain} lang={lang}>
      <HelpGuide id={guide} t={appT(lang)} base={`/app/tenants/${tenantId}`} lang={lang} role={tenant.role} />
    </main>
  );
}
